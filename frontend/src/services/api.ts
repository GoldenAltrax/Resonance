import { DuplicateError } from '@/types/index';
import type { AcousticDuplicate } from '@/types/index';

// Use environment variable for API URL, fallback to relative path for dev proxy
const API_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiErrorBody {
  error?: string;
  details?: unknown;
  [key: string]: unknown;
}

/** Error thrown for non-2xx responses; keeps the status and parsed body for callers that need them. */
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: ApiErrorBody) {
    super(body.error || 'Request failed');
    this.name = 'HttpError';
  }
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
        throw new HttpError(401, { error: 'Session expired. Please log in again.' });
      }

      const body: ApiErrorBody = await response.json().catch(() => ({
        error: 'An error occurred',
      }));
      throw new HttpError(response.status, body);
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
    return this.request<User & { token?: string }>('/auth/me');
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

  async uploadTrack(file: File): Promise<Track> {
    const formData = new FormData();
    formData.append('file', file);
    try {
      return await this.request<Track>('/tracks', { method: 'POST', body: formData });
    } catch (err) {
      if (err instanceof HttpError && err.status === 409 && err.body.duplicate) {
        throw new DuplicateError(err.body.duplicate as AcousticDuplicate);
      }
      throw err;
    }
  }

  async uploadTrackForce(file: File): Promise<Track> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<Track>('/tracks?force=true', {
      method: 'POST',
      body: formData,
    });
  }

  async fingerprintAll() {
    return this.request<{ message: string; processed?: number; total: number }>(
      '/tracks/fingerprint-all',
      { method: 'POST' }
    );
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

  // Audio elements can't send an Authorization header, so the token goes in the query
  // string. The server streams the file with Range support (seeking, progressive playback).
  getStreamUrl(id: string): string {
    const token = this.token ? `?token=${encodeURIComponent(this.token)}` : '';
    return `${API_URL}/tracks/${id}/stream${token}`;
  }

  async getSimilarTracks(id: string, options?: { limit?: number; excludeIds?: string; recentArtists?: string }) {
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? 30));
    if (options?.excludeIds) params.set('excludeIds', options.excludeIds);
    if (options?.recentArtists) params.set('recentArtists', options.recentArtists);
    return this.request<SimilarTracksResponse>(`/tracks/${id}/similar?${params.toString()}`);
  }

  async getEmbeddedLyrics(id: string) {
    return this.request<{ lyrics: string | null; synced: { time: number; text: string }[] | null }>(
      `/tracks/${id}/lyrics`
    );
  }

  async logSkip(id: string, position: number) {
    return this.request<{ ok: boolean }>(`/tracks/${id}/skip`, {
      method: 'POST',
      body: JSON.stringify({ position }),
    });
  }

  async analyzeAllTracks() {
    return this.request<{ message: string; analyzed: number; failed: number; total: number }>('/tracks/analyze-all', {
      method: 'POST',
    });
  }

  async getAlbums() {
    const res = await this.request<{ albums: AlbumSummary[] }>('/tracks/albums');
    return res.albums;
  }

  // Returns the base URL for uploaded files (strips /api suffix from API_URL).
  // e.g. if API_URL = 'https://server.com/api', this returns 'https://server.com'.
  // e.g. if API_URL = '/api' (dev proxy), this returns '' (relative URLs work fine).
  private get uploadBase(): string {
    return API_URL.replace(/\/api$/, '');
  }

  // Returns the URL for an uploaded image (cover art, profile image, playlist cover).
  // Images are public and UUID-named, so URLs are stable and cacheable (no token).
  // Pass { bust: true } to append a cache-busting timestamp (e.g. after upload).
  getUploadUrl(path: string, opts?: { bust?: boolean }): string {
    const query = opts?.bust ? `?t=${Date.now()}` : '';
    return `${this.uploadBase}/uploads/${path}${query}`;
  }

  // Alias kept for callers that pass coverArt directly.
  getTrackCoverUrl(coverArt: string): string {
    return this.getUploadUrl(coverArt);
  }

  // User preferences (cross-device sync)
  async getPreferences(userId: string): Promise<UserPreferences | null> {
    const res = await this.request<{ preferences: UserPreferences | null }>(`/users/${userId}/preferences`);
    return res.preferences;
  }

  async updatePreferences(userId: string, prefs: UserPreferences): Promise<void> {
    await this.request<{ ok: boolean }>(`/users/${userId}/preferences`, {
      method: 'PUT',
      body: JSON.stringify(prefs),
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
export interface UserPreferences {
  volume?: number;
  isMuted?: boolean;
  shuffle?: boolean;
  repeat?: 'none' | 'one' | 'all';
  crossfadeEnabled?: boolean;
  crossfadeDuration?: number;
  eqEnabled?: boolean;
  eqGains?: number[];
  eqPreset?: string;
}

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
  coverArt: string | null;
  // Audio analysis fields for Radio mode
  bpm: number | null;
  key: string | null;
  energy: number | null;
  userId: string;
  createdAt: string;
}

export interface AlbumSummary {
  album: string;
  artist: string | null;
  trackCount: number;
  coverArt: string | null;
  tracks: Track[];
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
