import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream } from 'fs';
import { mkdir, unlink, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db, tracks } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const execFileAsync = promisify(execFile);

// Schema for duplicate check request
const checkDuplicatesSchema = z.object({
  tracks: z.array(z.object({
    title: z.string(),
    artist: z.string().nullable(),
  })),
});

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const UPLOADS_DIR = join(__dirname, '..', '..', 'uploads', 'audio');
const TEMP_DIR = join(__dirname, '..', '..', 'uploads', 'temp');

// Ensure directories exist
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(TEMP_DIR, { recursive: true });

// Musical key compatibility map (for Radio mode similarity matching)
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

// Compress audio to 192kbps MP3 using ffmpeg
async function compressAudio(inputPath: string, outputPath: string): Promise<void> {
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      '-y', // Overwrite output file if exists
      outputPath
    ]);
  } catch (error) {
    console.error('FFmpeg compression failed:', error);
    throw new Error('Audio compression failed');
  }
}

// Analyze audio for BPM, key, and energy using ffprobe
interface AudioAnalysis {
  bpm: number | null;
  key: string | null;
  energy: number | null;
}

async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
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

// Check if two keys are compatible (for Radio mode)
export function areKeysCompatible(key1: string | null, key2: string | null): boolean {
  if (!key1 || !key2) return true; // If either is unknown, consider compatible
  const compatible = KEY_COMPATIBILITY[key1];
  return compatible ? compatible.includes(key2) : false;
}

// Calculate BPM similarity (within range is considered similar)
export function areBpmsSimilar(bpm1: number | null, bpm2: number | null, tolerance = 15): boolean {
  if (!bpm1 || !bpm2) return true; // If either is unknown, consider similar
  return Math.abs(bpm1 - bpm2) <= tolerance;
}

// Calculate energy similarity
export function areEnergiesSimilar(energy1: number | null, energy2: number | null, tolerance = 25): boolean {
  if (!energy1 || !energy2) return true; // If either is unknown, consider similar
  return Math.abs(energy1 - energy2) <= tolerance;
}

