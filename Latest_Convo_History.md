# Resonance - Conversation History Summary

## Date: December 29, 2025
## Current Version: 4.0.1

---

## Project Overview

Resonance is a premium full-stack PWA music player with the tagline "Simply Music". It features:
- React 19 + TypeScript + Vite frontend
- Fastify 5 + Drizzle ORM backend
- SQLite database
- Docker deployment with Caddy reverse proxy

---

## Version History

### v4.0.1 - Security & Performance Hardening (December 29, 2025)
Major security and performance fixes based on comprehensive codebase review.

### v4.0.0 - Radio Mode & Smart Queue
- Spotify-like "Radio Mode" that queues similar songs based on artist, album, BPM, key, and energy
- Audio analysis using FFmpeg (volumedetect for energy)
- Database schema with `bpm`, `key`, `energy` fields
- Endpoints: `/api/tracks/:id/similar`, `/api/tracks/analyze-all`

### v3.5.0 - PWA Conversion
- Converted from Electron/Capacitor to PWA-only
- Bundle size reduced from ~94MB to ~700KB

---

## Latest Session: Security & Performance Hardening

### Issues Fixed

#### Backend Security (CRITICAL)
| Issue | Fix | Files |
|-------|-----|-------|
| Path traversal in file deletion | Added `resolveStoredFilePath()` with path validation using `resolve()` | tracks.ts, users.ts, playlists.ts |
| Race condition in invite code counter | Changed to atomic SQL increment: `sql\`usedCount + 1\`` | auth.ts |
| Weak invite code entropy | Increased from 4 bytes to 8 bytes (64 bits) | admin.ts |
| Missing file extension validation | Added whitelist: `['jpg', 'jpeg', 'png', 'webp', 'gif']` | users.ts, playlists.ts |

#### Backend Performance
| Issue | Fix | Files |
|-------|-----|-------|
| N+1 queries in admin users | Replaced with SQL subqueries in single query | admin.ts |
| N+1 in playlist reorder | Replaced with batch SQL CASE statement | playlists.ts |
| Similar tracks loads all into memory | Filter at database level using `ne()` | tracks.ts |
| Missing database indexes | Added migration `0006_add_performance_indexes.sql` | migrations/ |

#### Frontend Security
| Issue | Fix | Files |
|-------|-----|-------|
| JWT token exposed in URL | Implemented secure blob URLs via `getSecureStreamUrl()` | api.ts, useAudioPlayer.ts |

#### Frontend Memory Leaks
| Issue | Fix | Files |
|-------|-----|-------|
| Sleep timer interval accumulation | Used ref for callback, removed from dependency array | PlayerBar.tsx |
| Audio blob URL leaks | Added proper cleanup with `revokeStreamUrl()` on unmount | useAudioPlayer.ts |
| Favorites race condition | Capture original state at function start for reliable reversion | favoritesStore.ts |
| Logout error handling | Added `.catch()` to handle failures gracefully | Sidebar.tsx |

### New Database Migration

Created `0006_add_performance_indexes.sql` with indexes on:
- `favorites(user_id)`, `favorites(user_id, track_id)`
- `play_history(user_id)`, `play_history(user_id, played_at)`
- `playlist_tracks(playlist_id)`, `playlist_tracks(playlist_id, position)`
- `playlists(user_id)`
- `tracks(user_id)`, `tracks(title)`, `tracks(artist)`

### Build Status
- Build passes successfully
- Bundle size: ~711KB (PWA)
- No TypeScript errors

---

## Key Files Modified This Session

| File | Changes |
|------|---------|
| `backend/src/routes/tracks.ts` | Path traversal fix, similar tracks optimization |
| `backend/src/routes/users.ts` | Path traversal fix, extension validation |
| `backend/src/routes/playlists.ts` | Path traversal fix, extension validation, N+1 fix |
| `backend/src/routes/admin.ts` | N+1 fix with subqueries, stronger invite codes |
| `backend/src/routes/auth.ts` | Atomic increment for invite code counter |
| `backend/src/db/migrations/0006_add_performance_indexes.sql` | New performance indexes |
| `frontend/src/services/api.ts` | Secure blob URL streaming |
| `frontend/src/hooks/useAudioPlayer.ts` | Blob URL cleanup, secure streaming |
| `frontend/src/components/player/PlayerBar.tsx` | Sleep timer memory leak fix |
| `frontend/src/stores/favoritesStore.ts` | Race condition fix |
| `frontend/src/components/Sidebar.tsx` | Logout error handling |

---

## Deployment Information

### Server Access
```bash
ssh -i "Oracle_Cloud/ssh-key-2025-12-26.key" ubuntu@68.233.97.227
```

### Deploy Commands
```bash
cd ~/Resonance
docker-compose -f docker-compose.prod.yml down
git pull origin main
docker-compose -f docker-compose.prod.yml up -d --build

# Apply new database indexes
docker-compose -f docker-compose.prod.yml exec app npm run db:migrate
```

### After Deployment (Browser)
Clear PWA cache:
- **Mac:** Cmd + Shift + R
- **Windows/Linux:** Ctrl + Shift + R
- Or: DevTools (F12) -> Application -> Service Workers -> Unregister

---

## URLs

- **App:** https://resonance.ibrahimkhaleelulla.com
- **Health Check:** https://resonance.ibrahimkhaleelulla.com/api/health
- **GitHub:** https://github.com/GoldenAltrax/Resonance.git

---

## Environment Variables (.env)
```
JWT_SECRET=yGUHJFaOtWf7+ayoaF8lhaYnq1QtFYq/NbvzJyhLb7eGSyEzu0Efbozrdh3RZz8/
ADMIN_USERNAME=ibrahim
ADMIN_EMAIL=your-email@example.com
```

---

## Git Info

- **Branch:** main
- **Latest Commit:** Security & Performance: Fix path traversal, JWT exposure, memory leaks, N+1 queries, add database indexes
- **Commit Hash:** 2d003f3

---

## Pending Actions

1. Run database migration on server: `docker-compose -f docker-compose.prod.yml exec app npm run db:migrate`
2. Clear browser PWA cache after deployment
