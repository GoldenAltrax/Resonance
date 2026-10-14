import { useSyncExternalStore } from 'react';
import type { AdminTab, Page } from '@/types';

/**
 * Minimal History-API router (no dependency). Gives every page a real URL so the
 * back button, refresh, deep links and PWA shortcuts work.
 */
export interface Route {
  page: Page;
  playlistId?: string;
  /** Admin Panel tab, from /admin/<tab> */
  adminTab?: AdminTab;
  /** Album name, from /albums/<name> */
  album?: string;
}

export const ADMIN_TABS: AdminTab[] = ['overview', 'users', 'invites', 'add-music', 'assistant', 'usage', 'maintenance'];

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

/** `param` is the playlist id for playlist-detail, the tab for admin, or the album name for albums. */
export function pathFor(page: Page, param?: string): string {
  if (page === 'playlist-detail') return param ? `/playlists/${encodeURIComponent(param)}` : '/playlists';
  if (page === 'albums' && param) return `/albums/${encodeURIComponent(param)}`;
  if (page === 'admin' && param && param !== 'overview') return `/admin/${param}`;
  return STATIC_PATHS[page];
}

/** decodeURIComponent that keeps a malformed segment (e.g. a typed "100%") as-is instead of throwing during render. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const detail = path.match(/^\/playlists\/([^/]+)$/);
  if (detail?.[1]) return { page: 'playlist-detail', playlistId: decodeSegment(detail[1]) };
  const album = path.match(/^\/albums\/(.+)$/);
  if (album?.[1]) return { page: 'albums', album: decodeSegment(album[1]) };
  const admin = path.match(/^\/admin\/([\w-]+)$/);
  if (admin?.[1] && (ADMIN_TABS as string[]).includes(admin[1])) return { page: 'admin', adminTab: admin[1] as AdminTab };
  // Add music used to be its own page
  if (path === '/add') return { page: 'admin', adminTab: 'add-music' };
  const page = (Object.keys(STATIC_PATHS) as (keyof typeof STATIC_PATHS)[]).find(
    (p) => STATIC_PATHS[p] === path
  );
  return { page: page ?? 'home' };
}

export function navigate(page: Page, param?: string) {
  const path = pathFor(page, param);
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
