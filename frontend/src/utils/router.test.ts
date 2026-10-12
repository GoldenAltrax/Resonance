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

  it('falls back to home for unknown paths', () => {
    expect(parseRoute('/nope')).toEqual({ page: 'home' });
  });
});
