import { describe, it, expect } from 'vitest';
import {
  artistNames, similarity, preference, spaceArtists, pickStation, CrowdTally,
  type RadioTrack, type SeedSignals, type UserSignals,
} from './radio.js';

const t = (id: string, artist: string | null, extra: Partial<RadioTrack> = {}): RadioTrack => ({
  id, artist, album: null, bpm: null, key: null, energy: null, loudness: null, ...extra,
});

const noSignals = (): SeedSignals => ({
  coPlaylist: new Map(), coPlay: new Map(), artistAffinity: new Map(), coAdded: new Map(),
});
const noUser = (overrides: Partial<UserSignals> = {}): UserSignals => ({
  favorites: new Set(), playCounts: new Map(), lastPlayed: new Map(), earlySkips: new Map(),
  recentArtists: new Set(), now: Date.now(), ...overrides,
});

// Deterministic PRNG (mulberry32)
const seeded = (seed: number) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

describe('artistNames', () => {
  it('splits collaborations and features', () => {
    expect(artistNames('Arijit Singh, Shreya Ghoshal & Pritam feat. Badshah')).toEqual([
      'arijit singh', 'shreya ghoshal', 'pritam', 'badshah',
    ]);
    expect(artistNames(null)).toEqual([]);
  });
});

describe('similarity', () => {
  it('scores nothing for unknown tempo, key and energy', () => {
    expect(similarity(t('s', null), t('x', null), noSignals())).toBe(0);
  });

  it('ranks same lead artist above a featured artist above a stranger', () => {
    const seed = t('s', 'Pritam');
    const same = similarity(seed, t('a', 'Pritam, Arijit Singh'), noSignals());
    const featured = similarity(seed, t('b', 'Arijit Singh feat. Pritam'), noSignals());
    const stranger = similarity(seed, t('c', 'Coldplay'), noSignals());
    expect(same).toBeGreaterThan(featured);
    expect(featured).toBeGreaterThan(stranger);
  });

  it('uses shared playlists, co-plays and artist affinity', () => {
    const signals: SeedSignals = {
      coPlaylist: new Map([['a', 2]]),
      coPlay: new Map([['b', 3]]),
      artistAffinity: new Map([['coldplay', 1]]),
      coAdded: new Map([['d', 0.5]]),
    };
    const seed = t('s', 'Pritam');
    expect(similarity(seed, t('a', 'X'), signals)).toBe(20);
    expect(similarity(seed, t('b', 'Y'), signals)).toBe(15);
    expect(similarity(seed, t('c', 'Coldplay'), signals)).toBe(6);
    expect(similarity(seed, t('d', 'Z'), signals)).toBe(4);
  });

  it('prefers similar mastering loudness, falling back to energy', () => {
    const seed = t('s', null, { loudness: -8, energy: 70 });
    expect(similarity(seed, t('a', null, { loudness: -8.5 }), noSignals())).toBe(9);
    expect(similarity(seed, t('b', null, { loudness: -15 }), noSignals())).toBe(0);
    expect(similarity(seed, t('c', null, { energy: 75 }), noSignals())).toBe(6);
  });

  it('rewards close tempo and compatible keys when both are known', () => {
    const seed = t('s', null, { bpm: 120, key: 'C' });
    expect(similarity(seed, t('a', null, { bpm: 123, key: 'Am' }), noSignals())).toBe(15 + 6);
    expect(similarity(seed, t('b', null, { bpm: 150, key: 'F#' }), noSignals())).toBe(0);
  });
});

describe('preference', () => {
  const now = Date.now();
  it('penalizes what was just heard and boosts old favourites', () => {
    const user = noUser({
      now,
      lastPlayed: new Map([['recent', now - 30 * 60 * 1000], ['old', now - 7 * 24 * 3600 * 1000]]),
      playCounts: new Map([['recent', 5], ['old', 5]]),
      favorites: new Set(['old']),
    });
    expect(preference(t('recent', null), user)).toBe(-40);
    expect(preference(t('old', null), user)).toBe(12 + 10);
  });

  it('penalizes repeated early skips and recent artists', () => {
    const user = noUser({ earlySkips: new Map([['a', 3]]), recentArtists: new Set(['pritam']) });
    expect(preference(t('a', null), user)).toBe(-20);
    expect(preference(t('b', 'Pritam & Arijit Singh'), user)).toBe(-15);
  });
});

describe('spaceArtists', () => {
  it('avoids the same artist back to back when possible', () => {
    const list = [t('1', 'A'), t('2', 'A'), t('3', 'A'), t('4', 'B'), t('5', 'B'), t('6', 'C')];
    const spaced = spaceArtists(list);
    for (let i = 1; i < spaced.length; i++) {
      expect(spaced[i]!.artist === spaced[i - 1]!.artist).toBe(false);
    }
  });

  it('spreads a dominant artist instead of leaving them clumped at the end', () => {
    const list = [t('1', 'B'), t('2', 'C'), t('3', 'D'), t('4', 'E'), ...['5', '6', '7', '8', '9', '10'].map((id) => t(id, 'P'))];
    const spaced = spaceArtists(list);
    let adjacent = 0;
    for (let i = 1; i < spaced.length; i++) if (spaced[i]!.artist === spaced[i - 1]!.artist) adjacent++;
    expect(adjacent).toBe(1); // 6 of 10 by one artist: one pair is unavoidable
  });

  it('respects the artist that played last', () => {
    expect(spaceArtists([t('1', 'A'), t('2', 'B')], 'a')[0]!.id).toBe('2');
  });
});

