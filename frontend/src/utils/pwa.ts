/**
 * Service worker registration + update flow.
 * A new deploy installs a new worker in the background; the app shows a "new version"
 * prompt and only activates it when the user agrees (never mid-song without asking).
 */
type Listener = (waiting: ServiceWorker) => void;

let waitingWorker: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function announce(worker: ServiceWorker) {
  waitingWorker = worker;
  listeners.forEach((l) => l(worker));
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  if (waitingWorker) listener(waitingWorker);
  return () => listeners.delete(listener);
}

export function applyUpdate() {
  if (!waitingWorker) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');

      if (registration.waiting && navigator.serviceWorker.controller) {
        announce(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A controller already exists → this is an update, not the first install
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announce(installing);
          }
        });
      });

      // Long-lived sessions (the player is often left open for hours): check hourly
      setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  });
}
