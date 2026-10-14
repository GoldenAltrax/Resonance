import { describe, it, expect, beforeEach, vi } from 'vitest';

const getMe = vi.fn();
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    api: { setToken: vi.fn(), setOnSessionExpired: vi.fn(), getMe },
  };
});
vi.mock('@/services/audioEngine', () => ({ audioEngine: { reset: vi.fn(), seek: vi.fn() } }));

const { useAuthStore } = await import('@/stores/authStore');
const { HttpError } = await import('@/services/api');

const user = { id: 'u1', username: 'me', email: null, profileImage: null, isAdmin: false };

beforeEach(() => {
  getMe.mockReset();
  useAuthStore.setState({ token: 'stored', user, isAuthenticated: false });
});

describe('checkAuth', () => {
  it('keeps the session when the server is restarting (502)', async () => {
    getMe.mockRejectedValueOnce(new HttpError(502, { error: 'Bad gateway' }));
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().token).toBe('stored');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('keeps the session when offline', async () => {
    getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().token).toBe('stored');
  });

  it('signs out when the token is rejected (401)', async () => {
    getMe.mockRejectedValueOnce(new HttpError(401, { error: 'Unauthorized' }));
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('takes the refreshed token on success', async () => {
    getMe.mockResolvedValueOnce({ ...user, token: 'fresh' });
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().token).toBe('fresh');
  });
});
