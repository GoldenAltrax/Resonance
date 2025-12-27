FROM node:20-alpine

# Install build dependencies for native modules (better-sqlite3) and ffmpeg for audio compression
RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build frontend and backend
RUN npm run build

# Copy migration SQL files to dist (they don't get compiled by tsc)
RUN cp -r backend/src/db/migrations backend/dist/db/

# Copy frontend dist to backend public folder for serving
RUN mkdir -p backend/dist/public && cp -r frontend/dist/* backend/dist/public/

# Create data directories
RUN mkdir -p backend/data backend/uploads/audio backend/uploads/images

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["docker-entrypoint.sh"]
