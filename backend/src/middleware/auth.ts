import { FastifyRequest, FastifyReply } from 'fastify';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';

// Admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  try {
    // First try standard JWT verification (from Authorization header)
    await request.jwtVerify();
  } catch (err) {
    // If header auth fails, try token from query param (for HTML5 Audio/Video elements)
    const token = (request.query as { token?: string })?.token;
    if (token) {
      try {
        const decoded = request.server.jwt.verify<{ userId: string; username: string }>(token);
        // Manually set the user object like jwtVerify does
        request.user = decoded;
        return; // Auth successful via query param
      } catch {
        // Token verification failed
      }
    }
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // First ensure user is authenticated
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  // Check if user is the admin
  const { userId } = request.user as { userId: string };
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !isAdmin(user.username, user.email)) {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

export function isAdmin(username: string, email: string | null): boolean {
  // If admin username not configured, no one is admin
  if (!ADMIN_USERNAME) return false;
  // Username must match
  if (username !== ADMIN_USERNAME) return false;
  // If admin email is configured, it must also match
  if (ADMIN_EMAIL && email !== ADMIN_EMAIL) return false;
  return true;
}