describe('pickStation', () => {
  it('leans toward high scores without always picking them', () => {
    const scored = [
      ...Array.from({ length: 30 }, (_, i) => ({ track: t(`hi${i}`, `H${i}`), score: 30 })),
      ...Array.from({ length: 30 }, (_, i) => ({ track: t(`mid${i}`, `M${i}`), score: 20 })),
    ];
    const rng = seeded(1);
    let high = 0;
    for (let run = 0; run < 200; run++) {
      high += pickStation(scored, 10, { rng }).filter((s) => s.track.id.startsWith('hi')).length;
    }
    // e^1 ≈ 2.7× per draw: mostly high, but mid tracks get real airtime
    expect(high / 2000).toBeGreaterThan(0.6);
    expect(high / 2000).toBeLessThan(0.95);
  });

  it('draws from the real fits even in a big library of weak ones', () => {
    const scored = [
      ...Array.from({ length: 30 }, (_, i) => ({ track: t(`good${i}`, `G${i}`), score: 30 })),
      ...Array.from({ length: 600 }, (_, i) => ({ track: t(`weak${i}`, `W${i}`), score: 2 })),
    ];
    const station = pickStation(scored, 25, { rng: seeded(5) });
    expect(station.every((s) => s.track.id.startsWith('good'))).toBe(true);
  });

  it('mixes one dominant artist with others instead of filling up with them', () => {
    const scored = [
      ...Array.from({ length: 30 }, (_, i) => ({ track: t(`k${i}`, 'Kishore Kumar'), score: 37 })),
      ...Array.from({ length: 15 }, (_, i) => ({ track: t(`o${i}`, `Other ${i}`), score: 24 })),
    ];
    const station = pickStation(scored, 20, { rng: seeded(6) });
    const kishore = station.filter((s) => s.track.artist === 'Kishore Kumar').length;
    expect(kishore).toBeGreaterThan(4);
    expect(kishore).toBeLessThan(15);
  });

  it('returns just the real fits rather than padding with weak matches', () => {
    const scored = [
      ...Array.from({ length: 12 }, (_, i) => ({ track: t(`good${i}`, `G${i}`), score: 30 })),
      ...Array.from({ length: 100 }, (_, i) => ({ track: t(`weak${i}`, `W${i}`), score: 2 })),
    ];
    const station = pickStation(scored, 25, { rng: seeded(8) });
    expect(station).toHaveLength(12);
    expect(station.every((s) => s.track.id.startsWith('good'))).toBe(true);
  });

  it('still mixes in other artists when one artist fills the top of the ranking', () => {
    const scored = [
      ...Array.from({ length: 60 }, (_, i) => ({ track: t(`p${i}`, 'Pritam'), score: 37 })),
      ...Array.from({ length: 20 }, (_, i) => ({ track: t(`a${i}`, `Arijit ${i}`), score: 24 })),
    ];
    const station = pickStation(scored, 10, { rng: seeded(9) });
    const others = station.filter((s) => s.track.id.startsWith('a')).length;
    expect(others).toBeGreaterThanOrEqual(3);
  });

  it('caps one lead artist even when they are nearly all of the strong matches', () => {
    const scored = [
      ...Array.from({ length: 18 }, (_, i) => ({ track: t(`k${i}`, 'Kishore Kumar'), score: 37 })),
      ...Array.from({ length: 4 }, (_, i) => ({ track: t(`o${i}`, `Other ${i}`), score: 24 })),
      ...Array.from({ length: 100 }, (_, i) => ({ track: t(`w${i}`, `Weak ${i}`), score: 2 })),
    ];
    const station = pickStation(scored, 25, { rng: seeded(10) });
    const kishore = station.filter((s) => s.track.artist === 'Kishore Kumar').length;
    expect(kishore).toBe(9); // ceil(25 × 0.35)
    expect(station.some((s) => s.track.id.startsWith('w'))).toBe(false); // short batch, no padding
  });

  it('picks each song once and skips blocked ones', () => {
    const scored = [
      { track: t('a1', 'A'), score: 30 },
      { track: t('a2', 'A'), score: 30 },
      { track: t('b', 'B'), score: 10 },
      { track: t('c', 'C'), score: 10 },
    ];
    const songKey = (x: RadioTrack) => (x.id.startsWith('a') ? 'song-a' : x.id);
    const station = pickStation(scored, 10, { rng: seeded(7), songKey, blockedSongs: new Set(['c']) });
    expect(station.map((s) => s.track.id).sort()).toEqual([expect.stringMatching(/^a/), 'b']);
  });

  it('returns a short station when the library is small', () => {
    expect(pickStation([{ track: t('a', 'A'), score: 1 }], 25)).toHaveLength(1);
    expect(pickStation([], 25)).toEqual([]);
  });
});

describe('CrowdTally', () => {
  it('always counts my own data', () => {
    const tally = new CrowdTally('me');
    tally.add('a', 2, 'me');
    expect(tally.totals().get('a')).toBe(2);
  });

  it("ignores one other person's data, so it can't be read back", () => {
    const tally = new CrowdTally('me');
    tally.add('a', 5, 'bob');
    tally.add('a', 1, 'bob');
    expect(tally.totals().has('a')).toBe(false);
  });

  it('counts other people once two of them agree', () => {
    const tally = new CrowdTally('me');
    tally.add('a', 1, 'me');
    tally.add('a', 2, 'bob');
    tally.add('a', 3, 'carol');
    expect(tally.totals().get('a')).toBe(6);
  });
});
