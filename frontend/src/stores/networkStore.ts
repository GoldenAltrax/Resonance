import { create } from 'zustand';

interface NetworkState {
  isOnline: boolean;
  isServerReachable: boolean;
  _pingInterval: ReturnType<typeof setInterval> | null;
  startMonitoring: () => void;
  stopMonitoring: () => void;
}

const HEALTH_URL = '/api/health';
const PING_INTERVAL_MS = 30_000;

async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  isOnline: navigator.onLine,
  isServerReachable: true,
  _pingInterval: null,

  startMonitoring() {
    const handleOnline = () => {
      set({ isOnline: true });
      pingServer().then((ok) => set({ isServerReachable: ok }));
    };
    const handleOffline = () => set({ isOnline: false, isServerReachable: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial ping
    pingServer().then((ok) => set({ isServerReachable: ok }));

    // Periodic ping
    const interval = setInterval(async () => {
      if (!navigator.onLine) {
        set({ isOnline: false, isServerReachable: false });
        return;
      }
      const ok = await pingServer();
      set({ isOnline: navigator.onLine, isServerReachable: ok });
    }, PING_INTERVAL_MS);

    set({ _pingInterval: interval });
  },

  stopMonitoring() {
    const { _pingInterval } = get();
    if (_pingInterval !== null) {
      clearInterval(_pingInterval);
      set({ _pingInterval: null });
    }
  },
}));
