import { FastifyRequest, FastifyReply } from 'fastify';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';

// Admin credentials from environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

interface TokenPayload {
  userId: string;
  username: string;
  /** Issued-at, seconds (added by @fastify/jwt) */
  iat?: number;
}

/**
 * Verifies the JWT (Authorization header, or ?token= for media elements, which can't send
 * headers) and checks it still belongs to a live session: the user must exist, and the token
 * must not predate their last password change. Returns the user, or null.
 */
async function authenticate(request: FastifyRequest) {
  let payload: TokenPayload;
  try {
    payload = await request.jwtVerify<TokenPayload>();
  } catch {
    const token = (request.query as { token?: string } | undefined)?.token;
    if (!token) return null;
    try {
      payload = request.server.jwt.verify<TokenPayload>(token);
      request.user = payload;
    } catch {
      return null;
    }
  }

  const user = await db.query.users.findFirst({
    columns: { id: true, username: true, email: true, passwordChangedAt: true },
    where: eq(users.id, payload.userId),
  });
  if (!user) return null;
  if (user.passwordChangedAt && (payload.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    return null;
  }
  return user;
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  if (!(await authenticate(request))) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const user = await authenticate(request);
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  if (!isAdmin(user.username, user.email)) {
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
