# ── Build stage: compile frontend + backend (needs the native toolchain for better-sqlite3) ──
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm ci

COPY . .

RUN npm run build \
 # Migration SQL files aren't compiled by tsc
 && cp -r backend/src/db/migrations backend/dist/db/ \
 # The backend serves the frontend build in production
 && mkdir -p backend/dist/public && cp -r frontend/dist/* backend/dist/public/ \
 && npm prune --omit=dev \
 && mkdir -p backend/node_modules

# ── Runtime stage: no compilers, only what the server needs ──
FROM node:22-alpine

# ffmpeg: transcoding/analysis, chromaprint: fpcalc fingerprints, tini: signal handling (graceful shutdown)
RUN apk add --no-cache ffmpeg chromaprint tini

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist

RUN mkdir -p backend/data backend/uploads/audio backend/uploads/images

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
