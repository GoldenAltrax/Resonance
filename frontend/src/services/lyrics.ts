// LRCLIB API service for fetching synced lyrics
// https://lrclib.net/docs

import { transliterate } from 'transliteration';

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
  if (!hasNonLatinCharacters(text)) {
    return text;
  }
  return transliterate(text);
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
