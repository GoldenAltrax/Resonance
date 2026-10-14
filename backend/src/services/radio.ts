import { splitArtists } from '../utils/matching.js';

/**
 * Radio: picks tracks that fit after a seed track.
 *
 * A track's score is how similar it is to the seed (artist, shared playlists, co-plays,
 * then tempo/key/energy when known) plus how much this user likes it, minus penalties
 * for things just heard. The pick is a weighted random sample rather than a top-N, so a
 * station from the same seed is different each time but still leans toward the best fits.
 */

export interface RadioTrack {
  id: string;
  artist: string | null;
  album: string | null;
  bpm: number | null;
  key: string | null;
  energy: number | null;
  /** Integrated loudness (LUFS) */
  loudness: number | null;
}

/** Co-occurrence with one seed, computed from playlists and listening sessions. */
export interface SeedSignals {
  /** trackId → number of playlists containing both it and the seed */
  coPlaylist: Map<string, number>;
  /** trackId → times it was played within a session after the seed */
  coPlay: Map<string, number>;
  /** artist name → number of playlists where it sits next to one of the seed's artists */
  artistAffinity: Map<string, number>;
  /** trackId → 0–1, added to the library in the same sitting as the seed */
  coAdded: Map<string, number>;
}

/** Other people who must agree before their data counts toward a station. */
export const MIN_CROWD = 2;

/**
 * Sums a signal from the listener's own data plus other people's. Other people's
 * playlists and listening only count once at least MIN_CROWD of them agree, so one
 * person's private playlists or history can't be read back by probing stations.
 */
export class CrowdTally {
  private mine = new Map<string, number>();
  private others = new Map<string, { sum: number; users: Set<string> }>();

  constructor(private readonly me: string) {}

  add(key: string, amount: number, owner: string) {
    if (owner === this.me) {
      this.mine.set(key, (this.mine.get(key) ?? 0) + amount);
      return;
    }
    const entry = this.others.get(key) ?? { sum: 0, users: new Set<string>() };
    entry.sum += amount;
    entry.users.add(owner);
    this.others.set(key, entry);
  }

  totals(): Map<string, number> {
    const result = new Map(this.mine);
    for (const [key, { sum, users }] of this.others) {
      if (users.size >= MIN_CROWD) result.set(key, (result.get(key) ?? 0) + sum);
    }
    return result;
  }
}

export interface UserSignals {
  favorites: Set<string>;
  playCounts: Map<string, number>;
  /** trackId → last play time (ms) */
  lastPlayed: Map<string, number>;
  /** trackId → number of skips in the first 30% */
  earlySkips: Map<string, number>;
  /** Artists heard more than once in the last few tracks, lowercased */
  recentArtists: Set<string>;
  now: number;
}

const HOUR = 60 * 60 * 1000;

// Musical key compatibility (relative major/minor and neighbours on the circle of fifths)
const KEY_COMPATIBILITY: Record<string, string[]> = {
  'C': ['C', 'Am', 'G', 'F', 'Em', 'Dm'],
  'G': ['G', 'Em', 'D', 'C', 'Bm', 'Am'],
  'D': ['D', 'Bm', 'A', 'G', 'F#m', 'Em'],
  'A': ['A', 'F#m', 'E', 'D', 'C#m', 'Bm'],
  'E': ['E', 'C#m', 'B', 'A', 'G#m', 'F#m'],
  'B': ['B', 'G#m', 'F#', 'E', 'D#m', 'C#m'],
  'F#': ['F#', 'D#m', 'C#', 'B', 'A#m', 'G#m'],
  'F': ['F', 'Dm', 'C', 'Bb', 'Am', 'Gm'],
  'Bb': ['Bb', 'Gm', 'F', 'Eb', 'Dm', 'Cm'],
  'Eb': ['Eb', 'Cm', 'Bb', 'Ab', 'Gm', 'Fm'],
  'Ab': ['Ab', 'Fm', 'Eb', 'Db', 'Cm', 'Bbm'],
  'Db': ['Db', 'Bbm', 'Ab', 'Gb', 'Fm', 'Ebm'],
  'Am': ['Am', 'C', 'Em', 'Dm', 'G', 'F'],
  'Em': ['Em', 'G', 'Bm', 'Am', 'D', 'C'],
  'Bm': ['Bm', 'D', 'F#m', 'Em', 'A', 'G'],
  'F#m': ['F#m', 'A', 'C#m', 'Bm', 'E', 'D'],
  'C#m': ['C#m', 'E', 'G#m', 'F#m', 'B', 'A'],
  'G#m': ['G#m', 'B', 'D#m', 'C#m', 'F#', 'E'],
  'D#m': ['D#m', 'F#', 'A#m', 'G#m', 'C#', 'B'],
  'Dm': ['Dm', 'F', 'Am', 'Gm', 'C', 'Bb'],
  'Gm': ['Gm', 'Bb', 'Dm', 'Cm', 'F', 'Eb'],
  'Cm': ['Cm', 'Eb', 'Gm', 'Fm', 'Bb', 'Ab'],
  'Fm': ['Fm', 'Ab', 'Cm', 'Bbm', 'Eb', 'Db'],
  'Bbm': ['Bbm', 'Db', 'Fm', 'Ebm', 'Ab', 'Gb'],
};

