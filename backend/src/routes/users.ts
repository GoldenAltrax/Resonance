import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';
import { IMAGES_DIR, resolveStoredFilePath } from '../services/ingest.js';
import { readLimited } from '../utils/upload.js';

// Allowed image extensions whitelist
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// Validate and sanitize file extension
function getSafeExtension(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(ext) ? ext : 'jpg';
}

// Same username rules as signup
const updateUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  email: z.string().email().optional(),
});

const preferencesSchema = z.object({
  volume: z.number().min(0).max(1).optional(),
  isMuted: z.boolean().optional(),
  shuffle: z.boolean().optional(),
  repeat: z.enum(['none', 'one', 'all']).optional(),
  crossfadeEnabled: z.boolean().optional(),
  crossfadeDuration: z.number().min(0).max(12).optional(),
  normalizeVolume: z.boolean().optional(),
  eqEnabled: z.boolean().optional(),
  eqGains: z.array(z.number().min(-12).max(12)).length(10).optional(),
  eqPreset: z.string().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Get user profile
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { userId } = request.user as { userId: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({
      id: user.id,
      username: user.username,
      // Email is private: only returned for your own profile
      email: userId === id ? user.email : null,
      profileImage: user.profileImage,
      createdAt: user.createdAt,
    });
  });

  // Update current user profile
  app.patch('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const { id } = request.params;

      // Can only update own profile
      if (userId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const body = updateUserSchema.parse(request.body);

      // Admin rights follow the ADMIN_USERNAME, so nobody else may take that name
      const current = await db.query.users.findFirst({ columns: { username: true, email: true }, where: eq(users.id, id) });
      if (!current) return reply.status(404).send({ error: 'User not found' });
      if (body.username && body.username !== current.username && body.username === process.env.ADMIN_USERNAME) {
        return reply.status(409).send({ error: 'Username already exists' });
      }
      if (body.username && body.username !== current.username) {
        const taken = await db.query.users.findFirst({ columns: { id: true }, where: eq(users.username, body.username) });
        if (taken) return reply.status(409).send({ error: 'Username already exists' });
      }
      if (body.email && body.email !== current.email) {
        const taken = await db.query.users.findFirst({ columns: { id: true }, where: eq(users.email, body.email) });
        if (taken) return reply.status(409).send({ error: 'Email already in use' });
      }

      await db.update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, id));

      const updated = await db.query.users.findFirst({
        where: eq(users.id, id),
      });

      if (!updated) {
        return reply.status(500).send({ error: 'Failed to retrieve updated user' });
      }

      return reply.send({
        id: updated.id,
        username: updated.username,
        email: updated.email,
        profileImage: updated.profileImage,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Get player preferences
  app.get('/:id/preferences', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    if (userId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    try {
      const preferences = user.preferences ? JSON.parse(user.preferences) : null;
      return reply.send({ preferences });
    } catch {
      return reply.send({ preferences: null });
    }
  });

  // Save player preferences
  app.put('/:id/preferences', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { userId } = request.user as { userId: string };
      const { id } = request.params;

      if (userId !== id) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const prefs = preferencesSchema.parse(request.body);

      await db.update(users)
        .set({ preferences: JSON.stringify(prefs), updatedAt: new Date() })
        .where(eq(users.id, id));

      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid preferences', details: error.errors });
      }
      throw error;
    }
  });

  // Upload profile avatar
  app.post('/:id/avatar', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { userId } = request.user as { userId: string };
    const { id } = request.params;

    // Can only update own profile
    if (userId !== id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const data = await request.file({ limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB limit for avatars
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Validate file type
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validMimeTypes.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Supported: JPEG, PNG, WebP, GIF' });
    }

    // The size limit truncates the stream rather than failing it, so check explicitly
    const fileBuffer = await readLimited(data);
    if (!fileBuffer) {
      return reply.status(413).send({ error: 'File too large. Maximum avatar size is 2MB.' });
    }

    // Generate unique filename with validated extension
    const ext = getSafeExtension(data.filename);
    const filename = `avatar-${id}-${Date.now().toString(36)}.${ext}`; // versioned name: images are cached for 7 days
    const filePath = join(IMAGES_DIR, filename);

    // Delete old avatar if exists and is a local file (secure path resolution)
    if (user.profileImage && user.profileImage.startsWith('images/')) {
      try {
        const oldPath = resolveStoredFilePath(user.profileImage);
        if (oldPath) {
          await unlink(oldPath);
        }
      } catch {
        // Ignore if file doesn't exist
      }
    }

    // Save file from buffer
    await writeFile(filePath, fileBuffer);

    // Update user
    await db.update(users)
      .set({ profileImage: `images/${filename}`, updatedAt: new Date() })
      .where(eq(users.id, id));

    const updated = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!updated) {
      return reply.status(500).send({ error: 'Failed to retrieve updated user' });
    }

    return reply.send({
      id: updated.id,
      username: updated.username,
      email: updated.email,
      profileImage: updated.profileImage,
    });
  });
}
