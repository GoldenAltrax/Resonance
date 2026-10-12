// LRCLIB API service for fetching synced lyrics
// https://lrclib.net/docs

// The transliteration tables are ~190 KB, so they're only downloaded when a song
// actually has non-Latin lyrics.
let transliterateFn: ((text: string) => string) | null = null;

async function prepareTransliteration(...texts: (string | null | undefined)[]) {
  if (transliterateFn || !texts.some((t) => t && hasNonLatinCharacters(t))) return;
  transliterateFn = (await import('transliteration')).transliterate;
}

const LRCLIB_API = 'https://lrclib.net/api';

/**
 * Check if text contains non-Latin characters (needs transliteration)
 */
function hasNonLatinCharacters(text: string): boolean {
  // Match characters outside of basic Latin, extended Latin, and common punctuation
  // This will match Hindi (Devanagari), Chinese, Japanese, Korean, Arabic, Cyrillic, etc.
  const nonLatinRegex = /[^\u0000-\u024F\u1E00-\u1EFF]/;
  return nonLatinRegex.test(text);
}

/**
 * Transliterate text to Latin characters if it contains non-Latin scripts
 */
function transliterateText(text: string): string {
  if (!transliterateFn || !hasNonLatinCharacters(text)) {
    return text;
  }
  return transliterateFn(text);
}

export interface LyricLine {
  time: number;  // Time in seconds
  text: string;  // Lyric text
}

export interface LyricsResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

/**
 * Parse LRC format lyrics into structured array
 * LRC format: [mm:ss.xx] Lyric text
 */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lrcLines = lrc.split('\n');

  for (const line of lrcLines) {
    // Match [mm:ss.xx] or [mm:ss] format
    const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/);
    if (match && match[1] && match[2]) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
      const rawText = (match[4] ?? '').trim();

      // Only add lines with actual text
      if (rawText) {
        const time = minutes * 60 + seconds + milliseconds / 1000;
        // Transliterate non-Latin text to Latin characters (e.g., Hindi → Hinglish)
        const text = transliterateText(rawText);
        lines.push({ time, text });
      }
    }
  }

  // Sort by time (should already be sorted, but just in case)
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Get the index of the current lyric line based on playback time
 */
export function getCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (lyrics.length === 0) return -1;

  // Find the last lyric line that has started
  for (let i = lyrics.length - 1; i >= 0; i--) {
    const lyric = lyrics[i];
    if (lyric && lyric.time <= currentTime) {
      return i;
    }
  }

  return -1; // No lyric has started yet
}

/**
 * Fetch lyrics from LRCLIB API
 */
export async function fetchLyrics(
  trackName: string,
  artistName: string | null
): Promise<{ synced: LyricLine[] | null; plain: string | null }> {
  try {
    // Build query params
    const params = new URLSearchParams({
      track_name: trackName,
    });

    if (artistName) {
      params.append('artist_name', artistName);
    }

    const response = await fetch(`${LRCLIB_API}/get?${params.toString()}`);

    if (!response.ok) {
      if (response.status === 404) {
        // No lyrics found
        return { synced: null, plain: null };
      }
      throw new Error('Failed to fetch lyrics');
    }

    const data: LyricsResponse = await response.json();
    await prepareTransliteration(data.syncedLyrics, data.plainLyrics);

    // Parse synced lyrics if available (transliteration applied in parseLRC)
    const synced = data.syncedLyrics ? parseLRC(data.syncedLyrics) : null;

    // Transliterate plain lyrics if available
    const plain = data.plainLyrics ? transliterateText(data.plainLyrics) : null;

    return {
      synced,
      plain,
    };
  } catch (error) {
    console.error('Error fetching lyrics:', error);
    return { synced: null, plain: null };
  }
}

/**
 * Search for lyrics (useful when exact match fails)
 */
export async function searchLyrics(query: string): Promise<LyricsResponse[]> {
  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`${LRCLIB_API}/search?${params.toString()}`);

    if (!response.ok) {
      return [];
    }

    return response.json();
  } catch (error) {
    console.error('Error searching lyrics:', error);
    return [];
  }
}

const lyricsCache = new Map<string, { synced: LyricLine[] | null; plain: string | null }>();

/**
 * Lyrics for a library track: lyrics embedded in the file's tags first (served by our
 * backend, no third party involved), then LRCLIB. Results are cached per track.
 */
export async function fetchTrackLyrics(track: {
  id: string;
  title: string;
  artist: string | null;
}): Promise<{ synced: LyricLine[] | null; plain: string | null }> {
  const cached = lyricsCache.get(track.id);
  if (cached) return cached;

  let result: { synced: LyricLine[] | null; plain: string | null } = { synced: null, plain: null };
  try {
    const { api } = await import('@/services/api');
    const embedded = await api.getEmbeddedLyrics(track.id);
    if (embedded.synced?.length || embedded.lyrics) {
      await prepareTransliteration(embedded.lyrics, ...(embedded.synced ?? []).map((l) => l.text));
      result = {
        synced: embedded.synced?.length
          ? embedded.synced.map((l) => ({ time: l.time, text: transliterateText(l.text) }))
          : null,
        plain: embedded.lyrics ? transliterateText(embedded.lyrics) : null,
      };
    }
  } catch {
    // Fall through to LRCLIB
  }

  if (!result.synced && !result.plain) {
    result = await fetchLyrics(track.title, track.artist);
  }

  lyricsCache.set(track.id, result);
  return result;
}
