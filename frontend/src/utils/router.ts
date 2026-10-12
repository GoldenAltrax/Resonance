import { useSyncExternalStore } from 'react';
import type { Page } from '@/types';

/**
 * Minimal History-API router (no dependency). Gives every page a real URL so the
 * back button, refresh, deep links and PWA shortcuts work.
 */
export interface Route {
  page: Page;
  playlistId?: string;
}

const STATIC_PATHS: Record<Exclude<Page, 'playlist-detail'>, string> = {
  home: '/',
  library: '/library',
  liked: '/liked',
  playlists: '/playlists',
  search: '/search',
  settings: '/settings',
  admin: '/admin',
  albums: '/albums',
};

const ROUTE_CHANGE = 'resonance:navigate';

export function pathFor(page: Page, playlistId?: string): string {
  if (page === 'playlist-detail') return playlistId ? `/playlists/${encodeURIComponent(playlistId)}` : '/playlists';
  return STATIC_PATHS[page];
}

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const detail = path.match(/^\/playlists\/([^/]+)$/);
  if (detail?.[1]) return { page: 'playlist-detail', playlistId: decodeURIComponent(detail[1]) };
  const page = (Object.keys(STATIC_PATHS) as (keyof typeof STATIC_PATHS)[]).find(
    (p) => STATIC_PATHS[p] === path
  );
  return { page: page ?? 'home' };
}

export function navigate(page: Page, playlistId?: string) {
  const path = pathFor(page, playlistId);
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new Event(ROUTE_CHANGE));
}

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  window.addEventListener(ROUTE_CHANGE, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(ROUTE_CHANGE, callback);
  };
}

// Snapshot is the pathname string (stable between renders); parse in the hook.
const getPath = () => location.pathname;

let cachedPath = '';
let cachedRoute: Route = { page: 'home' };

/** Current route; the returned object is stable until the URL changes. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, getPath);
  if (path !== cachedPath) {
    cachedPath = path;
    cachedRoute = parseRoute(path);
  }
  return cachedRoute;
}

/** Subscribes to a CSS media query, e.g. useMediaQuery('(min-width: 768px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches
  );
}
