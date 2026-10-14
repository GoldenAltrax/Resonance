// Fisher–Yates; Array.sort(() => Math.random() - 0.5) is biased and unstable
export function shuffleArray<T>(items: T[], rng: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// Same separators as the backend's splitArtists (backend/src/utils/matching.ts)
const ARTIST_SEPARATOR = /\s*(?:,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|;|\/)\s*/i;

/** The lead artist of a credit ("A, B feat. C" → "a"); tracks without one count as their own artist. */
export function leadArtist(track: { id: string; artist: string | null }): string {
  const lead = track.artist?.split(ARTIST_SEPARATOR)[0]?.trim().toLowerCase();
  return lead || `__unknown__${track.id}`;
}

export interface BalancedShuffleOptions {
  /** Recently played track ids, most recent last: they're kept toward the end. */
  recent?: string[];
  /** Candidate orders to generate; the best-scoring one wins. */
  iterations?: number;
  rng?: () => number;
}

/** A track with its lead artist and recency worked out once, not per comparison. */
interface Slot<T> {
  item: T;
  artist: string;
  /** 0 = not played recently; up to 1 for the latest play */
  recency: number;
}

/**
 * Shuffle the way Spotify's does: pure randomness clusters (three songs by one artist in
 * a row feels broken even though it's random), so build several spread-out candidate
 * orders and keep the one that best separates artists and holds back recent plays.
 */
export function balancedShuffle<T extends { id: string; artist: string | null }>(
  items: T[],
  options: BalancedShuffleOptions = {}
): T[] {
  if (items.length < 2) return [...items];
  const rng = options.rng ?? Math.random;
  // Each candidate is O(n log n); fewer of them for very long lists keeps this well under a frame budget
  const iterations = options.iterations ?? (items.length > 1000 ? 8 : 24);
  const recent = options.recent ?? [];
  const recentRank = new Map(recent.map((id, i) => [id, (i + 1) / recent.length]));
  const slots: Slot<T>[] = items.map((item) => ({
    item,
    artist: leadArtist(item),
    recency: recentRank.get(item.id) ?? 0,
  }));

  let best: Slot<T>[] = slots;
  let bestCost = Infinity;
  for (let n = 0; n < iterations; n++) {
    const candidate = separateArtists(spreadByArtist(slots, rng));
    const cost = shuffleCost(candidate);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best.map((s) => s.item);
}

/** Lower is better: same artist close together, and recent plays near the start. */
function shuffleCost<T>(order: Slot<T>[]): number {
  let cost = 0;
  const lastSeen = new Map<string, number>();
  order.forEach((slot, i) => {
    const prev = lastSeen.get(slot.artist);
    // Within three songs of the same artist: closer costs more
    if (prev !== undefined && i - prev < 4) cost += 4 - (i - prev);
    lastSeen.set(slot.artist, i);
    // Heard recently and early in the order: up to 3 (the latest play, first in line)
    cost += 3 * slot.recency * (1 - i / order.length);
  });
  return cost;
}

/**
 * One candidate order: each artist's songs get evenly spaced slots with a random offset
 * and a little jitter, then all slots are merged in order.
 */
function spreadByArtist<T>(slots: Slot<T>[], rng: () => number): Slot<T>[] {
  const groups = new Map<string, Slot<T>[]>();
  for (const slot of slots) {
    const group = groups.get(slot.artist);
    if (group) group.push(slot);
    else groups.set(slot.artist, [slot]);
  }

  const placed: { slot: Slot<T>; position: number }[] = [];
  for (const group of groups.values()) {
    const spacing = 1 / group.length;
    const offset = rng() * spacing;
    shuffleArray(group, rng).forEach((slot, i) => {
      // Jitter within ±10% of the spacing keeps the pattern from looking mechanical
      const jitter = (rng() - 0.5) * 0.2 * spacing;
      placed.push({ slot, position: offset + i * spacing + jitter });
    });
  }
  return placed.sort((a, b) => a.position - b.position).map((p) => p.slot);
}

/**
 * Even slots can still land two songs by one artist side by side when no other song
 * happens to fall between them. Swap the second one with another song that fits there
 * and whose own move doesn't create a new pair (later songs first, then earlier ones).
 * An artist with more than half the list can't be fully separated; once a clash of theirs
 * finds no swap, their later clashes are left alone instead of searching again.
 */
function separateArtists<T>(order: Slot<T>[]): Slot<T>[] {
  const result = [...order];
  const n = result.length;
  const artistAt = (i: number) => (i >= 0 && i < n ? result[i]!.artist : null);
  const swapFits = (i: number, j: number) => {
    const moving = result[i]!.artist;
    const incoming = result[j]!.artist;
    if (incoming === moving) return false;
    // incoming lands at i, next to i-1 and i+1 (unless j is that neighbour)
    if (incoming === artistAt(i - 1) || (j !== i + 1 && incoming === artistAt(i + 1))) return false;
    // moving lands at j, next to j-1 and j+1 (unless that neighbour is i)
    if ((j - 1 !== i && moving === artistAt(j - 1)) || (j + 1 !== i && moving === artistAt(j + 1))) return false;
    return true;
  };
  const unfixable = new Set<string>();
  for (let i = 1; i < n; i++) {
    const artist = result[i]!.artist;
    if (artist !== result[i - 1]!.artist || unfixable.has(artist)) continue;
    let target = -1;
    for (let j = i + 1; j < n && target === -1; j++) if (swapFits(i, j)) target = j;
    for (let j = i - 2; j >= 0 && target === -1; j--) if (swapFits(i, j)) target = j;
    if (target === -1) unfixable.add(artist);
    else [result[i], result[target]] = [result[target]!, result[i]!];
  }
  return result;
}
