import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
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

    // Get tracks data
    const favoriteTracks = await db.query.tracks.findMany({
      where: (tracks, { inArray }) => inArray(tracks.id, trackIds.length > 0 ? trackIds : ['']),
    });

    // Combine favorites with track data
    const result = userFavorites.map(fav => {
      const track = favoriteTracks.find(t => t.id === fav.trackId);
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
      where: eq(tracks.id, trackId),
    });

    if (!track) {
      return reply.status(404).send({ error: 'Track not found' });
    }

    // Check if already favorited
    const existing = await db.query.favorites.findFirst({
      where: and(eq(favorites.userId, userId), eq(favorites.trackId, trackId)),
    });

    if (existing) {
      return reply.status(200).send({ message: 'Track already in favorites', favorite: existing });
    }

    // Add to favorites
    const favoriteId = uuidv4();
    await db.insert(favorites).values({
      id: favoriteId,
      userId,
      trackId,
    });

    const favorite = await db.query.favorites.findFirst({
      where: eq(favorites.id, favoriteId),
    });

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
