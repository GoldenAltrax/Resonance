import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';

// Load .env from project root BEFORE importing routes that use env vars
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Ensure data directories exist
const dataDir = join(__dirname, '..', 'data');
const uploadsAudioDir = join(__dirname, '..', 'uploads', 'audio');
const uploadsImagesDir = join(__dirname, '..', 'uploads', 'images');

[dataDir, uploadsAudioDir, uploadsImagesDir].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Dynamic imports to ensure env vars are loaded first
const { authRoutes } = await import('./routes/auth.js');
const { playlistRoutes } = await import('./routes/playlists.js');
const { trackRoutes } = await import('./routes/tracks.js');
const { userRoutes } = await import('./routes/users.js');
const { searchRoutes } = await import('./routes/search.js');
const { adminRoutes } = await import('./routes/admin.js');
const { favoriteRoutes } = await import('./routes/favorites.js');
const { historyRoutes } = await import('./routes/history.js');

const app = Fastify({
  logger: isProduction
    ? { level: 'info' }
    : {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        },
      },
});

// Register plugins
await app.register(cors, {
  origin: isProduction ? true : (process.env.FRONTEND_URL || 'http://localhost:5173'),
  credentials: true,
});

// Global rate limiting - 1000 requests per minute per IP (allows bulk operations)
await app.register(rateLimit, {
  max: 1000,
  timeWindow: '1 minute',
  errorResponseBuilder: (_request, context) => ({
    error: 'Too many requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    retryAfter: Math.ceil(context.ttl / 1000),
  }),
});

// JWT secret is required - fail early if not set
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

await app.register(jwt, {
  secret: jwtSecret,
});

await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// Serve uploaded files
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'uploads'),
  prefix: '/uploads/',
  decorateReply: !isProduction, // Only decorate if not in production (we'll register another static plugin)
});

// In production, serve frontend build from public folder
if (isProduction) {
  await app.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/',
    decorateReply: false,
  });
}

// Register routes
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(playlistRoutes, { prefix: '/api/playlists' });
await app.register(trackRoutes, { prefix: '/api/tracks' });
await app.register(searchRoutes, { prefix: '/api/search' });
await app.register(adminRoutes, { prefix: '/api/admin' });
await app.register(favoriteRoutes, { prefix: '/api/favorites' });
await app.register(historyRoutes, { prefix: '/api/history' });

// Health check
app.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// SPA fallback - serve index.html for non-API routes in production
if (isProduction) {
  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith('/api') && !request.url.startsWith('/uploads')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not found' });
  });
}

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🎵 Resonance API running on http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
