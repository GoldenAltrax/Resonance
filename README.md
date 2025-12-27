# Resonance

**Simply Music** - A premium self-hosted music streaming application.

## Features

- Stream your personal music collection from anywhere
- Create and manage playlists
- User authentication with admin controls
- Beautiful dark-themed UI
- Keyboard shortcuts for power users
- Cross-platform support (Web, iOS, Android, macOS, Windows, Linux)

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Development

```bash
# Install dependencies
npm install

# Run both frontend and backend
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### Production Deployment

See deployment guides in the repository for Docker-based production setup.

## Tech Stack

**Frontend:**
- React 19 + TypeScript
- Vite
- Tailwind CSS
- Zustand (state management)

**Backend:**
- Fastify
- Drizzle ORM + SQLite
- JWT authentication

## Environment Variables

Create a `.env` file:

```env
JWT_SECRET=your-secret-key
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
```
