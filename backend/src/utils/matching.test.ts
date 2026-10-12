import { describe, it, expect } from 'vitest';
import { normalizeTitle, splitArtists, songKey, scoreCandidate, pickBest, parseVideoTitle } from './matching.js';

describe('normalizeTitle', () => {
  it('drops featuring credits, accents and punctuation', () => {
    expect(normalizeTitle('Get Lucky (feat. Pharrell Williams & Nile Rodgers)')).toBe('get lucky');
    expect(normalizeTitle('Beyoncé — Halo!')).toBe('beyonce halo');
    expect(normalizeTitle('Song ft. Someone')).toBe('song');
  });
});

describe('splitArtists / songKey', () => {
  it('splits common credit separators', () => {
    expect(splitArtists('Daft Punk, Pharrell Williams & Nile Rodgers')).toEqual(['daft punk', 'pharrell williams', 'nile rodgers']);
  });

  it('matches the same song across sources', () => {
    expect(songKey('Get Lucky', 'Daft Punk, Pharrell Williams & Nile Rodgers'))
      .toBe(songKey('Get Lucky (feat. Pharrell Williams and Nile Rodgers)', 'Daft Punk'));
  });
});

describe('scoreCandidate', () => {
  const request = { title: 'Get Lucky', artist: 'Daft Punk', duration: 248 };

  it('prefers the official song with the right length', () => {
    const radioEdit = { title: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)', artists: ['Daft Punk'], duration: 248 };
    const album = { title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)', artists: ['Daft Punk'], duration: 370 };
    expect(scoreCandidate(request, album)).toBe(-1); // album version is 2 minutes longer
    expect(pickBest(request, [album, radioEdit])).toBe(radioEdit);
  });

  it('rejects live versions and remixes unless asked for', () => {
    expect(scoreCandidate(request, { title: 'Get Lucky (Live)', artists: ['Daft Punk'], duration: 250 })).toBe(-1);
    expect(scoreCandidate(request, { title: 'Get Lucky (Remix)', duration: 248 })).toBe(-1);
    expect(scoreCandidate({ ...request, title: 'Get Lucky (Remix)' }, { title: 'Get Lucky (Remix)', duration: 248 })).toBeGreaterThan(0);
  });

  it('rejects unrelated titles', () => {
    expect(scoreCandidate(request, { title: 'Instant Crush', artists: ['Daft Punk'], duration: 248 })).toBe(-1);
  });

  it('accepts a matching upload on the artist channel when length is unknown', () => {
    const best = pickBest({ title: 'Get Lucky', artist: 'Daft Punk' }, [
      { title: 'Daft Punk - Get Lucky (Official Audio)', channel: 'Daft Punk', duration: 249 },
    ]);
    expect(best).not.toBeNull();
  });
});

describe('parseVideoTitle', () => {
  it('splits "Artist - Title" and strips video labels', () => {
    expect(parseVideoTitle('Daft Punk - Get Lucky (Official Audio)')).toEqual({ artist: 'Daft Punk', title: 'Get Lucky' });
  });

  it('handles real-world upload titles', () => {
    expect(parseVideoTitle('BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma')).toEqual({ artist: 'Peso Pluma, Anitta', title: 'BELLAKEO' });
    expect(parseVideoTitle('Arcángel - FN8 ( Video Lyric )', 'Arcangel')).toEqual({ artist: 'Arcángel', title: 'FN8' });
    expect(parseVideoTitle('Real Boston Richey - The Type (Official Music Video) ft. YTB Fatt')).toEqual({ artist: 'Real Boston Richey', title: 'The Type' });
    expect(parseVideoTitle('Finesse2Tymes - Crazy [Official Music Video]')).toEqual({ artist: 'Finesse2Tymes', title: 'Crazy' });
    expect(parseVideoTitle('La Diabla', 'Xavi Oficial')).toEqual({ artist: 'Xavi', title: 'La Diabla' });
  });

  it('falls back to the channel name', () => {
    expect(parseVideoTitle('Get Lucky', 'Daft Punk - Topic')).toEqual({ artist: 'Daft Punk', title: 'Get Lucky' });
  });
});
