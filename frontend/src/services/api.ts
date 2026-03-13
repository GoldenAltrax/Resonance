// Use environment variable for API URL, fallback to relative path for dev proxy
const API_URL = import.meta.env.VITE_API_URL || '/api';

// Lazy import to avoid a circular dep — debugLog has no deps on api.
function _dbg(level: 'info' | 'warn' | 'error', msg: string) {
  import('@/utils/debugLog').then(({ dbg }) => dbg[level](msg)).catch(() => {});
}

// Detect Tauri environment synchronously
const _isTauri = () => '__TAURI_INTERNALS__' in window;

// Cache the platform string so the OS plugin is only queried once.
// 'web' = not Tauri, 'android' = Android Tauri, 'macos'/'windows'/etc = desktop Tauri.
let _platformCache: string | null = null;

async function _getPlatform(): Promise<string> {
  if (_platformCache !== null) return _platformCache;
  if (!_isTauri()) return (_platformCache = 'web');
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    _platformCache = await platform();
  } catch {
    _platformCache = 'unknown';
  }
  return _platformCache;
}

interface ApiError {
  error: string;
  details?: unknown;
}

class ApiClient {
  private token: string | null = null;
  private onSessionExpired: (() => void) | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  // Set callback for when session expires (401 on authenticated routes)
  setOnSessionExpired(callback: (() => void) | null) {
    this.onSessionExpired = callback;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      ...options.headers,
    };

    // Only set Content-Type for requests with a body (not FormData)
    if (options.body && !(options.body instanceof FormData)) {
      (headers as Record<string, string>)['Content-Type'] = 'application/json';
    }

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // Handle expired session (401 on authenticated endpoints)
      if (response.status === 401 && this.token && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/signup')) {
        if (this.onSessionExpired) {
          this.onSessionExpired();
        }
        throw new Error('Session expired. Please log in again.');
      }

