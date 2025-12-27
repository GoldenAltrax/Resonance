# Resonance - Conversation History Summary

## Date: December 27, 2025
## Current Version: 4.0.0

---

## Project Overview

Resonance is a premium full-stack PWA music player with the tagline "Simply Music". It features:
- React 19 + TypeScript + Vite frontend
- Fastify 5 + Drizzle ORM backend
- SQLite database
- Docker deployment with Caddy reverse proxy

---

## Version History

### v4.0.0 - Radio Mode & Smart Queue
- Spotify-like "Radio Mode" that queues similar songs based on artist, album, BPM, key, and energy
- Audio analysis using FFmpeg (volumedetect for energy)
- Database schema with `bpm`, `key`, `energy` fields
- Endpoints: `/api/tracks/:id/similar`, `/api/tracks/analyze-all`

### v3.5.0 - PWA Conversion
- Converted from Electron/Capacitor to PWA-only
- Bundle size reduced from ~94MB to ~700KB

---

## Latest Session: Dropdown Fix & Code Review

### Dropdown Menu Clipping Fix
Fixed three-dot menu dropdown being clipped by the player bar in both SearchView and PlaylistView.

**Solution:** Implemented fixed positioning with dynamically calculated coordinates:
- Added `useRef` for menu button tracking
- Calculate available space above/below on click
- Menu uses `position: fixed` with calculated `top` and `left`
- Opens upward when near player bar, downward otherwise

**Files modified:**
- `frontend/src/views/SearchView.tsx`
- `frontend/src/components/ui/SortableTrackRow.tsx`

### Codebase Review Summary

**Security: GOOD**
- JWT authentication properly implemented
- bcrypt with 12 rounds for password hashing
- Rate limiting on auth endpoints (3-5 req/min)
- Admin middleware protects admin routes
- Zod validation on all inputs
- No SQL injection (uses Drizzle ORM)
- `.env` properly gitignored

**Performance: GOOD**
- Audio compression to 192kbps reduces storage
- Virtualized lists for large playlists
- Zustand for efficient state management
- Debounced API calls (play history logging)

**Code Quality: GOOD**
- TypeScript throughout
- Consistent error handling
- Clean separation of concerns
- Build passes without errors

**No critical issues found.**

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/db/schema.ts` | Database schema (users, tracks, playlists, etc.) |
| `backend/src/routes/tracks.ts` | Track upload, streaming, audio analysis, similar tracks |
| `backend/src/routes/auth.ts` | Authentication (signup, login, JWT) |
| `backend/src/middleware/auth.ts` | Auth & admin middleware |
| `frontend/src/stores/playerStore.ts` | Player state, queue, radio mode |
| `frontend/src/services/api.ts` | API client |
| `frontend/src/views/SearchView.tsx` | Search with radio button |
| `frontend/src/components/ui/SortableTrackRow.tsx` | Draggable track row with dropdown |

---

## Deployment Information

### Server Access
```bash
ssh -i "Oracle_Cloud/ssh-key-2025-12-26.key" ubuntu@68.233.97.227
```

### Deploy Commands
```bash
cd ~/Resonance
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
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
- **Latest Commit:** Fix: Playlist dropdown menu uses fixed positioning to prevent player bar clipping
- **Commit Hash:** dd67782
