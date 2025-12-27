import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../db/index.js';
import { playHistory, tracks } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const logPlaySchema = z.object({
  trackId: z.string().uuid(),
});

export async function historyRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Get recently played tracks (deduplicated, last 50)
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    // Get all play history sorted by most recent
    const history = await db.query.playHistory.findMany({
      where: eq(playHistory.userId, userId),
      orderBy: [desc(playHistory.playedAt)],
      limit: 100, // Get more than needed for deduplication
    });

    // Deduplicate by trackId, keeping most recent play
    const seenTracks = new Set<string>();
    const uniqueHistory = history.filter(h => {
      if (seenTracks.has(h.trackId)) {
        return false;
      }
      seenTracks.add(h.trackId);
      return true;
    }).slice(0, 50); // Limit to 50 unique tracks

    // Get track IDs
    const trackIds = uniqueHistory.map(h => h.trackId);

    if (trackIds.length === 0) {
      return reply.send([]);
    }

    // Get tracks data
    const tracksData = await db.query.tracks.findMany({
      where: (tracks, { inArray }) => inArray(tracks.id, trackIds),
    });

    // Combine history with track data, maintaining order
    const result = uniqueHistory.map(h => {
      const track = tracksData.find(t => t.id === h.trackId);
      return {
        id: h.id,
        trackId: h.trackId,
        playedAt: h.playedAt,
        track,
      };
    }).filter(h => h.track); // Only include entries with valid tracks

    return reply.send(result);
  });

  // Log a play (called when a track starts playing)
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    try {
      const body = logPlaySchema.parse(request.body);

      // Verify track exists in global library (no ownership check)
      const track = await db.query.tracks.findFirst({
        where: eq(tracks.id, body.trackId),
      });

      if (!track) {
        return reply.status(404).send({ error: 'Track not found' });
      }

      // Add to play history
      const historyId = uuidv4();
      await db.insert(playHistory).values({
        id: historyId,
        userId,
        trackId: body.trackId,
      });

      return reply.status(201).send({ message: 'Play logged', id: historyId });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid request body', details: error.errors });
      }
      throw error;
    }
  });

  // Clear play history
  app.delete('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    await db.delete(playHistory).where(eq(playHistory.userId, userId));

    return reply.status(204).send();
  });
}
