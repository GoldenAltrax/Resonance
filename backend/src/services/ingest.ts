/**
 * Turns an audio file on disk into a library track: tags, cover art, duplicate check,
 * storage format, Radio analysis and the database row. Shared by browser uploads and
 * the download pipeline so both behave identically.
 */
import { v4 as uuidv4 } from 'uuid';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { join, resolve, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseFile } from 'music-metadata';
import { db, tracks } from '../db/index.js';
import { generateFingerprint, lookupAcoustID, calculateDuplicateScore } from '../utils/fingerprint.js';

const execFileAsync = promisify(execFile);

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const UPLOADS_BASE = resolve(__dirname, '..', '..', 'uploads');
export const AUDIO_DIR = join(UPLOADS_BASE, 'audio');
export const IMAGES_DIR = join(UPLOADS_BASE, 'images');
export const TEMP_DIR = join(UPLOADS_BASE, 'temp');

await mkdir(AUDIO_DIR, { recursive: true });
await mkdir(IMAGES_DIR, { recursive: true });
await mkdir(TEMP_DIR, { recursive: true });

/** Formats stored as-is when the caller asks to keep the original (all play natively in browsers, incl. iOS). */
const KEEPABLE_EXTENSIONS = ['mp3', 'm4a', 'aac'];

export interface IngestOptions {
  /** Audio file to import. It is moved into the library or deleted; the caller must not reuse it. */
  sourcePath: string;
  /** Name used for duplicate detection and as the fallback title (no extension). */
  originalFilename: string;
  userId: string;
  /** Keep MP3/M4A/AAC files untouched instead of transcoding to MP3 (downloads are already compressed). */
  keepOriginal?: boolean;
  /** Skip duplicate detection (admin confirmed). */
  force?: boolean;
  /** Metadata that overrides whatever is in the file's tags. */
  meta?: {
    title?: string;
    artist?: string;
    album?: string;
    cover?: { data: Buffer; ext: string };
  };
}

export interface DuplicateInfo {
  score: number;
  breakdown: ReturnType<typeof calculateDuplicateScore>['breakdown'];
  existingTrack: {
    id: string;
    title: string;
    artist: string | null;
    duration: number;
    originalFilename: string | null;
    musicbrainzRecordingId: string | null;
  };
}

export type IngestResult =
  | { status: 'created'; trackId: string }
  | { status: 'duplicate'; duplicate: DuplicateInfo };

// Compress audio to 192kbps MP3 using ffmpeg
async function compressAudio(inputPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-i', inputPath, '-codec:a', 'libmp3lame', '-b:a', '192k', '-y', outputPath]);
  } catch (error) {
    console.error('FFmpeg compression failed:', error);
    throw new Error('Audio compression failed');
  }
}

// Analyze audio for BPM, key, and energy using ffprobe
export interface AudioAnalysis {
  bpm: number | null;
  key: string | null;
  energy: number | null;
}

export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  const result: AudioAnalysis = { bpm: null, key: null, energy: null };

  try {
    // Try to get audio stats for energy calculation
    try {
      const { stderr: volumeStats } = await execFileAsync('ffmpeg', [
        '-i', filePath,
        '-af', 'volumedetect',
        '-f', 'null',
        '-'
      ], { maxBuffer: 10 * 1024 * 1024 } as { maxBuffer: number });

      // Parse mean volume to calculate energy (0-100 scale)
      const meanMatch = volumeStats?.match(/mean_volume:\s*(-?\d+\.?\d*)\s*dB/);
      if (meanMatch && meanMatch[1]) {
        const meanDb = parseFloat(meanMatch[1]);
        // Convert dB to 0-100 scale (typical range is -60dB to 0dB)
        // -60dB = 0 energy, 0dB = 100 energy
        result.energy = Math.max(0, Math.min(100, Math.round((meanDb + 60) * (100 / 60))));
      }
    } catch {
      // Volume detection failed, leave energy as null
    }

    // Try to extract BPM from metadata (some files have it in ID3 tags)
    try {
      const metadata = await parseFile(filePath);
      if (metadata.native) {
        // Check various tag formats for BPM
        for (const format of Object.values(metadata.native)) {
          for (const tag of format) {
            if (tag.id === 'TBPM' || tag.id === 'BPM' || tag.id === 'bpm') {
              const bpmValue = parseInt(String(tag.value), 10);
              if (!isNaN(bpmValue) && bpmValue > 0 && bpmValue < 300) {
                result.bpm = bpmValue;
              }
            }
            // Check for initial key
            if (tag.id === 'TKEY' || tag.id === 'KEY' || tag.id === 'key' || tag.id === 'initialkey') {
              result.key = String(tag.value).trim();
            }
          }
        }
      }
    } catch {
      // Metadata parsing failed
    }
  } catch (error) {
    console.warn('Audio analysis failed:', error);
  }

  return result;
}

async function removeQuietly(path: string | undefined) {
  if (path) await unlink(path).catch(() => {});
}