/** Individual artists in a credit: "A, B & C feat. D" → [a, b, c, d]. */
export function artistNames(artist: string | null): string[] {
  return artist ? splitArtists(artist) : [];
}

/** The lead artist, used for spacing and per-station caps. */
export function primaryArtist(track: { id: string; artist: string | null }): string {
  return artistNames(track.artist)[0] ?? `__unknown__${track.id}`;
}

/**
 * How well `track` fits after `seed`. Unknown tempo/key/energy score nothing, so
 * tracks with real data aren't ranked below tracks without it.
 */
export function similarity(seed: RadioTrack, track: RadioTrack, signals: SeedSignals): number {
  let score = 0;

  const seedArtists = artistNames(seed.artist);
  const trackArtists = artistNames(track.artist);
  if (seedArtists.length > 0 && trackArtists.length > 0) {
    if (seedArtists[0] === trackArtists[0]) score += 35;
    else if (trackArtists.some((a) => seedArtists.includes(a))) score += 22;
    else {
      // Artists that share playlists with the seed's artists ("fans also like")
      const affinity = Math.max(0, ...trackArtists.map((a) => signals.artistAffinity.get(a) ?? 0));
      score += Math.min(affinity, 3) * 6;
    }
  }

  if (seed.album && track.album && seed.album.toLowerCase() === track.album.toLowerCase()) {
    score += 10;
  }

  // Curated together: the strongest signal a personal library has
  score += Math.min(signals.coPlaylist.get(track.id) ?? 0, 3) * 10;
  // Listened to together in the same session
  score += Math.min(signals.coPlay.get(track.id) ?? 0, 4) * 5;

  if (seed.bpm && track.bpm) {
    const diff = Math.abs(seed.bpm - track.bpm);
    if (diff <= 5) score += 15;
    else if (diff <= 15) score += 8;
  }

  if (seed.key && track.key) {
    if (seed.key === track.key) score += 10;
    else if (KEY_COMPATIBILITY[seed.key]?.includes(track.key)) score += 6;
  }

  // Songs added together tend to belong together
  score += Math.min(signals.coAdded.get(track.id) ?? 0, 1) * 8;

  // Mastering loudness follows era and style (a 70s remaster vs. modern pop), so it's a
  // useful nudge; mean-volume energy is the fallback when loudness wasn't measured
  if (seed.loudness != null && track.loudness != null) {
    score += Math.max(0, 10 - 2 * Math.abs(seed.loudness - track.loudness));
  } else if (seed.energy != null && track.energy != null && Math.abs(seed.energy - track.energy) <= 8) {
    score += 6;
  }

  return score;
}

/** This user's relationship with the track, independent of the seed. */
export function preference(track: RadioTrack, user: UserSignals): number {
  let score = 0;

  if (user.favorites.has(track.id)) score += 12;

  const last = user.lastPlayed.get(track.id);
  const age = last != null ? user.now - last : Infinity;
  if (age < 2 * HOUR) score -= 40; // just heard it
  else if (age < 24 * HOUR) score -= 15;
  else score += Math.min(user.playCounts.get(track.id) ?? 0, 5) * 2; // an old favourite

  const skips = user.earlySkips.get(track.id) ?? 0;
  if (skips >= 2) score -= Math.min((skips - 1) * 10, 30);

  // Artist fatigue: same artist again after hearing them twice in a row-ish
  if (artistNames(track.artist).some((a) => user.recentArtists.has(a))) score -= 15;

  return score;
}

export interface ScoredTrack<T extends RadioTrack> {
  track: T;
  score: number;
}

/**
 * Reorder so the same lead artist plays twice in a row as rarely as possible. At each step
 * take the artist with the most songs still to place (other than the one just played), so
 * a dominant artist is spread through the batch instead of piling up at the end. Within an
 * artist, the original (best-first) order is kept.
 */
