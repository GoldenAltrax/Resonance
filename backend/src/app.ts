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
import { classifyUploadUrl } from './utils/uploadPaths.js';

// Load .env from project root BEFORE importing routes that use env vars
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../../.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Ensure data directories exist
const dataDir = join(__dirname, '..', 'data');
const uploadsDir = join(__dirname, '..', 'uploads');
const uploadsAudioDir = join(uploadsDir, 'audio');
const uploadsImagesDir = join(uploadsDir, 'images');
const publicDir = join(__dirname, 'public');

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
const { downloadRoutes } = await import('./routes/downloads.js');
const { assistantRoutes } = await import('./routes/assistant.js');
const { startDownloader } = await import('./services/downloader.js');
const { backfillAnalysis } = await import('./services/ingest.js');
const { sqlite } = await import('./db/index.js');

const app = Fastify({
  // Caddy is the only thing that reaches the app and puts the real client IP in X-Forwarded-For.
  // Without this every visitor shares Caddy's IP, so rate limits (login, signup) would be global.
  trustProxy: isProduction ? 1 : false,
  logger: isProduction
    ? {
        level: 'info',
        // Never log JWTs passed as ?token= (media elements can't send headers)
        redact: ['req.headers.authorization'],
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url.replace(/([?&]token=)[^&]+/, '$1[redacted]'),
          }),
        },
      }
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
  origin: process.env.FRONTEND_URL || (isProduction ? 'https://localhost' : 'http://localhost:5173'),
  credentials: true,
});

// Global rate limiting for the API only. Static assets and cover images are excluded:
// a library page can legitimately request hundreds of covers in a few seconds.
await app.register(rateLimit, {
  max: 1000,
  timeWindow: '1 minute',
  allowList: (request) => !request.url.startsWith('/api/'),
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
    fileSize: 100 * 1024 * 1024, // 100MB (matches the track upload route limit)
  },
});

// Audio files are only reachable through the authenticated /api/tracks/:id/stream route.
app.addHook('onRequest', async (request, reply) => {
  const verdict = classifyUploadUrl(request.url);
  if (verdict === 'bad') return reply.status(400).send({ error: 'Bad request' });
  if (verdict === 'blocked') return reply.status(404).send({ error: 'Not found' });
});

// Uploaded images (cover art, avatars, playlist covers). File names are UUIDs, so they can
// be cached aggressively. This registration owns reply.sendFile, which the stream route
// and the SPA fallback use with an explicit root.
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/uploads/',
  maxAge: '7d',
  decorateReply: true,
});

// In production, serve the frontend build from the public folder
if (isProduction) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
    cacheControl: false, // set explicitly below
    setHeaders: (res, filePath) => {
      // Hashed build assets never change; the shell, manifest and service worker must revalidate
      if (filePath.includes(`${join('public', 'assets')}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
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
await app.register(downloadRoutes, { prefix: '/api/downloads' });
await app.register(assistantRoutes, { prefix: '/api/assistant' });

// Health check
app.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// SPA fallback - serve index.html for client-side routes in production
if (isProduction) {
  app.setNotFoundHandler((request, reply) => {
    const isAppRoute =
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      !request.url.startsWith('/uploads');
    if (isAppRoute) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html', publicDir, { cacheControl: false });
    }
    return reply.status(404).send({ error: 'Not found' });
  });
}

// Graceful shutdown so in-flight requests finish and SQLite closes cleanly on container restarts
const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    sqlite.close();
  } finally {
    process.exit(0);
  }
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    await app.listen({ port, host: '0.0.0.0' });
    try {
      startDownloader(); // resume any queued "Add music" downloads
    } catch (err) {
      app.log.error(err, 'download queue unavailable (database migrations not applied?)');
    }
    // Measure loudness for tracks imported before normalization existed (no-op once done)
    setTimeout(() => {
      backfillAnalysis()
        .then((queued) => { if (queued) app.log.info(`analyzing ${queued} track(s) in the background`); })
        .catch((err) => app.log.error(err, 'analysis backfill failed to start'));
    }, 30_000).unref();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
