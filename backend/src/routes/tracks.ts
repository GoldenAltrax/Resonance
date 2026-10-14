import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import { parseFile } from 'music-metadata';
import { z } from 'zod';
import { db, sqlite, tracks, trackSkips, trackPublicColumns } from '../db/index.js';
import { eq, isNull } from 'drizzle-orm';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { generateFingerprint, lookupAcoustID } from '../utils/fingerprint.js';
import {
  artistNames, primaryArtist, similarity, preference, pickStation,
  CrowdTally, type RadioTrack, type SeedSignals, type UserSignals,
} from '../services/radio.js';
import { songKey } from '../utils/matching.js';
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


type LibraryTrack = RadioTrack & { createdAt: Date | null };

/** Playlists and listening sessions that put other tracks next to the seed. */
function loadSeedSignals(seed: LibraryTrack, library: LibraryTrack[], userId: string): SeedSignals {
  const seedArtists = new Set(artistNames(seed.artist));
  const seedArtistTrackIds = library
    .filter((t) => artistNames(t.artist).some((a) => seedArtists.has(a)))
    .map((t) => t.id);
  if (!seedArtistTrackIds.includes(seed.id)) seedArtistTrackIds.push(seed.id);

  // Every playlist holding the seed or another track by its artists, with all its tracks
  const rows = sqlite.prepare(`
    SELECT pt.playlist_id AS playlistId, pt.track_id AS trackId, p.user_id AS ownerId
    FROM playlist_tracks pt
    JOIN playlists p ON p.id = pt.playlist_id
    WHERE pt.playlist_id IN (
      SELECT playlist_id FROM playlist_tracks
      WHERE track_id IN (SELECT value FROM json_each(?))
    )
  `).all(JSON.stringify(seedArtistTrackIds)) as { playlistId: string; trackId: string; ownerId: string }[];

  const members = new Map<string, { ownerId: string; ids: string[] }>();
  for (const r of rows) {
    const playlist = members.get(r.playlistId) ?? { ownerId: r.ownerId, ids: [] };
    playlist.ids.push(r.trackId);
    members.set(r.playlistId, playlist);
  }

  const coPlaylist = new CrowdTally(userId);
  const artistAffinity = new CrowdTally(userId);
  const artistOf = new Map(library.map((t) => [t.id, t.artist]));
  for (const { ownerId, ids } of members.values()) {
    // A playlist of everything says little about any pair in it: big playlists count for less
    const weight = Math.min(1, 50 / ids.length);
    const hasSeed = ids.includes(seed.id);
    const seenArtists = new Set<string>();
    for (const tid of ids) {
      if (tid === seed.id) continue;
      if (hasSeed) coPlaylist.add(tid, weight, ownerId);
      for (const a of artistNames(artistOf.get(tid) ?? null)) {
        if (seedArtists.has(a) || seenArtists.has(a)) continue;
        seenArtists.add(a);
        artistAffinity.add(a, weight, ownerId);
      }
    }
  }

  // Tracks played within 30 minutes after the seed, per listener
  const coPlayRows = sqlite.prepare(`
    SELECT h2.track_id AS trackId, h1.user_id AS userId, COUNT(*) AS n
    FROM play_history h1
    JOIN play_history h2
      ON h2.user_id = h1.user_id
     AND h2.played_at > h1.played_at
     AND h2.played_at <= h1.played_at + 1800
    WHERE h1.track_id = ? AND h2.track_id != h1.track_id
    GROUP BY h2.track_id, h1.user_id
  `).all(seed.id) as { trackId: string; userId: string; n: number }[];
  const coPlay = new CrowdTally(userId);
  for (const r of coPlayRows) coPlay.add(r.trackId, r.n, r.userId);

  // Added within 10 minutes of the seed; a bulk import says little, so big batches count less
  const coAdded = new Map<string, number>();
  const addedAt = seed.createdAt?.getTime();
  if (addedAt != null) {
    const batch = library.filter(
      (t) => t.id !== seed.id && t.createdAt && Math.abs(t.createdAt.getTime() - addedAt) <= 10 * 60 * 1000
    );
    const weight = Math.min(1, 15 / Math.max(batch.length, 1));
    for (const t of batch) coAdded.set(t.id, weight);
  }

  return {
    coPlaylist: coPlaylist.totals(),
    coPlay: coPlay.totals(),
    artistAffinity: artistAffinity.totals(),
    coAdded,
  };
}

/** Artists credited on two or more of the last five tracks heard. */
function fatiguedArtists(recent: { artist: string | null }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const t of recent.slice(-5)) {
    for (const a of new Set(artistNames(t.artist))) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= 2).map(([a]) => a));
}

