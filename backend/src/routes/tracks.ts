import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { db, tracks, favorites, playHistory, trackSkips, trackPublicColumns } from '../db/index.js';
import { eq, ne, sql, and, isNull } from 'drizzle-orm';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { generateFingerprint, lookupAcoustID } from '../utils/fingerprint.js';
import { ingestAudioFile, backfillAnalysis, resolveStoredFilePath, TEMP_DIR, UPLOADS_BASE } from '../services/ingest.js';

// Schema for logging a track skip
const skipTrackSchema = z.object({
  position: z.number().int().min(0).max(100),
});

// Schema for updating track metadata
const updateTrackSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  artist: z.string().max(200).trim().nullable().optional(),
  album: z.string().max(200).trim().nullable().optional(),
});


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
  // Get albums (grouped by album tag) — ANY AUTHENTICATED USER
  // NOTE: registered before /:id so Fastify's static-path priority applies
  app.get('/albums', {
    preHandler: authMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const allTracks = await db.query.tracks.findMany({
      columns: trackPublicColumns,
      orderBy: (tracks, { asc }) => [asc(tracks.album), asc(tracks.title)],
    });

    type AlbumEntry = {
      name: string;
      artist: string | null;
      coverArt: string | null;
      trackCount: number;
      tracks: typeof allTracks;
    };

    const albumMap = new Map<string, AlbumEntry>();

    for (const track of allTracks) {
      const key = (track.album || '').trim() || 'Unknown Album';
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          name: key,
          artist: track.artist,
          coverArt: track.coverArt ?? null,
          trackCount: 0,
          tracks: [],
        });
      }
      const entry = albumMap.get(key)!;
      entry.trackCount++;
      entry.tracks.push(track);
      // Use the first cover art we find for this album
      if (!entry.coverArt && track.coverArt) {
        entry.coverArt = track.coverArt;
      }
    }

    const albums = Array.from(albumMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return reply.send({ albums });
  });

  // Get all tracks - ANY AUTHENTICATED USER (the library is shared; upload/edit/delete stay admin-only)
  app.get('/', {
    preHandler: authMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const allTracks = await db.query.tracks.findMany({
      columns: trackPublicColumns,
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
      columns: trackPublicColumns,
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    return reply.send(track);
  });

  // Upload new track - ADMIN ONLY. Processing (tags, duplicate check, transcoding, analysis) lives in services/ingest.ts
  app.post('/', {
    preHandler: adminMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    const data = await request.file({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB limit for original files

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Validate file type. Browsers report inconsistent MIME types for FLAC/WAV/M4A
    // (e.g. audio/x-flac, audio/wave, or application/octet-stream), so accept by extension too.
    const validMimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/x-flac', 'audio/m4a', 'audio/aac', 'audio/x-m4a', 'audio/mp4'];
    const validExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
    const uploadExt = data.filename.split('.').pop()?.toLowerCase() ?? '';
    if (!validMimeTypes.includes(data.mimetype) && !validExtensions.includes(uploadExt)) {
      return reply.status(400).send({ error: 'Invalid file type. Supported: MP3, WAV, OGG, FLAC, M4A, AAC' });
    }

    const originalExt = validExtensions.includes(uploadExt) ? uploadExt : 'mp3';
    const tempFilePath = join(TEMP_DIR, `${uuidv4()}_upload.${originalExt}`);

    try {
      await pipeline(data.file, createWriteStream(tempFilePath));

      const result = await ingestAudioFile({
        sourcePath: tempFilePath,
        originalFilename: data.filename.replace(/\.[^/.]+$/, ''),
        userId,
        // ?force=true skips duplicate detection once the admin has confirmed the override
        force: (request.query as Record<string, string>)?.force === 'true',
      });

      if (result.status === 'duplicate') {
        return reply.status(409).send({ duplicate: result.duplicate });
      }

      const track = await db.query.tracks.findFirst({
        columns: trackPublicColumns,
        where: eq(tracks.id, result.trackId),
      });

      return reply.status(201).send(track);
    } catch (error) {
      await unlink(tempFilePath).catch(() => {});
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
      columns: { filePath: true, coverArt: true },
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Delete audio file from filesystem (secure path resolution)
    try {
      const filePath = resolveStoredFilePath(track.filePath);
      if (filePath) {
        await unlink(filePath);
      }
    } catch (err) {
      console.warn('Failed to delete track file:', err);
    }

    // Delete cover art if present
    if (track.coverArt) {
      try {
        const coverPath = resolveStoredFilePath(track.coverArt);
        if (coverPath) await unlink(coverPath);
      } catch {
        // Ignore — cover art may not exist
      }
    }

    await db.delete(tracks).where(eq(tracks.id, id));

    return reply.status(204).send();
  });

  // Serve cover art for a track - ANY AUTHENTICATED USER
  app.get<{ Params: { id: string } }>('/:id/cover', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      columns: { coverArt: true },
      where: eq(tracks.id, id),
    });

    if (!track || !track.coverArt) {
      return reply.status(404).send({ error: 'No cover art' });
    }

    return reply.redirect(`/uploads/${track.coverArt}`);
  });

  // Stream track audio - ANY AUTHENTICATED USER
  app.get<{ Params: { id: string } }>('/:id/stream', {
    preHandler: authMiddleware,
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      columns: { filePath: true },
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    const filePath = resolveStoredFilePath(track.filePath);
    if (!filePath) {
      return reply.status(404).send({ error: 'Track file not found' });
    }

    // sendFile handles Range requests (seeking, progressive playback) and ETags.
    // Audio files are immutable (UUID names), so the browser may cache them privately.
    reply.header('Cache-Control', 'private, max-age=604800');
    return reply.sendFile(track.filePath, UPLOADS_BASE, { cacheControl: false });
  });

  // Get similar tracks for Radio mode - ANY AUTHENTICATED USER
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; excludeIds?: string; recentArtists?: string };
  }>('/:id/similar', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.user as { userId: string };
    const limitRaw = parseInt(request.query.limit || '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 30; // 1–50

    // Comma-separated IDs to exclude (already in queue)
    const excludeIds = request.query.excludeIds
      ? request.query.excludeIds.split(',').filter(Boolean)
      : [];

    // Comma-separated artists played recently (apply penalty for repetition)
    const recentArtists = request.query.recentArtists
      ? request.query.recentArtists.split(',').filter(Boolean).map(a => a.toLowerCase())
      : [];

    const sourceTrack = await db.query.tracks.findFirst({
      columns: trackPublicColumns,
      where: eq(tracks.id, id),
    });

    if (!sourceTrack) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Get all tracks except the source
    const allOtherTracks = await db.query.tracks.findMany({
      columns: trackPublicColumns,
      where: ne(tracks.id, id),
    });

    // Apply excludeIds filter in-memory
    const excludeSet = new Set(excludeIds);
    const otherTracks = excludeSet.size > 0
      ? allOtherTracks.filter(t => !excludeSet.has(t.id))
      : allOtherTracks;

    // Get user's favorited track IDs for boost scoring
    const userFavorites = await db.query.favorites.findMany({
      where: eq(favorites.userId, userId),
      columns: { trackId: true },
    });
    const favoritedIds = new Set(userFavorites.map(f => f.trackId));

    // Get user's recent play history IDs (last 200) for boost scoring
    const userHistory = await db.query.playHistory.findMany({
      where: eq(playHistory.userId, userId),
      columns: { trackId: true },
      orderBy: (playHistory, { desc }) => [desc(playHistory.playedAt)],
      limit: 200,
    });
    const historiedIds = new Set(userHistory.map(h => h.trackId));

    // Get early-skip counts per track (skipped at <30% three or more times = penalty)
    const skipCounts = await db.select({
      trackId: trackSkips.trackId,
      count: sql<number>`count(*)`,
    })
      .from(trackSkips)
      .where(and(eq(trackSkips.userId, userId), sql`${trackSkips.skipPosition} < 30`))
      .groupBy(trackSkips.trackId);
    const earlySkipMap = new Map(skipCounts.map(s => [s.trackId, Number(s.count)]));

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
        if (sourceTrack.bpm && track.bpm && Math.abs(sourceTrack.bpm - track.bpm) <= 5) {
          score += 10;
        }
      }

      // Compatible key = medium score (15 points)
      if (areKeysCompatible(sourceTrack.key, track.key)) {
        score += 15;
        if (sourceTrack.key && track.key && sourceTrack.key === track.key) {
          score += 10;
        }
      }

      // Similar energy = medium score (20 points)
      if (areEnergiesSimilar(sourceTrack.energy, track.energy)) {
        score += 20;
        if (sourceTrack.energy && track.energy && Math.abs(sourceTrack.energy - track.energy) <= 10) {
          score += 10;
        }
      }

      // Favorites boost (+15) — user has liked this track
      if (favoritedIds.has(track.id)) {
        score += 15;
      }

      // History boost (+10) — user has played this before (they like it)
      if (historiedIds.has(track.id)) {
        score += 10;
      }

      // Recent artist penalty (-20) — avoid repeating the same artist back-to-back
      if (track.artist && recentArtists.includes(track.artist.toLowerCase())) {
        score -= 20;
      }

      // Early skip penalty (-25) — user consistently skips this track early
      const skipCount = earlySkipMap.get(track.id) ?? 0;
      if (skipCount >= 3) {
        score -= 25;
      }

      return { track, score };
    });

    // Sort by score tier descending, random order within a tier for variety.
    // Shuffle first, then stable-sort by tier (a random comparator is biased and inconsistent).
    const tier = (score: number) => Math.floor(score / 20);
    for (let i = scoredTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [scoredTracks[i], scoredTracks[j]] = [scoredTracks[j]!, scoredTracks[i]!];
    }
    scoredTracks.sort((a, b) => tier(b.score) - tier(a.score));

    // Apply artist variety: max 2 tracks per artist in the result
    const artistCount = new Map<string, number>();
    const varietyFiltered: typeof scoredTracks = [];
    for (const st of scoredTracks) {
      const artistKey = st.track.artist?.toLowerCase() ?? '__unknown__';
      const count = artistCount.get(artistKey) ?? 0;
      if (count < 2) {
        varietyFiltered.push(st);
        artistCount.set(artistKey, count + 1);
      }
      if (varietyFiltered.length >= limit) break;
    }

    const similarTracks = varietyFiltered.map(st => ({
      ...st.track,
      similarityScore: st.score,
    }));

    return reply.send({
      sourceTrack,
      similarTracks,
    });
  });

  // Log a track skip (for smart recommendation penalty) - ANY AUTHENTICATED USER
  app.post<{ Params: { id: string } }>('/:id/skip', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.user as { userId: string };

    let body: { position: number };
    try {
      body = skipTrackSchema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }

    const track = await db.query.tracks.findFirst({
      columns: { id: true },
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    await db.insert(trackSkips).values({
      id: uuidv4(),
      userId,
      trackId: id,
      skipPosition: body.position,
    });

    return reply.status(201).send({ ok: true });
  });

  // Analyze tracks missing energy/loudness - ADMIN ONLY (also runs automatically at startup)
  app.post('/analyze-all', {
    preHandler: adminMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const queued = await backfillAnalysis();
    if (queued === null) {
      return reply.status(202).send({ message: 'Analysis already running', analyzed: 0, failed: 0, total: 0 });
    }
    if (queued === 0) {
      return reply.send({ message: 'All tracks already analyzed', analyzed: 0, failed: 0, total: 0 });
    }
    // Analysis runs in the background (can take minutes for a large library)
    return reply.status(202).send({ message: 'Analysis started', analyzed: 0, failed: 0, total: queued });
  });

  // Fingerprint existing tracks that haven't been fingerprinted yet — ADMIN ONLY
  app.post('/fingerprint-all', {
    preHandler: adminMiddleware,
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const toFingerprint = await db.select({ id: tracks.id, filePath: tracks.filePath })
      .from(tracks)
      .where(isNull(tracks.acoustidFingerprint));

    if (toFingerprint.length === 0) {
      return reply.send({ message: 'All tracks already fingerprinted', processed: 0, total: 0 });
    }

    // Return immediately — fingerprinting runs in the background
    reply.status(202).send({ message: 'Fingerprinting started', total: toFingerprint.length });

    // Fire-and-forget
    (async () => {
      let processed = 0;
      let failed = 0;

      for (const track of toFingerprint) {
        const filePath = resolveStoredFilePath(track.filePath);
        if (!filePath) { failed++; continue; }

        try {
          const fp = await generateFingerprint(filePath);
          if (!fp) { failed++; continue; }

          const acoustidResult = await lookupAcoustID(fp.fingerprint, fp.duration);

          await db.update(tracks)
            .set({
              acoustidFingerprint: fp.fingerprint,
              acoustidId: acoustidResult?.acoustidId ?? null,
              musicbrainzRecordingId: acoustidResult?.musicbrainzRecordingId ?? null,
            })
            .where(eq(tracks.id, track.id));

          processed++;
          console.log(`Fingerprinted track ${track.id}: mbid=${acoustidResult?.musicbrainzRecordingId ?? 'none'}`);

          // Rate-limit AcoustID to 1 req/sec (sleep AFTER each lookup)
          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          failed++;
          console.error(`Failed to fingerprint track ${track.id}:`, err);
        }
      }

      console.log(`Fingerprinting complete: ${processed} processed, ${failed} failed of ${toFingerprint.length}`);
    })().catch(err => console.error('fingerprint-all background task failed:', err));
  });

  // Update track metadata - ADMIN ONLY
  app.patch<{ Params: { id: string } }>('/:id', {
    preHandler: adminMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;

    let body: z.infer<typeof updateTrackSchema>;
    try {
      body = updateTrackSchema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }

    const track = await db.query.tracks.findFirst({
      columns: { id: true },
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    await db.update(tracks)
      .set({
        ...(body.title !== undefined && { title: body.title }),
        ...(body.artist !== undefined && { artist: body.artist }),
        ...(body.album !== undefined && { album: body.album }),
      })
      .where(eq(tracks.id, id));

    const updatedTrack = await db.query.tracks.findFirst({
      columns: trackPublicColumns,
      where: eq(tracks.id, id),
    });

    return reply.send(updatedTrack);
  });

  // Get lyrics for a track (extracted from ID3 tags)
  app.get<{ Params: { id: string } }>('/:id/lyrics', {
    preHandler: [authMiddleware],
  }, async (request, reply) => {
    const { id } = request.params;

    const track = await db.query.tracks.findFirst({
      columns: { filePath: true },
      where: eq(tracks.id, id),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    const filePath = resolveStoredFilePath(track.filePath);
    if (!filePath) {
      return reply.status(404).send({ error: 'Track file not found' });
    }

    try {
      const metadata = await parseFile(filePath, { skipCovers: true });
      let lyrics: string | null = null;
      let synced: { time: number; text: string }[] | null = null;

      if (metadata.native) {
        for (const format of Object.values(metadata.native)) {
          for (const tag of format) {
            // Unsynchronized lyrics (USLT)
            if ((tag.id === 'USLT' || tag.id === 'LYRICS') && tag.value) {
              const val = tag.value as { text?: string } | string;
              lyrics = typeof val === 'string' ? val : (val.text ?? null);
            }
            // Synchronized lyrics (SYLT)
            if (tag.id === 'SYLT' && tag.value) {
              const val = tag.value as { entries?: Array<{ text: string; timestamp: number }> };
              if (val.entries) {
                synced = val.entries.map((e) => ({
                  time: e.timestamp / 1000,
                  text: e.text,
                }));
              }
            }
          }
        }
      }

      // Also check common tags
      if (!lyrics && metadata.common.lyrics?.length) {
        lyrics = metadata.common.lyrics.join('\n');
      }

      return reply.send({ lyrics, synced });
    } catch {
      return reply.send({ lyrics: null, synced: null });
    }
  });
}
