import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { db, trackPublicColumns } from '../db/index.js';
import { favorites, tracks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

export async function favoriteRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Get all favorites for current user
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    // Get favorites with track data
    const userFavorites = await db.query.favorites.findMany({
      where: eq(favorites.userId, userId),
      orderBy: (favorites, { desc }) => [desc(favorites.addedAt)],
    });

    // Get track IDs from favorites
    const trackIds = userFavorites.map(f => f.trackId);
    if (trackIds.length === 0) return reply.send([]);

    // Get tracks data
    const favoriteTracks = await db.query.tracks.findMany({
      columns: trackPublicColumns,
      where: (tracks, { inArray }) => inArray(tracks.id, trackIds),
    });

    // Combine favorites with track data
    const trackById = new Map(favoriteTracks.map(t => [t.id, t]));
    const result = userFavorites.map(fav => {
      const track = trackById.get(fav.trackId);
      return {
        ...fav,
        track,
      };
    }).filter(f => f.track); // Only include favorites with valid tracks

    return reply.send(result);
  });

  // Get just the favorite track IDs (for quick checking)
  app.get('/ids', async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };

    const userFavorites = await db.query.favorites.findMany({
      where: eq(favorites.userId, userId),
      columns: { trackId: true },
    });

    const trackIds = userFavorites.map(f => f.trackId);
    return reply.send({ trackIds });
  });

  // Add track to favorites
  app.post('/:trackId', async (request: FastifyRequest<{ Params: { trackId: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { trackId } = request.params;

    // Check if track exists in global library (no ownership check)
    const track = await db.query.tracks.findFirst({
      columns: { id: true },
      where: eq(tracks.id, trackId),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Idempotent insert: the unique (user_id, track_id) index makes double-clicks harmless
    const inserted = await db.insert(favorites)
      .values({ id: uuidv4(), userId, trackId })
      .onConflictDoNothing()
      .returning();

    const favorite = inserted[0] ?? await db.query.favorites.findFirst({
      where: and(eq(favorites.userId, userId), eq(favorites.trackId, trackId)),
    });

    if (!inserted[0]) {
      return reply.status(200).send(favorite);
    }

    return reply.status(201).send(favorite);
  });

  // Remove track from favorites
  app.delete('/:trackId', async (request: FastifyRequest<{ Params: { trackId: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { trackId } = request.params;

    const favorite = await db.query.favorites.findFirst({
      where: and(eq(favorites.userId, userId), eq(favorites.trackId, trackId)),
    });

    if (!favorite) {
      return reply.status(404).send({ error: 'Track not in favorites' });
    }

    await db.delete(favorites).where(eq(favorites.id, favorite.id));

    return reply.status(204).send();
  });

  // Check if a track is favorited
  app.get('/:trackId/check', async (request: FastifyRequest<{ Params: { trackId: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { trackId } = request.params;

    const favorite = await db.query.favorites.findFirst({
      where: and(eq(favorites.userId, userId), eq(favorites.trackId, trackId)),
    });

    return reply.send({ isFavorited: !!favorite });
  });
}
