import { describe, it, expect } from 'vitest';
import { parseRoute, pathFor } from '@/utils/router';

describe('router', () => {
  it('maps static paths both ways', () => {
    expect(pathFor('library')).toBe('/library');
    expect(parseRoute('/library')).toEqual({ page: 'library' });
    expect(parseRoute('/')).toEqual({ page: 'home' });
  });

  it('ignores trailing slashes', () => {
    expect(parseRoute('/settings/')).toEqual({ page: 'settings' });
  });

  it('round-trips playlist ids, including ones that need encoding', () => {
    const id = 'a b/c';
    expect(parseRoute(pathFor('playlist-detail', id))).toEqual({ page: 'playlist-detail', playlistId: id });
  });

  it('maps admin tabs, including the old Add music path', () => {
    expect(parseRoute(pathFor('admin', 'usage'))).toEqual({ page: 'admin', adminTab: 'usage' });
    expect(pathFor('admin', 'overview')).toBe('/admin');
    expect(parseRoute('/add')).toEqual({ page: 'admin', adminTab: 'add-music' });
    expect(parseRoute('/admin/nope')).toEqual({ page: 'home' });
  });

  it('round-trips album names, including ones with slashes and spaces', () => {
    const album = 'Rock On!! / Live';
    expect(parseRoute(pathFor('albums', album))).toEqual({ page: 'albums', album });
    expect(pathFor('albums')).toBe('/albums');
  });

  it('falls back to home for unknown paths', () => {
    expect(parseRoute('/nope')).toEqual({ page: 'home' });
  });
});
