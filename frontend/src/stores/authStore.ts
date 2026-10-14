import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, HttpError, User, STREAM_TOKEN_REPLACED } from '@/services/api';
import { toast } from '@/stores/toastStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePlaylistStore } from '@/stores/playlistStore';

// Forget everything tied to the previous account: playback session, favorites, cached API data.
// Without this the next person to sign in on the device inherits the old queue.
function clearUserSession() {
  usePlayerStore.getState().reset();
  useFavoritesStore.getState().clearFavorites();
  usePlaylistStore.setState({ playlists: [], currentPlaylist: null });
  try {
    localStorage.removeItem('resonance-resume');
    localStorage.removeItem('resonance_recent_searches');
  } catch { /* ignore */ }
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_API_CACHE' });
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;

  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, email?: string, secretCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateProfile: (data: { username?: string; email?: string }) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  clearError: () => void;
  handleSessionExpired: () => void;
  /** Swap in a token issued after the current one was revoked (password change). */
  replaceToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      sessionExpired: false,

      handleSessionExpired: () => {
        // Clear auth state and show message
        api.setToken(null);
        clearUserSession();
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          sessionExpired: true,
          error: null,
        });
        toast.warning('Session expired. Please log in again.');
      },

      replaceToken: (token: string) => {
        api.setToken(token);
        set({ token });
        // Loaded audio still streams with the revoked token in its URL; the player reloads it
        window.dispatchEvent(new Event(STREAM_TOKEN_REPLACED));
      },

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null, sessionExpired: false });
        try {
          const response = await api.login(username, password);
          api.setToken(response.token);
          // Set up session expired callback
          api.setOnSessionExpired(() => get().handleSessionExpired());
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          });
          throw err;
        }
      },

      signup: async (username: string, password: string, email?: string, secretCode?: string) => {
        set({ isLoading: true, error: null, sessionExpired: false });
        try {
          const response = await api.signup(username, password, email, secretCode);
          api.setToken(response.token);
          // Set up session expired callback
          api.setOnSessionExpired(() => get().handleSessionExpired());
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Signup failed',
            isLoading: false,
          });
          throw err;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await api.logout();
        } catch {
          // Ignore logout errors
        } finally {
          api.setToken(null);
          api.setOnSessionExpired(null);
          clearUserSession();
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
            sessionExpired: false,
          });
        }
      },

      checkAuth: async () => {
        const { token } = get();
        if (!token) {
          set({ isAuthenticated: false });
          return;
        }

        api.setToken(token);
        // Set up session expired callback for restored sessions
        api.setOnSessionExpired(() => get().handleSessionExpired());
        try {
          const { token: refreshed, ...user } = await api.getMe();
          // Sliding session: the server re-issues a fresh token on every app start
          if (refreshed) api.setToken(refreshed);
          set({ user, token: refreshed ?? token, isAuthenticated: true, sessionExpired: false });
        } catch (err) {
          // Only a 401 means the session is over (handleSessionExpired has already run).
          // Offline, a 502 while the server restarts for a deploy, or a 429: keep the stored
          // session so the app shell still works and the next start signs in normally.
          if (!(err instanceof HttpError) || err.status !== 401) {
            set({ isAuthenticated: true });
            return;
          }
          api.setToken(null);
          api.setOnSessionExpired(null);
          set({
            user: null,
            token: null,
            isAuthenticated: false,
          });
        }
      },

      updateProfile: async (data: { username?: string; email?: string }) => {
        const { user } = get();
        if (!user) throw new Error('Not authenticated');

        set({ isLoading: true, error: null });
        try {
          const updatedUser = await api.updateUser(user.id, data);
          set({ user: updatedUser, isLoading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to update profile',
            isLoading: false,
          });
          throw err;
        }
      },

      uploadAvatar: async (file: File) => {
        const { user } = get();
        if (!user) throw new Error('Not authenticated');

        set({ isLoading: true, error: null });
        try {
          const updatedUser = await api.uploadAvatar(user.id, file);
          set({ user: updatedUser, isLoading: false });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to upload avatar',
            isLoading: false,
          });
          throw err;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'resonance-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
      // Hand the saved token to the API client straight away: the player restores the last
      // track on page load, before checkAuth runs, and its stream URL needs the token
      onRehydrateStorage: () => (state) => {
        if (state?.token) api.setToken(state.token);
      },
    }
  )
);
