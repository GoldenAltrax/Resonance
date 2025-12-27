import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const IMAGES_DIR = join(__dirname, '..', '..', 'uploads', 'images');

// Ensure images directory exists
await mkdir(IMAGES_DIR, { recursive: true });

const updateUserSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  email: z.string().email().optional(),
});

export async function userRoutes(app: FastifyInstance) {
  // Apply auth middleware to all routes
  app.addHook('preHandler', authMiddleware);

  // Get user profile
  app.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({
      id: user.id,
      username: user.username,
      email: user.email,
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

    // Check file size (consume stream to check)
    const chunks: Buffer[] = [];
    let totalSize = 0;
    const maxSize = 2 * 1024 * 1024; // 2MB

    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        return reply.status(413).send({ error: 'File too large. Maximum avatar size is 2MB.' });
      }
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);

    // Generate unique filename
    const ext = data.filename.split('.').pop() || 'jpg';
    const filename = `avatar-${id}.${ext}`;
    const filePath = join(IMAGES_DIR, filename);

    // Delete old avatar if exists and is a local file
    if (user.profileImage && user.profileImage.startsWith('images/')) {
      try {
        const oldPath = join(IMAGES_DIR, '..', user.profileImage);
        await unlink(oldPath);
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
