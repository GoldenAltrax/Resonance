import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { db, users, tracks, playlists, inviteCodes } from '../db/index.js';
import { eq, count, desc, sql } from 'drizzle-orm';
import { adminMiddleware, isAdmin } from '../middleware/auth.js';
import crypto from 'crypto';
import { unlink } from 'fs/promises';
import { resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const UPLOADS_BASE = resolve(__dirname, '..', '..', 'uploads');

// Resolve a stored upload path ("audio/x.mp3", "images/y.jpg"), refusing anything outside uploads/
function resolveStoredFilePath(storedPath: string): string | null {
  const fullPath = resolve(UPLOADS_BASE, storedPath);
  return fullPath.startsWith(UPLOADS_BASE + sep) ? fullPath : null;
}

// Generate a random invite code with sufficient entropy (8 bytes = 64 bits)
function generateInviteCode(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

const createInviteCodeSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateInviteCodeSchema = z.object({
  maxUses: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  // Apply admin middleware to all routes in this plugin
  app.addHook('preHandler', adminMiddleware);

  // Get admin dashboard stats
  app.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    const userCountResult = await db.select({ count: count() }).from(users);
    const trackCountResult = await db.select({ count: count() }).from(tracks);
    const playlistCountResult = await db.select({ count: count() }).from(playlists);
    const inviteCodeCountResult = await db.select({ count: count() }).from(inviteCodes);

    // Get active invite codes count
    const activeInviteCountResult = await db
      .select({ count: count() })
      .from(inviteCodes)
      .where(eq(inviteCodes.isActive, true));

    return reply.send({
      users: userCountResult[0]?.count ?? 0,
      tracks: trackCountResult[0]?.count ?? 0,
      playlists: playlistCountResult[0]?.count ?? 0,
      inviteCodes: inviteCodeCountResult[0]?.count ?? 0,
      activeInviteCodes: activeInviteCountResult[0]?.count ?? 0,
    });
  });

  // Get all users with counts (single query using subqueries - eliminates N+1)
  app.get('/users', async (_request: FastifyRequest, reply: FastifyReply) => {
    const usersWithStats = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        profileImage: users.profileImage,
        createdAt: users.createdAt,
        trackCount: sql<number>`(SELECT COUNT(*) FROM tracks WHERE tracks.user_id = users.id)`.as('track_count'),
        playlistCount: sql<number>`(SELECT COUNT(*) FROM playlists WHERE playlists.user_id = users.id)`.as('playlist_count'),
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return reply.send(usersWithStats.map((u) => ({ ...u, isAdmin: isAdmin(u.username, u.email) })));
  });

  // Delete a user and their personal data: playlists, likes, play history, skips, avatar.
  // The library is shared, so tracks they uploaded stay and are handed to the admin doing
  // the delete (tracks.user_id cascades, so it must be reassigned first).
  app.delete('/users/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { userId } = request.user as { userId: string };

    if (id === userId) {
      return reply.status(400).send({ error: 'You cannot delete your own account' });
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    if (isAdmin(user.username, user.email)) {
      return reply.status(400).send({ error: 'Admin accounts cannot be deleted' });
    }

    const ownedPlaylists = await db
      .select({ coverImage: playlists.coverImage })
      .from(playlists)
      .where(eq(playlists.userId, id));

    const files = [...ownedPlaylists.map((p) => p.coverImage), user.profileImage]
      .filter((p): p is string => !!p && !p.startsWith('http'));

    const tracksKept = db.transaction((tx) => {
      const moved = tx.update(tracks).set({ userId }).where(eq(tracks.userId, id)).run().changes;
      tx.delete(users).where(eq(users.id, id)).run();
      return moved;
    });

    // Rows are gone at this point; a missing file is not an error
    await Promise.all(
      files.map(async (stored) => {
        const fullPath = resolveStoredFilePath(stored);
        if (fullPath) await unlink(fullPath).catch(() => {});
      })
    );

    request.log.info({ deletedUser: user.username, playlists: ownedPlaylists.length, tracksKept }, 'user deleted');
    return reply.send({ playlists: ownedPlaylists.length, tracksKept });
  });

  // Get all invite codes
  app.get('/invite-codes', async (_request: FastifyRequest, reply: FastifyReply) => {
    const allCodes = await db.query.inviteCodes.findMany({
      orderBy: [desc(inviteCodes.createdAt)],
    });

    return reply.send(allCodes);
  });

  // Create new invite code
  app.post('/invite-codes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = createInviteCodeSchema.parse(request.body);
      const { userId } = request.user as { userId: string };

      const code = body.code || generateInviteCode();

      // Check if code already exists
      const existing = await db.query.inviteCodes.findFirst({
        where: eq(inviteCodes.code, code),
      });

      if (existing) {
        return reply.status(400).send({ error: 'Invite code already exists' });
      }

      const id = uuidv4();
      await db.insert(inviteCodes).values({
        id,
        code,
        maxUses: body.maxUses ?? null,
        createdBy: userId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });

      const newCode = await db.query.inviteCodes.findFirst({
        where: eq(inviteCodes.id, id),
      });

      return reply.status(201).send(newCode);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Update invite code
  app.patch('/invite-codes/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const body = updateInviteCodeSchema.parse(request.body);

      const existing = await db.query.inviteCodes.findFirst({
        where: eq(inviteCodes.id, id),
      });

      if (!existing) {
        return reply.status(404).send({ error: 'Invite code not found' });
      }

      const updateData: Record<string, unknown> = {};
      if (body.maxUses !== undefined) updateData.maxUses = body.maxUses;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;
      if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

      await db.update(inviteCodes).set(updateData).where(eq(inviteCodes.id, id));

      const updated = await db.query.inviteCodes.findFirst({
        where: eq(inviteCodes.id, id),
      });

      return reply.send(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Delete invite code
  app.delete('/invite-codes/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const existing = await db.query.inviteCodes.findFirst({
      where: eq(inviteCodes.id, id),
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Invite code not found' });
    }

    await db.delete(inviteCodes).where(eq(inviteCodes.id, id));

    return reply.status(204).send();
  });
}
