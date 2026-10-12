import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db, downloadJobs, playlists, tracks } from '../db/index.js';
import { adminMiddleware } from '../middleware/auth.js';
import { searchSongs, searchAlbums, albumTracks, resolveLink, type CatalogTrack } from '../services/catalog.js';
import { enqueue, retry } from '../services/downloader.js';
import { ytdlpVersion, updateYtdlp } from '../services/ytdlp.js';
import { songKey } from '../utils/matching.js';

const ACTIVE = ['queued', 'searching', 'downloading', 'importing'];
const FINISHED = ['done', 'skipped', 'failed'];

const searchSchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(['songs', 'albums']).default('songs'),
});

const catalogTrackSchema = z.object({
  title: z.string().min(1).max(300),
  artist: z.string().max(300).nullable(),
  album: z.string().max(300).nullable().optional(),
  duration: z.number().int().min(0).max(24 * 3600).nullable().optional(),
  coverUrl: z.string().url().max(1000).nullable().optional(),
  externalId: z.string().max(200).nullable().optional(),
});

const requestSchema = z.union([
  z.object({ tracks: z.array(catalogTrackSchema).min(1).max(200) }),
  z.object({ albumId: z.string().regex(/^\d+$/) }),
]);

const linkSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  createPlaylist: z.boolean().optional(),
});

// "Add music": search public catalogs, resolve links and manage the download queue. Admin only.
export async function downloadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', adminMiddleware);

  // Search songs or albums; songs are marked when already in the library or queue
  app.get('/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter something to search for' });
    const { q, type } = parsed.data;

    try {
      if (type === 'albums') return reply.send({ albums: await searchAlbums(q) });

      const songs = await searchSongs(q);
      const library = new Set(
        db.select({ title: tracks.title, artist: tracks.artist }).from(tracks).all().map((t) => songKey(t.title, t.artist))
      );
      const queued = new Set(
        db.select({ title: downloadJobs.title, artist: downloadJobs.artist }).from(downloadJobs)
          .where(inArray(downloadJobs.status, ACTIVE)).all().map((j) => songKey(j.title, j.artist))
      );
      return reply.send({
        songs: songs.map((s) => {
          const key = songKey(s.title, s.artist);
          return { ...s, inLibrary: library.has(key), queued: queued.has(key) };
        }),
      });
    } catch (err) {
      request.log.warn(err, 'catalog search failed');
      return reply.status(502).send({ error: 'Music search is unavailable right now. Try again in a moment.' });
    }
  });

  // Queue songs picked from search results, or a whole album
  app.post('/requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });
    const { userId } = request.user as { userId: string };

    let items: CatalogTrack[];
    let batchLabel: string | null = null;
    if ('albumId' in parsed.data) {
      try {
        const album = await albumTracks(parsed.data.albumId);
        items = album.tracks;
        batchLabel = album.label;
      } catch {
        return reply.status(502).send({ error: 'Could not load that album' });
      }
    } else {
      items = parsed.data.tracks;
    }

    return reply.send({ ...enqueue(items, { requestedBy: userId, batchLabel }), label: batchLabel });
  });

  // Paste a link (YouTube, YouTube Music, Spotify, Apple Music, Deezer)
  app.post('/link', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = linkSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Paste a link first' });
    const { userId } = request.user as { userId: string };

    let resolved;
    try {
      resolved = await resolveLink(parsed.data.url);
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : 'Could not read that link' });
    }

    // Playlists can be recreated as a Resonance playlist in the original order
    let playlistId: string | null = null;
    if (resolved.kind === 'playlist' && parsed.data.createPlaylist) {
      playlistId = uuidv4();
      await db.insert(playlists).values({
        id: playlistId,
        name: resolved.label.slice(0, 100),
        description: `Imported from ${new URL(parsed.data.url).hostname.replace(/^www\./, '')}`,
        userId,
      });
    }

    const result = enqueue(resolved.tracks, {
      requestedBy: userId,
      batchLabel: resolved.kind === 'track' ? null : resolved.label,
      playlistId,
    });
    return reply.send({ ...result, kind: resolved.kind, label: resolved.label, total: resolved.tracks.length, playlistId });
  });

  // Recent jobs, newest first, with counts for the status header
  app.get('/jobs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const jobs = db.select({
      id: downloadJobs.id,
      status: downloadJobs.status,
      title: downloadJobs.title,
      artist: downloadJobs.artist,
      album: downloadJobs.album,
      coverUrl: downloadJobs.coverUrl,
      batchLabel: downloadJobs.batchLabel,
      error: downloadJobs.error,
      trackId: downloadJobs.trackId,
      createdAt: downloadJobs.createdAt,
      updatedAt: downloadJobs.updatedAt,
    }).from(downloadJobs).orderBy(desc(downloadJobs.createdAt)).limit(300).all();

    const counts = Object.fromEntries(
      db.select({ status: downloadJobs.status, count: sql<number>`count(*)` }).from(downloadJobs)
        .groupBy(downloadJobs.status).all().map((r) => [r.status, r.count])
    );
    return reply.send({ jobs, counts });
  });

  app.post('/jobs/:id/retry', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!retry(request.params.id)) return reply.status(409).send({ error: 'Only failed downloads can be retried' });
    return reply.send({ ok: true });
  });

  app.post('/jobs/retry-failed', async (_request: FastifyRequest, reply: FastifyReply) => {
    const failed = db.select({ id: downloadJobs.id }).from(downloadJobs).where(eq(downloadJobs.status, 'failed')).all();
    for (const job of failed) retry(job.id);
    return reply.send({ retried: failed.length });
  });

  // Remove one job from the list. Jobs being worked on can't be cancelled midway.
  app.delete('/jobs/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const job = db.select({ status: downloadJobs.status }).from(downloadJobs).where(eq(downloadJobs.id, request.params.id)).get();
    if (!job) return reply.status(404).send({ error: 'Not found' });
    if (job.status !== 'queued' && !FINISHED.includes(job.status)) {
      return reply.status(409).send({ error: 'This download is in progress' });
    }
    db.delete(downloadJobs).where(eq(downloadJobs.id, request.params.id)).run();
    return reply.status(204).send();
  });

  app.post('/jobs/clear-finished', async (_request: FastifyRequest, reply: FastifyReply) => {
    const removed = db.delete(downloadJobs).where(inArray(downloadJobs.status, FINISHED)).run().changes;
    return reply.send({ removed });
  });

  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const version = await ytdlpVersion();
    return reply.send({ available: version !== null, ytdlpVersion: version });
  });

  // YouTube changes regularly break older yt-dlp versions; this pulls the latest without a rebuild
  app.post('/update-downloader', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const version = await updateYtdlp();
      return reply.send({ ytdlpVersion: version });
    } catch (err) {
      request.log.warn(err, 'yt-dlp update failed');
      return reply.status(500).send({ error: 'Update failed. Rebuilding the Docker image also installs the latest version.' });
    }
  });
}