      const error: ApiError = await response.json().catch(() => ({
        error: 'An error occurred',
      }));
      throw new Error(error.error || 'Request failed');
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // Auth endpoints
  async signup(username: string, password: string, email?: string, secretCode?: string) {
    return this.request<{ user: User; token: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password, email, secretCode }),
    });
  }

  async login(username: string, password: string) {
    return this.request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async logout() {
    return this.request<{ message: string }>('/auth/logout', {
      method: 'POST',
    });
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async getMe() {
    return this.request<User>('/auth/me');
  }

  // Playlist endpoints
  async getPlaylists() {
    return this.request<Playlist[]>('/playlists');
  }

  async getPlaylist(id: string) {
    return this.request<PlaylistWithTracks>('/playlists/' + id);
  }

  async createPlaylist(name: string, description?: string) {
    return this.request<Playlist>('/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async updatePlaylist(id: string, data: { name?: string; description?: string }) {
    return this.request<Playlist>('/playlists/' + id, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deletePlaylist(id: string) {
    return this.request<void>('/playlists/' + id, {
      method: 'DELETE',
    });
  }

  async addTrackToPlaylist(playlistId: string, trackId: string) {
    return this.request<{ message: string }>(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    });
  }

  async removeTrackFromPlaylist(playlistId: string, trackId: string) {
    return this.request<void>(`/playlists/${playlistId}/tracks/${trackId}`, {
      method: 'DELETE',
    });
  }

  async reorderPlaylistTracks(playlistId: string, trackIds: string[]) {
    return this.request<{ message: string }>(`/playlists/${playlistId}/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ trackIds }),
    });
  }

  // Track endpoints
  async getTracks() {
    return this.request<Track[]>('/tracks');
  }

  async getTrack(id: string) {
    return this.request<Track>('/tracks/' + id);
  }

  async uploadTrack(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<Track>('/tracks', {
      method: 'POST',
      body: formData,
    });
  }

  async deleteTrack(id: string) {
    return this.request<void>('/tracks/' + id, {
      method: 'DELETE',
    });
  }

  async updateTrack(id: string, data: { title?: string; artist?: string; album?: string }) {
    return this.request<Track>('/tracks/' + id, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async checkDuplicates(tracks: Array<{ title: string; artist: string | null }>) {
    return this.request<DuplicateCheckResult>('/tracks/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({ tracks }),
    });
  }

  // Returns an audio-playable URL for a track.
  //
  // Strategy per platform:
  //   macOS/Windows/Linux (desktop Tauri) — custom stream:// URI scheme, proxied by Rust.
  //     Bypasses WKWebView ATS restrictions; supports Range requests; zero memory overhead.
  //   Android (Tauri) + Browser — fetch() + blob: URL.
  //     Android WebView blocks <audio src="http://..."> as mixed content (HTTPS page → HTTP
  //     audio). The stream:// custom protocol also doesn't work on Android because the
  //     Android media player bypasses shouldInterceptRequest for custom URI schemes.
  //     fetch() over HTTP is allowed (Tauri configures setMixedContentMode=ALWAYS_ALLOW
  //     for XHR/fetch), so fetching to a local blob: URL is the reliable path.
  async getSecureStreamUrl(id: string): Promise<string> {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (_isTauri()) {
      const platform = await _getPlatform();

      // Only use the stream:// Rust proxy on known desktop platforms where the WebView
      // intercepts custom URI schemes for all resource types (including media elements).
      if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
        // JWT tokens are Base64URL encoded — no percent-encoding needed.
        return `stream://audio/${id}?token=${this.token}`;
      }

      // Android (and any unrecognised platform): fall through to blob fetch below.
    }

    // Android Tauri + Browser: fetch with Authorization header, return local blob: URL.
    const fetchUrl = `${API_URL}/tracks/${id}/stream`;
    _dbg('info', `blob fetch: GET ${fetchUrl}`);
    const response = await fetch(fetchUrl, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    _dbg(response.ok ? 'info' : 'error', `blob fetch response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 401 && this.onSessionExpired) {
        this.onSessionExpired();
      }
      throw new Error('Failed to fetch audio stream');
    }

    const blob = await response.blob();
    _dbg('info', `blob ready: size=${blob.size} type="${blob.type}"`);
    return URL.createObjectURL(blob);
  }

  // Revoke a blob URL to free memory (no-op for stream:// URLs)
  revokeStreamUrl(url: string) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }

  // Legacy method for backwards compatibility (deprecated - use getSecureStreamUrl)
  getTrackStreamUrl(id: string) {
    // Include token as query param for HTML5 Audio element (can't send headers)
    const tokenParam = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    return `${API_URL}/tracks/${id}/stream${tokenParam}`;
  }

  async getSimilarTracks(id: string, limit = 20) {
    return this.request<SimilarTracksResponse>(`/tracks/${id}/similar?limit=${limit}`);
  }

  async analyzeAllTracks() {
    return this.request<{ message: string; analyzed: number; failed: number; total: number }>('/tracks/analyze-all', {
      method: 'POST',
    });
  }

  // User endpoints
  async updateUser(id: string, data: { username?: string; email?: string }) {
    return this.request<User>('/users/' + id, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async uploadAvatar(userId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<User>(`/users/${userId}/avatar`, {
      method: 'POST',
      body: formData,
    });
  }

  // Playlist cover upload
  async uploadPlaylistCover(playlistId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    return this.request<Playlist>(`/playlists/${playlistId}/cover`, {
      method: 'POST',
      body: formData,
    });
  }

  // Search endpoints
  async search(query: string, type: 'all' | 'tracks' | 'playlists' = 'all') {
    const params = new URLSearchParams({ q: query, type });
    return this.request<SearchResults>('/search?' + params.toString());
  }

  async getAllTracks(limit = 50, offset = 0) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    return this.request<{ tracks: Track[]; total: number; limit: number; offset: number }>(
      '/search/tracks?' + params.toString()
    );
  }

  // Admin endpoints
  async getAdminStats() {
    return this.request<AdminStats>('/admin/stats');
  }

  async getAdminUsers() {
    return this.request<AdminUser[]>('/admin/users');
  }

  async getInviteCodes() {
    return this.request<InviteCode[]>('/admin/invite-codes');
  }

  async createInviteCode(data: { code?: string; maxUses?: number | null; expiresAt?: string | null }) {
    return this.request<InviteCode>('/admin/invite-codes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateInviteCode(id: string, data: { maxUses?: number | null; isActive?: boolean; expiresAt?: string | null }) {
    return this.request<InviteCode>('/admin/invite-codes/' + id, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteInviteCode(id: string) {
    return this.request<void>('/admin/invite-codes/' + id, {
      method: 'DELETE',
    });
  }

  // Favorites endpoints
  async getFavorites() {
    return this.request<FavoriteWithTrack[]>('/favorites');
  }

  async getFavoriteIds() {
    return this.request<{ trackIds: string[] }>('/favorites/ids');
  }

  async addFavorite(trackId: string) {
    return this.request<Favorite>('/favorites/' + trackId, {
      method: 'POST',
    });
  }

  async removeFavorite(trackId: string) {
    return this.request<void>('/favorites/' + trackId, {
      method: 'DELETE',
    });
  }

  async checkFavorite(trackId: string) {
    return this.request<{ isFavorited: boolean }>('/favorites/' + trackId + '/check');
  }

  // History endpoints
  async getHistory() {
    return this.request<HistoryEntry[]>('/history');
  }

  async logPlay(trackId: string) {
    return this.request<{ message: string; id: string }>('/history', {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    });
  }

  async clearHistory() {
    return this.request<void>('/history', {
      method: 'DELETE',
    });
  }
}

// Types
export interface User {
  id: string;
  username: string;
  email: string | null;
  profileImage: string | null;
  isAdmin?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  coverImage: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number;
  filePath: string;
  originalFilename: string | null;
  // Audio analysis fields for Radio mode
  bpm: number | null;
  key: string | null;
  energy: number | null;
  userId: string;
  createdAt: string;
}

export interface SimilarTracksResponse {
  sourceTrack: Track;
  similarTracks: (Track & { similarityScore: number })[];
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export interface SearchResults {
  tracks: Track[];
  playlists: Playlist[];
}

export interface AdminStats {
  users: number;
  tracks: number;
  playlists: number;
  inviteCodes: number;
  activeInviteCodes: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  profileImage: string | null;
  createdAt: string;
  trackCount: number;
  playlistCount: number;
}

export interface InviteCode {
  id: string;
  code: string;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface DuplicateInfo {
  title: string;
  artist: string | null;
  existingTrackId: string;
  existingTrack: Track;
}

export interface DuplicateCheckResult {
  duplicates: DuplicateInfo[];
}

export interface Favorite {
  id: string;
  userId: string;
  trackId: string;
  addedAt: string;
}

export interface FavoriteWithTrack extends Favorite {
  track: Track;
}

export interface HistoryEntry {
  id: string;
  trackId: string;
  playedAt: string;
  track: Track;
}

export const api = new ApiClient();