export async function trackRoutes(app: FastifyInstance) {
  // Get all tracks - ADMIN ONLY (for Library view)
  app.get('/', {
    preHandler: adminMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const allTracks = await db.query.tracks.findMany({
      orderBy: (tracks, { desc }) => [desc(tracks.createdAt)],
    });

    return reply.send(allTracks);
  });

  // Get single track - ANY AUTHENTICATED USER
  app.get<{ Params: { id: string } }>('/:id', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    return reply.send(track);
  });

  // Upload new track - ADMIN ONLY with compression
  app.post('/', {
    preHandler: adminMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    const data = await request.file({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit for original files

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Validate file type
    const validMimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/m4a', 'audio/aac', 'audio/x-m4a'];
    if (!validMimeTypes.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Supported: MP3, WAV, OGG, FLAC, M4A, AAC' });
    }

    const trackId = uuidv4();
    const originalExt = data.filename.split('.').pop() || 'mp3';
    const tempFilename = `${trackId}_temp.${originalExt}`;
    const tempFilePath = join(TEMP_DIR, tempFilename);
    const finalFilename = `${trackId}.mp3`; // Always output as MP3
    const finalFilePath = join(UPLOADS_DIR, finalFilename);

    try {
      // Save original file to temp location
      await pipeline(data.file, createWriteStream(tempFilePath));

      // Extract metadata from original file before compression
      let duration = 0;
      let artist = 'Unknown Artist';
      let album: string | undefined;
      let title = data.filename.replace(/\.[^/.]+$/, ''); // Default to filename

      try {
        const metadata = await parseFile(tempFilePath);
        duration = Math.round(metadata.format.duration || 0);

        if (metadata.common.title) {
          title = metadata.common.title;
        }
        if (metadata.common.artist) {
          artist = metadata.common.artist;
        }
        if (metadata.common.album) {
          album = metadata.common.album;
        }
      } catch (err) {
        console.warn('Failed to parse audio metadata:', err);
      }

      // Compress audio to 192kbps MP3
      const isAlreadyCompressedMp3 = data.mimetype === 'audio/mpeg' || data.mimetype === 'audio/mp3';

      if (isAlreadyCompressedMp3) {
        // Check if MP3 is already low bitrate (skip compression if under 256kbps)
        try {
          const metadata = await parseFile(tempFilePath);
          const bitrate = metadata.format.bitrate || 0;
          if (bitrate <= 256000) {
            // Already compressed enough, just move the file
            const { rename } = await import('fs/promises');
            await rename(tempFilePath, finalFilePath);
          } else {
            // Compress high bitrate MP3
            await compressAudio(tempFilePath, finalFilePath);
            await unlink(tempFilePath);
          }
        } catch {
          // If we can't read bitrate, compress anyway
          await compressAudio(tempFilePath, finalFilePath);
          await unlink(tempFilePath);
        }
      } else {
        // Compress non-MP3 formats
        await compressAudio(tempFilePath, finalFilePath);
        await unlink(tempFilePath);
      }

      // Get final file size for logging
      const finalStats = await stat(finalFilePath);
      console.log(`Track ${trackId} compressed: ${(finalStats.size / 1024 / 1024).toFixed(2)}MB`);

      // Analyze audio for Radio mode (BPM, key, energy)
      const analysis = await analyzeAudio(finalFilePath);
      console.log(`Track ${trackId} analysis: BPM=${analysis.bpm}, Key=${analysis.key}, Energy=${analysis.energy}`);

      // Store original filename without extension for duplicate detection
      const originalFilename = data.filename.replace(/\.[^/.]+$/, '');

      // Create track record
      await db.insert(tracks).values({
        id: trackId,
        title,
        artist,
        album,
        duration,
        filePath: `audio/${finalFilename}`,
        originalFilename,
        bpm: analysis.bpm,
        key: analysis.key,
        energy: analysis.energy,
        userId, // Track who uploaded (for audit purposes)
      });

      const track = await db.query.tracks.findFirst({
        where: eq(tracks.id, trackId),
      });

      return reply.status(201).send(track);
    } catch (error) {
      // Clean up temp file on error
      try {
        await unlink(tempFilePath);
      } catch { /* ignore */ }
      try {
        await unlink(finalFilePath);
      } catch { /* ignore */ }

      console.error('Track upload error:', error);
      return reply.status(500).send({ error: 'Failed to process audio file' });
    }
  });

  // Delete track - ADMIN ONLY
  app.delete<{ Params: { id: string } }>('/:id', {
    preHandler: adminMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Delete file from filesystem
    try {
      const filePath = join(UPLOADS_DIR, '..', track.filePath);
      await unlink(filePath);
    } catch (err) {
      console.warn('Failed to delete track file:', err);
    }

    await db.delete(tracks).where(eq(tracks.id, id));

    return reply.status(204).send();
  });

  // Stream track audio - ANY AUTHENTICATED USER
  app.get<{ Params: { id: string } }>('/:id/stream', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Redirect to static file server
    return reply.redirect(`/uploads/${track.filePath}`);
  });

  // Check for duplicate tracks - ADMIN ONLY
  app.post('/check-duplicates', {
    preHandler: adminMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = checkDuplicatesSchema.parse(request.body);
      const duplicates: Array<{
        title: string;
        artist: string | null;
        existingTrackId: string;
        existingTrack: typeof tracks.$inferSelect;
      }> = [];

      // Get all tracks for comparison (global library)
      const allTracks = await db.query.tracks.findMany();

      // Check each incoming track against existing library
      for (const incoming of body.tracks) {
        const normalizedTitle = incoming.title.toLowerCase().trim();

        const match = allTracks.find((existing) => {
          const existingFilename = existing.originalFilename?.toLowerCase().trim();
          const existingTitle = existing.title.toLowerCase().trim();

          // Match by original filename first (most accurate for file re-uploads)
          if (existingFilename && existingFilename === normalizedTitle) {
            return true;
          }

          // Fallback: match by title for legacy tracks without originalFilename
          if (!existingFilename && existingTitle === normalizedTitle) {
            return true;
          }

          return false;
        });

        if (match) {
          duplicates.push({
            title: incoming.title,
            artist: match.artist,
            existingTrackId: match.id,
            existingTrack: match,
          });
        }
      }

      return reply.send({ duplicates });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request body', details: error.errors });
      }
      throw error;
    }
  });

  // Get similar tracks for Radio mode - ANY AUTHENTICATED USER
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/:id/similar', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const limit = parseInt(request.query.limit || '20', 10);

    const sourceTrack = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    if (!sourceTrack) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Get all tracks except the source
    const allTracks = await db.query.tracks.findMany();
    const otherTracks = allTracks.filter(t => t.id !== id);

    // Calculate similarity score for each track
    const scoredTracks = otherTracks.map(track => {
      let score = 0;

      // Same artist = high score (40 points)
      if (sourceTrack.artist && track.artist) {
        const sourceArtistLower = sourceTrack.artist.toLowerCase();
        const trackArtistLower = track.artist.toLowerCase();
        if (sourceArtistLower === trackArtistLower) {
          score += 40;
        } else if (sourceArtistLower.includes(trackArtistLower) || trackArtistLower.includes(sourceArtistLower)) {
          score += 20; // Partial artist match
        }
      }

      // Same album = medium score (15 points)
      if (sourceTrack.album && track.album && sourceTrack.album.toLowerCase() === track.album.toLowerCase()) {
        score += 15;
      }

      // Similar BPM = medium score (20 points)
      if (areBpmsSimilar(sourceTrack.bpm, track.bpm)) {
        score += 20;
        // Bonus for very close BPM
        if (sourceTrack.bpm && track.bpm && Math.abs(sourceTrack.bpm - track.bpm) <= 5) {
          score += 10;
        }
      }

      // Compatible key = medium score (15 points)
      if (areKeysCompatible(sourceTrack.key, track.key)) {
        score += 15;
        // Bonus for same key
        if (sourceTrack.key && track.key && sourceTrack.key === track.key) {
          score += 10;
        }
      }

      // Similar energy = medium score (20 points)
      if (areEnergiesSimilar(sourceTrack.energy, track.energy)) {
        score += 20;
        // Bonus for very close energy
        if (sourceTrack.energy && track.energy && Math.abs(sourceTrack.energy - track.energy) <= 10) {
          score += 10;
        }
      }

      return { track, score };
    });

    // Sort by score descending, then add some randomness for variety
    scoredTracks.sort((a, b) => {
      // Group into tiers and randomize within tiers
      const tierA = Math.floor(a.score / 20);
      const tierB = Math.floor(b.score / 20);
      if (tierA !== tierB) {
        return tierB - tierA;
      }
      // Randomize within the same tier
      return Math.random() - 0.5;
    });

    // Return top N similar tracks
    const similarTracks = scoredTracks.slice(0, limit).map(st => ({
      ...st.track,
      similarityScore: st.score,
    }));

    return reply.send({
      sourceTrack,
      similarTracks,
    });
  });

  // Analyze existing tracks - ADMIN ONLY (for migrating existing library)
  app.post('/analyze-all', {
    preHandler: adminMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Get all tracks that haven't been analyzed yet (energy is null)
    const unanalyzedTracks = await db.query.tracks.findMany();
    const tracksToAnalyze = unanalyzedTracks.filter(t => t.energy === null);

    if (tracksToAnalyze.length === 0) {
      return reply.send({
        message: 'All tracks already analyzed',
        analyzed: 0,
        total: unanalyzedTracks.length,
      });
    }

    let analyzed = 0;
    let failed = 0;

    for (const track of tracksToAnalyze) {
      try {
        const filePath = join(UPLOADS_DIR, '..', track.filePath);
        const analysis = await analyzeAudio(filePath);

        await db.update(tracks)
          .set({
            bpm: analysis.bpm,
            key: analysis.key,
            energy: analysis.energy,
          })
          .where(eq(tracks.id, track.id));

        analyzed++;
        console.log(`Analyzed track ${track.id}: BPM=${analysis.bpm}, Key=${analysis.key}, Energy=${analysis.energy}`);
      } catch (error) {
        failed++;
        console.error(`Failed to analyze track ${track.id}:`, error);
      }
    }

    return reply.send({
      message: 'Analysis complete',
      analyzed,
      failed,
      total: unanalyzedTracks.length,
    });
  });

  // Update track metadata - ADMIN ONLY
  app.patch<{ Params: { id: string }; Body: { title?: string; artist?: string; album?: string } }>('/:id', {
    preHandler: adminMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { title, artist, album } = request.body;

    const track = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    await db.update(tracks)
      .set({
        ...(title && { title }),
        ...(artist !== undefined && { artist }),
        ...(album !== undefined && { album }),
      })
      .where(eq(tracks.id, id));

    const updatedTrack = await db.query.tracks.findFirst({
      where: eq(tracks.id, id),
    });

    return reply.send(updatedTrack);
  });
}