export function spaceArtists<T extends { id: string; artist: string | null }>(list: T[], previousArtist?: string): T[] {
  const queues = new Map<string, T[]>();
  for (const t of list) {
    const artist = primaryArtist(t);
    const queue = queues.get(artist);
    if (queue) queue.push(t);
    else queues.set(artist, [t]);
  }
  const result: T[] = [];
  let last = previousArtist;
  while (result.length < list.length) {
    let pick: string | undefined;
    for (const [artist, queue] of queues) {
      if (queue.length === 0 || artist === last) continue;
      if (!pick || queue.length > queues.get(pick)!.length) pick = artist;
    }
    // Only the artist just played has songs left
    pick ??= last!;
    result.push(queues.get(pick)!.shift()!);
    last = pick;
  }
  return result;
}

export interface StationOptions<T> {
  /** Lead artist of the track playing before this batch, so the batch doesn't open with it. */
  previousArtist?: string;
  /** Identifies copies of the same song (the library can hold several). */
  songKey?: (track: T) => string;
  /** Songs not to pick again: the seed, what's queued, what was just heard. */
  blockedSongs?: Set<string>;
  rng?: () => number;
}

/** Score gap from the best match within which a track still counts as a real fit. */
const RELEVANT_WITHIN = 25;
/** Smallest batch worth returning instead of padding it with weak matches. */
const MIN_BATCH = 8;
/** Most of a batch one lead artist may fill. */
const MAX_ARTIST_SHARE = 0.35;
/** Each earlier pick of the same lead artist in a batch costs this much. */
const ARTIST_REPEAT_COST = 6;
/** Softmax temperature: a 10-point lead makes a track e (~2.7×) likelier per draw. */
const TEMPERATURE = 10;

/**
 * Sample a station batch, one draw at a time with probability ∝ e^(score/T), so a station
 * from the same seed differs every time but leans toward the best fits. Each pick of an
 * artist makes the next one of theirs less likely, and copies of a song count once.
 *
 * Draws come from the real fits when there are enough of them: in a big library hundreds
 * of unrelated tracks with a small weight each would otherwise outdraw a few strong matches.
 */
export function pickStation<T extends RadioTrack>(
  scored: ScoredTrack<T>[],
  limit: number,
  options: StationOptions<T> = {}
): ScoredTrack<T>[] {
  const rng = options.rng ?? Math.random;

  // Shuffle first so equal scores come out in random order, then rank
  const ranked = [...scored];
  for (let i = ranked.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ranked[i], ranked[j]] = [ranked[j]!, ranked[i]!];
  }
  ranked.sort((a, b) => b.score - a.score);

  const seen = new Set(options.blockedSongs);
  const unique = options.songKey
    ? ranked.filter((s) => {
      const key = options.songKey!(s.track);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    : ranked;
  if (unique.length === 0) return [];

  const best = unique[0]!.score;
  const relevant = unique.filter((s) => s.score >= best - RELEVANT_WITHIN);
  // Enough real fits: draw from all of them (a shorter batch if there are fewer than
  // `limit`; the next refill is seeded from one of them and finds more). Not just the top
  // few: those can all be one prolific artist, leaving the per-artist cost nobody else to
  // pick. Too few real fits: the best of the rest.
  const pool = relevant.length >= MIN_BATCH ? relevant : unique.slice(0, limit * 2);

  // Hard ceiling on one lead artist. When the strong matches are mostly one artist (an
  // era where one singer dominates the library), the soft cost alone can't stop a batch
  // from being nearly all them; a shorter batch is better, as the next refill is seeded
  // from whatever plays then.
  const artistCap = Math.max(2, Math.ceil(limit * MAX_ARTIST_SHARE));
  const seenPerArtist = new Map<string, number>();
  // Keep only each artist's best `artistCap` songs (the pool is best-first)
  const capped = pool.filter((s) => {
    const artist = primaryArtist(s.track);
    const count = (seenPerArtist.get(artist) ?? 0) + 1;
    seenPerArtist.set(artist, count);
    return count <= artistCap;
  });

  const artistPicks = new Map<string, number>();
  const picked: ScoredTrack<T>[] = [];
  while (picked.length < limit && capped.length > 0) {
    const effective = capped.map((s) => s.score - ARTIST_REPEAT_COST * (artistPicks.get(primaryArtist(s.track)) ?? 0));
    const top = Math.max(...effective);
    const weights = effective.map((e) => Math.exp((e - top) / TEMPERATURE));
    let r = rng() * weights.reduce((sum, w) => sum + w, 0);
    let i = 0;
    while (i < weights.length - 1 && (r -= weights[i]!) > 0) i++;
    const [s] = capped.splice(i, 1);
    picked.push(s!);
    const artist = primaryArtist(s!.track);
    artistPicks.set(artist, (artistPicks.get(artist) ?? 0) + 1);
  }

  const spaced = spaceArtists(picked.map((s) => s.track), options.previousArtist);
  const byId = new Map(picked.map((s) => [s.track.id, s]));
  return spaced.map((t) => byId.get(t.id)!);
}
