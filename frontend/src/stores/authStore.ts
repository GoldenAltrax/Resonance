import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, HttpError, User } from '@/services/api';
import { toast } from '@/stores/toastStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useFavoritesStore } from '@/stores/favoritesStore';

// Forget everything tied to the previous account: playback session, favorites, cached API data.
// Without this the next person to sign in on the device inherits the old queue.
function clearUserSession() {
  usePlayerStore.getState().reset();
  useFavoritesStore.getState().clearFavorites();
  try { localStorage.removeItem('resonance-resume'); } catch { /* ignore */ }
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
          // Offline / server unreachable: keep the stored session so the app shell still works
          if (!(err instanceof HttpError)) {
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
    }
  )
);
