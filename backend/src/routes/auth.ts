import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { db, users, inviteCodes } from '../db/index.js';
import { eq, and, or, isNull, gt } from 'drizzle-orm';
import { isAdmin } from '../middleware/auth.js';

// Password must be 8+ chars with at least: 1 uppercase, 1 lowercase, 1 number
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must be less than 100 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const signupSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: passwordSchema,
  email: z.string().email().optional(),
  secretCode: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// Legacy secret code from environment (no hardcoded fallback)
const LEGACY_SIGNUP_SECRET = process.env.SIGNUP_SECRET;

export async function authRoutes(app: FastifyInstance) {
  // Sign up - strict rate limit: 3 attempts per minute per IP
  app.post('/signup', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = signupSchema.parse(request.body);

      // Verify invite code - check database first, then legacy env var
      let validInviteCode = null;

      if (body.secretCode) {
        // Check invite_codes table
        const now = new Date();
        validInviteCode = await db.query.inviteCodes.findFirst({
          where: and(
            eq(inviteCodes.code, body.secretCode),
            eq(inviteCodes.isActive, true),
            or(
              isNull(inviteCodes.maxUses),
              gt(inviteCodes.maxUses, inviteCodes.usedCount)
            ),
            or(
              isNull(inviteCodes.expiresAt),
              gt(inviteCodes.expiresAt, now)
            )
          ),
        });

        // If not found in database, check legacy env var (only if configured)
        if (!validInviteCode && (!LEGACY_SIGNUP_SECRET || body.secretCode !== LEGACY_SIGNUP_SECRET)) {
          return reply.status(403).send({ error: 'Invalid or expired invitation code' });
        }
      } else {
        return reply.status(403).send({ error: 'Invitation code is required' });
      }

      // Check if username exists
      const existingUsername = await db.query.users.findFirst({
        where: eq(users.username, body.username),
      });

      if (existingUsername) {
        return reply.status(400).send({ error: 'Username already exists' });
      }

      // Check if email exists (if provided)
      if (body.email) {
        const existingEmail = await db.query.users.findFirst({
          where: eq(users.email, body.email),
        });

        if (existingEmail) {
          return reply.status(400).send({ error: 'Email already in use' });
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(body.password, 12);

      // Create user
      const userId = uuidv4();
      await db.insert(users).values({
        id: userId,
        username: body.username,
        email: body.email,
        passwordHash,
      });

      // Increment invite code usage if a database code was used
      if (validInviteCode) {
        await db.update(inviteCodes)
          .set({ usedCount: validInviteCode.usedCount + 1 })
          .where(eq(inviteCodes.id, validInviteCode.id));
      }

      // Generate token
      // JWT expires in 7 days
      const token = app.jwt.sign({ userId, username: body.username }, { expiresIn: '7d' });

      return reply.status(201).send({
        user: {
          id: userId,
          username: body.username,
          email: body.email || null,
          profileImage: null,
          isAdmin: isAdmin(body.username, body.email || null),
        },
        token,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Login - strict rate limit: 5 attempts per minute per IP
  app.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = loginSchema.parse(request.body);

      // Find user
      const user = await db.query.users.findFirst({
        where: eq(users.username, body.username),
      });

      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const valid = await bcrypt.compare(body.password, user.passwordHash);
      if (!valid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Generate token
      // JWT expires in 7 days
      const token = app.jwt.sign({ userId: user.id, username: user.username }, { expiresIn: '7d' });

      return reply.send({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          profileImage: user.profileImage,
          isAdmin: isAdmin(user.username, user.email),
        },
        token,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });

  // Get current user
  app.get('/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decoded = request.user as { userId: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, decoded.userId),
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send({
      id: user.id,
      username: user.username,
      email: user.email,
      profileImage: user.profileImage,
      isAdmin: isAdmin(user.username, user.email),
    });
  });

  // Logout (client-side token removal, but we acknowledge it)
  app.post('/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ message: 'Logged out successfully' });
  });

  // Change password - strict rate limit: 3 attempts per minute per IP
  app.post('/change-password', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
      },
    },
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const changePasswordSchema = z.object({
      currentPassword: z.string(),
      newPassword: passwordSchema, // Same requirements as signup
    });

    try {
      const body = changePasswordSchema.parse(request.body);
      const { userId } = request.user as { userId: string };

      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Verify current password
      const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
      if (!valid) {
        return reply.status(400).send({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(body.newPassword, 12);

      // Update password
      await db.update(users)
        .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));

      return reply.send({ message: 'Password changed successfully' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      throw error;
    }
  });
}