function loadUserSignals(userId: string, recent: { id: string; artist: string | null }[]): UserSignals {
  const favorites = new Set(
    (sqlite.prepare('SELECT track_id AS trackId FROM favorites WHERE user_id = ?').all(userId) as { trackId: string }[])
      .map((r) => r.trackId)
  );

  const history = sqlite.prepare(`
    SELECT track_id AS trackId, COUNT(*) AS n, MAX(played_at) AS last
    FROM play_history WHERE user_id = ? GROUP BY track_id
  `).all(userId) as { trackId: string; n: number; last: number }[];

  const skips = sqlite.prepare(`
    SELECT track_id AS trackId, COUNT(*) AS n
    FROM track_skips WHERE user_id = ? AND skip_position < 30
    GROUP BY track_id
  `).all(userId) as { trackId: string; n: number }[];

  return {
    favorites,
    playCounts: new Map(history.map((h) => [h.trackId, h.n])),
    lastPlayed: new Map(history.map((h) => [h.trackId, h.last * 1000])),
    earlySkips: new Map(skips.map((s) => [s.trackId, s.n])),
    recentArtists: fatiguedArtists(recent),
    now: Date.now(),
  };
}

let fingerprintRunning = false;

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

    // Field names match the frontend's AlbumSummary
    type AlbumEntry = {
      album: string;
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
          album: key,
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
      a.album.localeCompare(b.album)
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
      // The size limit truncates the stream instead of failing it; don't import half a song
      if (data.file.truncated) {
        await unlink(tempFilePath).catch(() => {});
        return reply.status(413).send({ error: 'File too large. Maximum size is 100MB.' });
      }

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

  // Radio: tracks that fit after a seed - ANY AUTHENTICATED USER
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; excludeIds?: string; recentIds?: string; anchorId?: string };
  }>('/:id/similar', {
    preHandler: authMiddleware,
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId } = request.user as { userId: string };
    const limitRaw = parseInt(request.query.limit || '30', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 30; // 1–50
    const idList = (raw?: string, max = 300) => (raw ? raw.split(',').filter(Boolean).slice(0, max) : []);

    // Already queued or played this session
    const excludeIds = new Set(idList(request.query.excludeIds));
    // The last few tracks heard, most recent last: their artists are penalized
    const recentIds = idList(request.query.recentIds, 10);
    // The station's original seed: keeps a long station from drifting away from it
    const anchorId = request.query.anchorId && request.query.anchorId !== id ? request.query.anchorId : null;

    const allTracks = await db.query.tracks.findMany({ columns: trackPublicColumns });
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    const sourceTrack = byId.get(id);
    if (!sourceTrack) {
      return reply.status(404).send({ error: 'Track not found' });
    }
    const anchorTrack = anchorId ? byId.get(anchorId) ?? null : null;

    const seedSignals = loadSeedSignals(sourceTrack, allTracks, userId);
    const anchorSignals = anchorTrack ? loadSeedSignals(anchorTrack, allTracks, userId) : null;
    const user = loadUserSignals(userId, recentIds.map((rid) => byId.get(rid)).filter((t) => t !== undefined));

    const scored = allTracks
      .filter((t) => t.id !== id && t.id !== anchorId && !excludeIds.has(t.id))
      .map((track) => {
        let score = similarity(sourceTrack, track, seedSignals) + preference(track, user);
        if (anchorTrack && anchorSignals) score += 0.5 * similarity(anchorTrack, track, anchorSignals);
        return { track, score };
      });

    // Other copies of the seed, of what's queued and of what was just heard are out too
    const keyOf = (t: { title: string; artist: string | null }) => songKey(t.title, t.artist);
    const blockedSongs = new Set(
      [id, ...(anchorId ? [anchorId] : []), ...excludeIds, ...recentIds]
        .map((tid) => byId.get(tid))
        .filter((t) => t !== undefined)
        .map(keyOf)
    );
    const lastHeard = recentIds.length > 0 ? byId.get(recentIds[recentIds.length - 1]!) : sourceTrack;
    const picked = pickStation(scored, limit, {
      previousArtist: lastHeard ? primaryArtist(lastHeard) : undefined,
      songKey: keyOf,
      blockedSongs,
    });

    return reply.send({
      sourceTrack,
      // Scores stay server-side: they partly come from other people's playlists and listening
      similarTracks: picked.map((st) => st.track),
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
    // A second run would fingerprint the same tracks and double the AcoustID request rate
    if (fingerprintRunning) {
      return reply.status(202).send({ message: 'Fingerprinting already running', processed: 0, total: toFingerprint.length });
    }
    fingerprintRunning = true;

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
    })()
      .catch(err => console.error('fingerprint-all background task failed:', err))
      .finally(() => { fingerprintRunning = false; });
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
