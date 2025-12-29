import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { db, playlists, playlistTracks, tracks } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const IMAGES_DIR = resolve(__dirname, '..', '..', 'uploads', 'images');
const UPLOADS_BASE = resolve(__dirname, '..', '..', 'uploads');

// Ensure images directory exists
await mkdir(IMAGES_DIR, { recursive: true });

// Allowed image extensions whitelist
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// Resolve path from stored path (e.g., "images/playlist-uuid.jpg")
function resolveStoredFilePath(storedPath: string): string | null {
  const fullPath = resolve(UPLOADS_BASE, storedPath);
  if (!fullPath.startsWith(UPLOADS_BASE)) {
    return null;
  }
  return fullPath;
}

// Validate and sanitize file extension
function getSafeExtension(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(ext) ? ext : 'jpg';
}

const createPlaylistSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const updatePlaylistSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

const addTrackSchema = z.object({
  trackId: z.string().uuid(),
});

const reorderTracksSchema = z.object({
  trackIds: z.array(z.string().uuid()),
});

export async function playlistRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Get all playlists for current user
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    const userPlaylists = await db.query.playlists.findMany({
      where: eq(playlists.userId, userId),
      orderBy: (playlists, { desc }) => [desc(playlists.createdAt)],
    });

    return reply.send(userPlaylists);
  });

  // Get single playlist with tracks
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
    });

    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    // Get tracks in playlist
    const playlistTrackList = await db.query.playlistTracks.findMany({
      where: eq(playlistTracks.playlistId, id),
      orderBy: (pt, { asc }) => [asc(pt.position)],
    });

    const trackIds = playlistTrackList.map(pt => pt.trackId);
    const trackList = trackIds.length > 0
      ? await db.query.tracks.findMany({
          where: (tracks, { inArray }) => inArray(tracks.id, trackIds),
        })
      : [];

    // Order tracks by position
    const orderedTracks = playlistTrackList.map(pt =>
      trackList.find(t => t.id === pt.trackId)
    ).filter(Boolean);

    return reply.send({
      ...playlist,
      tracks: orderedTracks,
    });
  });

  // Create playlist
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const body = createPlaylistSchema.parse(request.body);

      const playlistId = uuidv4();
      await db.insert(playlists).values({
        id: playlistId,
        name: body.name,
        description: body.description,
        userId,
      });

      const playlist = await db.query.playlists.findFirst({
        where: eq(playlists.id, playlistId),
      });

      return reply.status(201).send(playlist);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Update playlist
  app.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const { id } = request.params;
      const body = updatePlaylistSchema.parse(request.body);

      const existing = await db.query.playlists.findFirst({
        where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Playlist not found' });
      }

      await db.update(playlists)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(playlists.id, id));

      const updated = await db.query.playlists.findFirst({
        where: eq(playlists.id, id),
      });

      return reply.send(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Delete playlist
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    const existing = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    await db.delete(playlists).where(eq(playlists.id, id));

    return reply.status(204).send();
  });

  // Add track to playlist
  app.post('/:id/tracks', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const { id } = request.params;
      const body = addTrackSchema.parse(request.body);

      // Verify playlist ownership
      const playlist = await db.query.playlists.findFirst({
        where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
      });

      if (!playlist) {
        return reply.status(404).send({ error: 'Playlist not found' });
      }

      // Verify track exists in global library (no ownership check)
      const track = await db.query.tracks.findFirst({
        where: eq(tracks.id, body.trackId),
      });

      if (!track) {
        return reply.status(404).send({ error: 'Track not found' });
      }

      // Get current max position
      const existingTracks = await db.query.playlistTracks.findMany({
        where: eq(playlistTracks.playlistId, id),
      });

      const maxPosition = existingTracks.reduce((max, pt) => Math.max(max, pt.position), 0);

      // Add track to playlist
      await db.insert(playlistTracks).values({
        id: uuidv4(),
        playlistId: id,
        trackId: body.trackId,
        position: maxPosition + 1,
      });

      return reply.status(201).send({ message: 'Track added to playlist' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Remove track from playlist
  app.delete('/:id/tracks/:trackId', async (request: FastifyRequest<{ Params: { id: string; trackId: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id, trackId } = request.params;

    // Verify playlist ownership
    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
    });

    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    await db.delete(playlistTracks)
      .where(and(eq(playlistTracks.playlistId, id), eq(playlistTracks.trackId, trackId)));

    return reply.status(204).send();
  });

  // Reorder tracks in playlist
  app.patch('/:id/reorder', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const { id } = request.params;
      const body = reorderTracksSchema.parse(request.body);

      // Verify playlist ownership
      const playlist = await db.query.playlists.findFirst({
        where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
      });

      if (!playlist) {
        return reply.status(404).send({ error: 'Playlist not found' });
      }

      // Update positions using batch SQL CASE statement (eliminates N+1 queries)
      if (body.trackIds.length > 0) {
        const cases = body.trackIds
          .map((trackId, i) => `WHEN '${trackId}' THEN ${i + 1}`)
          .join(' ');

        await db.run(sql`
          UPDATE playlist_tracks
          SET position = CASE track_id ${sql.raw(cases)} END
          WHERE playlist_id = ${id}
          AND track_id IN (${sql.join(body.trackIds.map(tid => sql`${tid}`), sql`, `)})
        `);
      }

      return reply.send({ message: 'Tracks reordered successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Upload playlist cover image
  app.post('/:id/cover', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    // Verify playlist ownership
    const playlist = await db.query.playlists.findFirst({
      where: and(eq(playlists.id, id), eq(playlists.userId, userId)),
    });

    if (!playlist) {
      return reply.status(404).send({ error: 'Playlist not found' });
    }

    const data = await request.file({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit for cover images
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Validate file type
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validMimeTypes.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Supported: JPEG, PNG, WebP, GIF' });
    }

    // Check file size (consume stream to check)
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const maxSize = 5 * 1024 * 1024; // 5MB

    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        return reply.status(413).send({ error: 'File too large. Maximum size is 5MB.' });
      }
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);

    // Generate unique filename with validated extension
    const ext = getSafeExtension(data.filename);
    const filename = `playlist-${id}.${ext}`;
    const filePath = join(IMAGES_DIR, filename);

    // Delete old cover if exists (secure path resolution)
    if (playlist.coverImage) {
      try {
        const oldPath = resolveStoredFilePath(playlist.coverImage);
        if (oldPath) {
          await unlink(oldPath);
        }
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Save file from buffer
    await writeFile(filePath, fileBuffer);

    // Update playlist
    await db.update(playlists)
      .set({ coverImage: `images/${filename}`, updatedAt: new Date() })
      .where(eq(playlists.id, id));

    const updated = await db.query.playlists.findFirst({
      where: eq(playlists.id, id),
    });

    return reply.send(updated);
  });
}
