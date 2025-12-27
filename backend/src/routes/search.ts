import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db, tracks, playlists } from '../db/index.js';
import { or, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

export async function searchRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Search tracks (global) and playlists (user-specific)
  app.get('/', async (request: FastifyRequest<{ Querystring: { q?: string; type?: string; limit?: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { q, type, limit: limitStr } = request.query;

    if (!q || q.trim().length === 0) {
      return reply.send({ tracks: [], playlists: [] });
    }

    const searchTerm = `%${q.trim().toLowerCase()}%`;
    const limit = Math.min(parseInt(limitStr || '20', 10), 50);
    const searchType = type || 'all'; // 'all', 'tracks', 'playlists'

    const results: {
      tracks: typeof tracks.$inferSelect[];
      playlists: typeof playlists.$inferSelect[];
    } = {
      tracks: [],
      playlists: [],
    };

    // Search tracks - GLOBAL (all tracks in the library)
    if (searchType === 'all' || searchType === 'tracks') {
      const trackResults = await db
        .select()
        .from(tracks)
        .where(
          or(
            sql`lower(${tracks.title}) LIKE ${searchTerm}`,
            sql`lower(${tracks.artist}) LIKE ${searchTerm}`,
            sql`lower(${tracks.album}) LIKE ${searchTerm}`
          )
        )
        .limit(limit);

      results.tracks = trackResults;
    }

    // Search playlists - USER SPECIFIC (only user's own playlists)
    if (searchType === 'all' || searchType === 'playlists') {
      const playlistResults = await db
        .select()
        .from(playlists)
        .where(
          sql`${playlists.userId} = ${userId} AND (
            lower(${playlists.name}) LIKE ${searchTerm} OR
            lower(${playlists.description}) LIKE ${searchTerm}
          )`
        )
        .limit(limit);

      results.playlists = playlistResults;
    }

    return reply.send(results);
  });

  // Get all tracks for browsing - GLOBAL
  app.get('/tracks', async (request: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>, reply: FastifyReply) => {
    const { limit: limitStr, offset: offsetStr } = request.query;

    const limit = Math.min(parseInt(limitStr || '50', 10), 100);
    const offset = parseInt(offsetStr || '0', 10);

    const allTracks = await db
      .select()
      .from(tracks)
      .limit(limit)
      .offset(offset)
      .orderBy(tracks.title);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(tracks);

    const total = countResult[0]?.count || 0;

    return reply.send({
      tracks: allTracks,
      total,
      limit,
      offset,
    });
  });
}