export async function ingestAudioFile(opts: IngestOptions): Promise<IngestResult> {
  const { sourcePath, originalFilename, userId, meta } = opts;
  const trackId = uuidv4();
  const sourceExt = extname(sourcePath).slice(1).toLowerCase();

  let coverPath: string | undefined; // absolute
  let finalPath: string | undefined;

  try {
    // Tags from the file, then explicit metadata on top
    let duration = 0;
    let title = originalFilename;
    let artist = 'Unknown Artist';
    let album: string | undefined;
    let embeddedCover: { data: Uint8Array; ext: string } | undefined;
    let bitrate = 0;

    try {
      const metadata = await parseFile(sourcePath);
      duration = Math.round(metadata.format.duration || 0);
      bitrate = metadata.format.bitrate || 0;
      if (metadata.common.title) title = metadata.common.title;
      if (metadata.common.artist) artist = metadata.common.artist;
      if (metadata.common.album) album = metadata.common.album;
      const picture = metadata.common.picture?.[0];
      if (picture) {
        embeddedCover = { data: picture.data, ext: picture.format.split('/').pop()?.replace('jpeg', 'jpg') || 'jpg' };
      }
    } catch (err) {
      console.warn('Failed to parse audio metadata:', err);
    }

    if (meta?.title) title = meta.title;
    if (meta?.artist) artist = meta.artist;
    if (meta?.album) album = meta.album;

    const cover = meta?.cover ?? embeddedCover;
    let coverArt: string | undefined;
    if (cover) {
      const coverFilename = `cover-${trackId}.${cover.ext}`;
      coverPath = join(IMAGES_DIR, coverFilename);
      await writeFile(coverPath, cover.data);
      coverArt = `images/${coverFilename}`;
    }

    // Duplicate detection runs on the original file, before the (slow) ffmpeg pass,
    // so rejected duplicates never pay for compression. Always fingerprint (also when
    // forced) so the track can be matched later.
    let fpFingerprint: string | null = null;
    let fpAcoustidId: string | null = null;
    let fpMusicbrainzId: string | null = null;
    const fp = await generateFingerprint(sourcePath);
    if (fp) {
      fpFingerprint = fp.fingerprint;
      const acoustidResult = await lookupAcoustID(fp.fingerprint, fp.duration);
      if (acoustidResult) {
        fpAcoustidId = acoustidResult.acoustidId;
        fpMusicbrainzId = acoustidResult.musicbrainzRecordingId;
      }
    }

    if (!opts.force) {
      const incomingMeta = {
        title,
        artist,
        duration,
        originalFilename,
        musicbrainzRecordingId: fpMusicbrainzId,
        acoustidFingerprint: fpFingerprint,
      };

      const candidates = await db.select({
        id: tracks.id,
        title: tracks.title,
        artist: tracks.artist,
        duration: tracks.duration,
        originalFilename: tracks.originalFilename,
        musicbrainzRecordingId: tracks.musicbrainzRecordingId,
        acoustidFingerprint: tracks.acoustidFingerprint,
      }).from(tracks);

      let best: { score: number; candidate: (typeof candidates)[number]; result: ReturnType<typeof calculateDuplicateScore> } | null = null;
      for (const candidate of candidates) {
        const result = calculateDuplicateScore(incomingMeta, candidate);
        if (!best || result.score > best.score) best = { score: result.score, candidate, result };
      }

      if (best && best.score >= 60) {
        await removeQuietly(sourcePath);
        await removeQuietly(coverPath);
        const { acoustidFingerprint: _fp, ...existingTrack } = best.candidate;
        return { status: 'duplicate', duplicate: { score: best.score, breakdown: best.result.breakdown, existingTrack } };
      }
    }

    // Storage format: keep already-compressed files, otherwise 192 kbps MP3
    const keep =
      (opts.keepOriginal && KEEPABLE_EXTENSIONS.includes(sourceExt)) ||
      (sourceExt === 'mp3' && bitrate > 0 && bitrate <= 256000);
    const finalExt = keep ? sourceExt : 'mp3';
    finalPath = join(AUDIO_DIR, `${trackId}.${finalExt}`);
    if (keep) {
      await rename(sourcePath, finalPath);
    } else {
      await compressAudio(sourcePath, finalPath);
      await removeQuietly(sourcePath);
    }

    const analysis = await analyzeAudio(finalPath);

    await db.insert(tracks).values({
      id: trackId,
      title,
      artist,
      album,
      duration,
      filePath: `audio/${basename(finalPath)}`,
      originalFilename,
      coverArt,
      bpm: analysis.bpm,
      key: analysis.key,
      energy: analysis.energy,
      userId,
      acoustidFingerprint: fpFingerprint,
      acoustidId: fpAcoustidId,
      musicbrainzRecordingId: fpMusicbrainzId,
    });

    return { status: 'created', trackId };
  } catch (error) {
    await removeQuietly(sourcePath);
    await removeQuietly(finalPath);
    await removeQuietly(coverPath);
    throw error;
  }
}
