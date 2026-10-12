/**
 * Picks the YouTube upload that best matches a requested song. Pure functions so the
 * rules can be unit-tested without network access.
 */

/** Lowercase, strip accents, punctuation and featuring credits: "Get Lucky (feat. Pharrell)" -> "get lucky". */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/g, ' ')
    .replace(/\s(feat|ft|featuring)\.?\s.*$/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Individual artist names from credits like "Daft Punk, Pharrell Williams & Nile Rodgers". */
export function splitArtists(value: string): string[] {
  return value
    .split(/\s*(?:,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|;|\/)\s*/i)
    .map((a) => normalizeTitle(a))
    .filter(Boolean);
}

/** Key used to recognise the same song already in the library or queue. */
export function songKey(title: string, artist: string | null | undefined): string {
  const primary = artist ? splitArtists(artist)[0] ?? '' : '';
  return `${normalizeTitle(title)}|${primary}`;
}

// Versions that are almost never what was asked for unless the request names them
const UNWANTED = [
  'live', 'cover', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', 'nightcore',
  '8d', 'reverb', 'acoustic', 'demo', 'extended', 'mashup', 'tutorial', 'reaction', 'loop', '1 hour',
];

export interface SongRequest {
  title: string;
  artist?: string | null;
  /** Expected length in seconds. */
  duration?: number | null;
}

export interface Candidate {
  title: string;
  /** Credited artists (YouTube Music songs) */
  artists?: string[] | null;
  channel?: string | null;
  duration?: number | null;
}

function words(value: string): Set<string> {
  return new Set(normalizeTitle(value).split(' ').filter(Boolean));
}

/**
 * 0-100 score, or -1 when the candidate must not be used (wrong length or an unwanted
 * version such as a live recording or remix).
 */
export function scoreCandidate(request: SongRequest, candidate: Candidate): number {
  const wantedTitle = normalizeTitle(request.title);
  const candTitle = normalizeTitle(candidate.title);

  // Length is the strongest signal: it separates radio edits, extended mixes and videos with intros
  let durationScore = 15; // unknown length: neutral
  if (request.duration && candidate.duration) {
    const diff = Math.abs(request.duration - candidate.duration);
    const tolerance = Math.max(5, request.duration * 0.04);
    if (diff > tolerance) return -1;
    durationScore = Math.round(30 * (1 - diff / tolerance));
  }

  for (const term of UNWANTED) {
    const pattern = new RegExp(`\\b${term}\\b`);
    if (pattern.test(candTitle) && !pattern.test(wantedTitle)) return -1;
  }

  // Title: share of requested words present in the candidate title
  const wantedWords = words(request.title);
  const candWords = words(candidate.title);
  let shared = 0;
  for (const w of wantedWords) if (candWords.has(w)) shared++;
  const titleScore = wantedWords.size ? Math.round(40 * (shared / wantedWords.size)) : 0;
  if (titleScore < 20) return -1;

  // Artist: credited artists, then channel name ("Daft Punk - Topic"), then the video title
  let artistScore = 0;
  if (request.artist) {
    const wanted = splitArtists(request.artist);
    const credited = (candidate.artists ?? []).map((a) => normalizeTitle(a));
    const channel = normalizeTitle((candidate.channel ?? '').replace(/\s*-\s*topic$/i, ''));
    const haystack = ` ${credited.join(' ')} ${channel} ${candTitle} `;
    if (wanted.some((a) => credited.includes(a) || channel === a)) artistScore = 20;
    else if (wanted.some((a) => haystack.includes(` ${a} `))) artistScore = 12;
  } else {
    artistScore = 10;
  }

  // Official audio: YouTube Music songs carry artist credits; "X - Topic" channels are label uploads
  const official = (candidate.artists?.length ?? 0) > 0 || /-\s*topic$/i.test(candidate.channel ?? '') ? 10 : 0;

  return Math.min(100, durationScore + titleScore + artistScore + official);
}

/** Highest-scoring acceptable candidate, or null when nothing reaches the threshold. */
export function pickBest<T extends Candidate>(request: SongRequest, candidates: T[], threshold = 55): T | null {
  let best: { item: T; score: number } | null = null;
  for (const item of candidates) {
    const score = scoreCandidate(request, item);
    if (score >= threshold && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}

/** Split a YouTube video title like "Artist - Song (Official Video) ft. X" into its parts. */
export function parseVideoTitle(title: string, channel?: string | null): { artist: string | null; title: string } {
  const cleaned = title
    // Bracketed video labels in any common form: (Official Music Video), [Video Oficial], ( Video Lyric ), (Visualizer)...
    .replace(/[([][^)\]]*\b(official|oficial|officiel|video|audio|lyrics?|visuali[sz]er|performance|clip|hd|hq|4k|mv|m\/v)\b[^)\]]*[)\]]/gi, '')
    // Trailing featuring credits: "Song ft. Someone"
    .replace(/\s(ft|feat|featuring)\.?\s.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const channelName = channel
    ? channel.replace(/\s*-\s*topic$/i, '').replace(/\s*(vevo|oficial|official|music)$/i, '').trim()
    : '';
  const parts = cleaned.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const first = parts[0].trim();
    const rest = parts.slice(1).join(' - ').trim();
    // Usually "Artist - Title"; some uploads use "Title - Artist", which the channel name reveals
    const channelKey = normalizeTitle(channelName);
    if (channelKey && !normalizeTitle(first).includes(channelKey) && normalizeTitle(rest).includes(channelKey)) {
      return { artist: rest, title: first };
    }
    return { artist: first, title: rest };
  }
  return { artist: channelName || null, title: cleaned };
}
