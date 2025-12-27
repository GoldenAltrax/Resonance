# Resonance — Version History

A changelog of all versions with brief descriptions of what was accomplished.

---

## v0.1.0 — Foundation Setup

**Date:** December 2025

The foundational release establishing the monorepo structure and core infrastructure.

**What was done:**

- Created monorepo structure with `frontend/` and `backend/` workspaces
- Migrated existing React frontend to proper directory structure
- Installed Tailwind CSS properly (removed CDN dependency)
- Set up Fastify 5 backend with TypeScript
- Configured Drizzle ORM with SQLite database
- Created database schema: `users`, `playlists`, `tracks`, `playlist_tracks`
- Built authentication API (signup, login, logout, JWT)
- Built playlist CRUD API with track management
- Built track upload and streaming API
- Added JWT middleware for protected routes
- Configured environment variables and .gitignore

**Tech Stack:**

- Frontend: React 19, Vite, TypeScript, Tailwind CSS
- Backend: Fastify 5, Drizzle ORM, SQLite, bcrypt, Zod

---

## v0.2.0 — Frontend-Backend Integration

**Date:** December 2025

Connected the frontend to the real backend API with state management and audio playback.

**What was done:**

- Created API service layer (`services/api.ts`) for all backend communication
- Implemented Zustand stores:
  - `authStore` - Authentication state with login/signup/logout
  - `playerStore` - Audio player state with play/pause/next/previous/shuffle
  - `playlistStore` - Playlist and track management
- Built `useAudioPlayer` hook for HTML5 Audio API integration
- Created `PlayerBar` component with:
  - Play/pause controls
  - Next/previous track navigation
  - Progress bar with seeking
  - Volume control
  - Shuffle and repeat modes
- Updated `LoginView` with real API authentication
- Created `SignUpView` with form validation
- Updated `App.tsx` to use Zustand stores and auth flow
- Connected `PlaylistsView` to real API (create, list playlists)
- Connected `PlaylistDetailView` to real API with:
  - Track upload functionality
  - Playback integration
  - Dynamic track listing

**New Files:**

- `frontend/src/services/api.ts`
- `frontend/src/stores/authStore.ts`
- `frontend/src/stores/playerStore.ts`
- `frontend/src/stores/playlistStore.ts`
- `frontend/src/hooks/useAudioPlayer.ts`
- `frontend/src/components/player/PlayerBar.tsx`
- `frontend/src/views/SignUpView.tsx`

---

## v0.3.0 — Search & Polish

**Date:** December 2025

Enhanced search functionality and user experience polish.

**What was done:**

- Connected SearchView to real backend search API with debounced queries
- Implemented search type filtering (all, tracks, playlists)
- Added recent searches with localStorage persistence
- Created toast notification system for user feedback:
  - `toastStore` - Zustand store for managing toasts
  - `ToastContainer` - Component with success/error/warning/info variants
  - Integrated toasts into playlist actions (create, delete, upload, add/remove tracks)
- Added Error Boundaries for graceful error handling:
  - `ErrorBoundary` - Class component wrapping main content and views
  - Retry functionality for error recovery
- Created reusable `LoadingSpinner` and `FullPageLoader` components
- Implemented keyboard shortcuts for player controls:
  - Space: Play/Pause
  - Arrow Left/Right: Seek backward/forward 10s
  - Shift + Arrow Up/Down: Volume up/down
  - M: Mute/Unmute
  - N: Next track
  - P: Previous track
  - S: Toggle shuffle
  - R: Toggle repeat mode (none → all → one)

**New Files:**

- `frontend/src/stores/toastStore.ts`
- `frontend/src/components/ui/Toast.tsx`
- `frontend/src/components/ui/ErrorBoundary.tsx`
- `frontend/src/components/ui/LoadingSpinner.tsx`
- `frontend/src/hooks/useKeyboardShortcuts.ts`

---

## v0.4.0 — Media & Profile Polish

**Date:** December 2025

Complete media handling and user experience improvements.

**What was done:**

Backend Improvements:

- **Audio Duration Extraction**: Using `music-metadata` to extract duration, title, artist, and album from uploaded audio files
- **Playlist Cover Image Upload**: New endpoint `POST /api/playlists/:id/cover` for uploading cover images
- **User Avatar Upload**: New endpoint `POST /api/users/:id/avatar` for profile picture uploads
- **File Cleanup on Delete**: Track files are now deleted from filesystem when track is deleted
- **Database Migrations**: Generated and applied initial migration for production readiness

Frontend Improvements:

- **Profile Editing**: Users can now edit username/email and upload avatars in Settings
- **Playlist Management**:
  - Edit playlist name and description from playlist list
  - Upload/change playlist cover images
  - Context menu with Edit and Delete options
- **HomeView with Real Data**:
  - Displays user's actual playlists
  - Shows recently added tracks with real metadata
  - Shuffle All plays random tracks from library
- **Image Resolution**: Proper handling of local vs external image URLs throughout the app

API Additions:

- `POST /api/playlists/:id/cover` - Upload playlist cover image
- `POST /api/users/:id/avatar` - Upload user profile avatar
- `PATCH /api/users/:id` - Now supports username updates

**Dependencies Added:**

- `music-metadata` - Audio metadata extraction

---

## v0.4.1 — Bug Fixes

**Date:** December 2025

Bug fixes and quality-of-life improvements.

**What was fixed:**

Backend Fixes:

- **Audio Streaming Auth**: Fixed audio playback by supporting JWT token in query parameter for HTML5 Audio element compatibility
- **Password Change API**: Added `POST /api/auth/change-password` endpoint for secure password updates

Frontend Fixes:

- **Audio Playback**: Songs now play correctly by including auth token in stream URL
- **Toast Notifications**: Replaced stacking behavior with single-toast display (new toasts replace previous)
- **Settings Page**:
  - Removed non-functional Notifications button
  - Added working handlers for Account and Security buttons
  - Account opens Edit Profile modal
  - Security opens Change Password modal
- **Profile Edit**: Email field is now read-only (only username can be edited)
- **Sidebar Logout**: Added logout button at bottom of sidebar
- **Image Caching**: Added cache-busting to avatar and playlist cover images to ensure updates display immediately

**Files Modified:**

- `backend/src/routes/tracks.ts` - Token in query param for stream
- `backend/src/routes/auth.ts` - Password change endpoint
- `frontend/src/services/api.ts` - Token in stream URL, changePassword method
- `frontend/src/stores/toastStore.ts` - Replace instead of stack toasts
- `frontend/src/views/SettingsView.tsx` - Button handlers, Security modal, read-only email
- `frontend/src/components/Sidebar.tsx` - Logout button
- `frontend/src/views/HomeView.tsx` - Cache-busting for covers
- `frontend/src/views/PlaylistsView.tsx` - Cache-busting for covers

---

## v0.4.2 — Critical Bug Fixes

**Date:** December 2025

Fixed critical issues preventing images and audio from loading.

**What was fixed:**

- **Images Not Loading**: Added `/uploads` to Vite proxy configuration. Previously only `/api` was proxied, so requests to `/uploads/images/...` from the frontend (port 5173) were not reaching the backend (port 3000).

- **Audio Not Playing**: Same root cause as images - the `/uploads/audio/...` redirect from the stream endpoint wasn't being proxied. Now audio files load and play correctly.

- **Sidebar Logout Button Hidden**: Added dynamic bottom padding to the sidebar logout container when the player bar is visible, preventing the logout button from being hidden behind the player.

**Files Modified:**

- `frontend/vite.config.ts` - Added `/uploads` proxy to backend
- `frontend/src/components/Sidebar.tsx` - Added conditional padding when player is active

---

## v0.4.3 — Audio & Image Fixes

**Date:** December 2025

Fixed audio streaming authentication and playlist detail image loading.

**What was fixed:**

- **Audio Streaming 401 Error**: The `authMiddleware` hook was applied to all track routes including the stream endpoint. Even though the stream route had custom token handling, the middleware ran first and rejected requests without Authorization headers. Fixed by updating `authMiddleware` to also accept JWT tokens from query parameters, enabling HTML5 Audio/Video elements to authenticate.

- **Playlist Detail Cover Image**: The cover image in `PlaylistDetailView` was using `coverImage` directly (e.g., `images/playlist-xxx.jpg`) instead of resolving to the full path (`/uploads/images/playlist-xxx.jpg`). Added `getCoverUrl()` function with proper path resolution and cache-busting.

**Technical Details:**

- The auth middleware now tries header auth first, then falls back to query param `?token=xxx`
- This pattern works for any route that needs to support browser-native elements that can't send custom headers

**Files Modified:**

- `backend/src/middleware/auth.ts` - Added query param token fallback
- `backend/src/routes/tracks.ts` - Simplified stream route (auth now handled by middleware)
- `frontend/src/views/PlaylistDetailView.tsx` - Added getCoverUrl() with proper path resolution

---

## v0.4.4 — Private Access & UX Improvements

**Date:** December 2025

Added private signup system and improved logout experience.

**What was done:**

Backend:

- **Private Signup System**: Added secret/invitation code requirement for new user registration
- New environment variable `SIGNUP_SECRET` (defaults to `resonance-family-2024`)
- Returns 403 error with "Invalid invitation code" for incorrect codes

Frontend:

- **Signup Invitation Code**: Added invitation code field to SignUpView with validation
- **Logout Confirmation**: Both logout buttons (Sidebar and Settings) now show a confirmation dialog before logging out
- Consistent modal styling across the app

**Files Modified:**

- `backend/src/routes/auth.ts` - Secret code validation in signup
- `frontend/src/services/api.ts` - Added secretCode parameter to signup
- `frontend/src/stores/authStore.ts` - Updated signup signature
- `frontend/src/views/SignUpView.tsx` - Added invitation code field
- `frontend/src/components/Sidebar.tsx` - Logout confirmation modal
- `frontend/src/views/SettingsView.tsx` - Logout confirmation modal

---

## v0.5.0 — Admin Panel

**Date:** December 2025

Full-featured admin panel for the designated admin user (Altrax).

**What was done:**

Database:

- **New `invite_codes` table**: Stores invite codes with fields for code, max uses, used count, active status, expiration date, and creator reference
- Generated and applied migration for the new table

Backend:

- **Admin Middleware**: New `adminMiddleware` that checks if user is the designated admin (username: `Altrax`, email: `ibrahimkhaleelulla8000@gmail.com`)
- **Admin API Routes** (`/api/admin/*`):
  - `GET /stats` - Dashboard statistics (user count, track count, playlist count, invite codes)
  - `GET /users` - List all users with their track/playlist counts
  - `GET /invite-codes` - List all invite codes
  - `POST /invite-codes` - Create new invite code (custom or auto-generated)
  - `PATCH /invite-codes/:id` - Update invite code (toggle active, change max uses)
  - `DELETE /invite-codes/:id` - Delete invite code
- **Updated Signup Logic**: Now validates against `invite_codes` table first, with fallback to legacy `SIGNUP_SECRET` env var for backwards compatibility
- Invite code usage is automatically incremented on successful signup

Frontend:

- **Admin Panel** (`AdminView.tsx`): Full admin dashboard with:
  - **Overview Tab**: Stats cards showing total users, tracks, playlists, and active invite codes
  - **Users Tab**: List of all users with their profile image, username, email, track/playlist counts, and join date
  - **Invite Codes Tab**: Manage invite codes with:
    - Create new codes (custom or auto-generated)
    - Set max usage limits
    - Enable/disable codes
    - Copy code to clipboard
    - Delete codes
- **Sidebar Admin Button**: Only visible to the admin user, with amber accent color
- Added `'admin'` to Page type

**New Files:**

- `backend/src/db/migrations/0001_groovy_warlock.sql` - Migration for invite_codes table
- `backend/src/routes/admin.ts` - Admin API routes
- `frontend/src/views/AdminView.tsx` - Admin panel component

**Files Modified:**

- `backend/src/db/schema.ts` - Added inviteCodes table and types
- `backend/src/middleware/auth.ts` - Added adminMiddleware and isAdmin helper
- `backend/src/app.ts` - Registered admin routes
- `backend/src/routes/auth.ts` - Updated signup to use invite_codes table
- `frontend/src/services/api.ts` - Added admin API methods and types
- `frontend/src/types/index.ts` - Added 'admin' to Page type
- `frontend/src/components/Sidebar.tsx` - Admin button (admin-only)
- `frontend/src/App.tsx` - Added AdminView route

**Security:**

- Admin access is hardcoded to a single user (Altrax with specific email)
- All admin routes are protected by adminMiddleware
- Non-admin users cannot access admin endpoints (403 Forbidden)
- Admin panel button only renders for the admin user

---

## v0.6.0 — Lyrics & UX Polish

**Date:** December 2025

Added synced lyrics display, landing page, and authentication flow improvements.

**What was done:**

Lyrics Feature:

- **LRCLIB Integration**: Free lyrics API (~3M songs) providing synced lyrics in LRC format
- **Lyrics Service** (`services/lyrics.ts`): API client with LRC parser that extracts timestamps
- **LyricsPanel Component**: Slide-up panel (60% screen height) with:
  - Auto-scrolling to current lyric line
  - Click-to-seek functionality (click any line to jump to that timestamp)
  - Current line highlighted with larger font and white color
  - Plain lyrics fallback when synced lyrics unavailable
  - Loading state and "No lyrics available" fallback
  - Smooth slide-up animation
- **Lyrics Toggle**: Microphone icon in PlayerBar to show/hide lyrics

Landing Page:

- **LandingView Component**: New landing page shown after splash animation with:
  - Centered Resonance logo and tagline
  - "Log In" and "Sign Up" buttons
  - Elegant fade-in animation
  - "Minimal Design. Pure Sound." footer tagline
- **Updated Auth Flow**: `splash → landing → login/signup → main app`

Authentication UX:

- **Sign Up Back Button**: Arrow button at top-left to return to login page
- **Login Animation**: Full-screen "Logging in..." overlay with spinner on successful login
- **Sidebar Logout Animation**: Same full-screen overlay when logging out from sidebar

**New Files:**

- `frontend/src/views/LandingView.tsx` - Landing page with auth buttons
- `frontend/src/services/lyrics.ts` - LRCLIB API client and LRC parser
- `frontend/src/components/player/LyricsPanel.tsx` - Synced lyrics display

**Files Modified:**

- `frontend/src/App.tsx` - Added LandingView, updated auth flow with 'landing' state
- `frontend/src/views/SignUpView.tsx` - Added back button
- `frontend/src/views/LoginView.tsx` - Added full-screen login animation
- `frontend/src/components/Sidebar.tsx` - Added logout animation overlay
- `frontend/src/components/player/PlayerBar.tsx` - Added lyrics toggle button and LyricsPanel
- `frontend/src/stores/playerStore.ts` - Added `showLyrics` state and `toggleLyrics` action

---

## v0.6.1 — Lyrics & Navigation Improvements

**Date:** December 2025

Improved lyrics panel, navigation, and added transliteration for non-Latin lyrics.

**What was done:**

Navigation Changes:

- **Back Button Navigation**: Both Login and Sign Up pages now have back buttons that return to the Landing page instead of switching between each other
- Consistent navigation flow: Landing → Login/Sign Up → Back to Landing

Lyrics Panel Redesign:

- **Right Sidebar**: Converted from bottom slide-up panel to a right sidebar (400px wide)
- **Slide Animation**: Smooth slide-in from right when opening, slide-out when closing
- **Close Animation**: Both X button and backdrop click trigger animated close
- Improved layout for better readability

Transliteration Support:

- **Romanization**: Non-Latin lyrics are automatically transliterated to Latin characters
- **Hindi → Hinglish**: Hindi (Devanagari) lyrics now display in romanized form
- **Multi-language Support**: Works with Chinese, Japanese, Korean, Arabic, Cyrillic, and other scripts
- Uses the `transliteration` npm package for accurate script conversion

**Dependencies Added:**

- `transliteration` - Script-to-Latin transliteration library

**Files Modified:**

- `frontend/src/views/LoginView.tsx` - Added back button, onBack prop
- `frontend/src/views/SignUpView.tsx` - Updated back button to use onBack prop
- `frontend/src/App.tsx` - Pass onBack handlers to auth views
- `frontend/src/components/player/LyricsPanel.tsx` - Redesigned as right sidebar with animations
- `frontend/src/services/lyrics.ts` - Added transliteration for non-Latin lyrics

---

## v0.6.2 — Non-blocking Lyrics Panel

**Date:** December 2025

Made the lyrics panel non-blocking so users can interact with the app while viewing lyrics.

**What was done:**

- **Removed Backdrop**: Lyrics panel no longer has a backdrop that blocks the rest of the app
- **Non-blocking Interaction**: Users can now change songs, adjust volume, and use other controls while the lyrics panel is open
- **Panel Positioning**: Panel sits above the player bar (bottom-24) so it doesn't overlap controls
- Cleaned up unused backdrop click handler

**Files Modified:**

- `frontend/src/components/player/LyricsPanel.tsx` - Removed backdrop, made panel non-blocking

---

## v0.6.3 — Smooth Content Resize with Lyrics Panel

**Date:** December 2025

Main content now smoothly resizes when the lyrics panel opens/closes instead of being overlapped.

**What was done:**

- **Content Snap**: Main content area smoothly shrinks by 400px when lyrics panel opens
- **Smooth Transition**: Uses 300ms ease-out transition for fluid animation
- **No Overlap**: Content is no longer covered by the lyrics panel
- **Bidirectional**: Expands back smoothly when lyrics panel closes

**Files Modified:**

- `frontend/src/App.tsx` - Added dynamic margin-right with transition based on showLyrics state

---

## v0.7.0 — Library System

**Date:** December 2025

Introduced a centralized Library for managing all tracks independently from playlists.

**What was done:**

Library Feature:

- **Library View**: New dedicated page for managing all tracks in user's account
  - Import tracks button with bulk upload support and progress indicator
  - Track listing with play/pause, delete, and multi-select capabilities
  - Search/filter bar for finding tracks by title, artist, or album
  - Bulk delete with confirmation modal
  - Shows track count, duration, and date added
  - Empty state with helpful prompt

- **Sidebar Update**: Added "Library" navigation item below "Home" with Music icon

- **Playlist Track Adding**:
  - "Add Tracks" button now shows dropdown menu with two options:
    - **Import from PC**: Upload new audio files directly (existing behavior)
    - **Add from Library**: Opens modal to select from existing library tracks
  - LibraryPickerModal with:
    - Search/filter functionality
    - Multi-select with checkboxes
    - Select All option
    - Shows tracks already in playlist (greyed out)
    - Selected count indicator

Backend:

- **Duplicate Check Endpoint**: `POST /api/tracks/check-duplicates`
  - Accepts array of track metadata (title, artist)
  - Returns matches based on case-insensitive title + artist comparison
  - Prepares for future duplicate detection during upload

State Management:

- **playlistStore additions**:
  - `library` - Array of all user's tracks
  - `libraryLoading` - Loading state for library fetch
  - `fetchLibrary()` - Fetch all tracks from API
  - `deleteTrack(id)` - Delete track from library and refresh

**New Files:**

- `frontend/src/views/LibraryView.tsx` - Library management page
- `frontend/src/components/LibraryPickerModal.tsx` - Modal for adding tracks from library to playlist

**Files Modified:**

- `frontend/src/types/index.ts` - Added 'library' to Page type
- `frontend/src/components/Sidebar.tsx` - Added Library nav item
- `frontend/src/App.tsx` - Added LibraryView route
- `frontend/src/stores/playlistStore.ts` - Added library state and actions
- `frontend/src/services/api.ts` - Added checkDuplicates method and types
- `frontend/src/views/PlaylistDetailView.tsx` - Added dropdown menu with Import/Library options
- `backend/src/routes/tracks.ts` - Added duplicate check endpoint

---

## v0.7.1 — Duplicate Detection on Upload

**Date:** December 2025

Implemented smart duplicate detection with user prompts when importing tracks.

**What was done:**

- **DuplicateModal Component**: New modal shown when duplicate tracks are detected during import
  - Lists all duplicate tracks with title and artist
  - Three action options per track: **Skip** / **Add Anyway** / **Replace**
  - "Apply to all" checkbox for bulk action selection
  - Amber warning styling to indicate potential issue
  - Cancel and Continue buttons

- **Library Upload Flow Update**:
  - Extracts title from filename before upload
  - Calls duplicate check API to find matching tracks
  - Shows DuplicateModal if any duplicates found
  - Processes files based on user choices:
    - **Skip**: File is not uploaded
    - **Add Anyway**: File is uploaded as a new track (allows duplicates)
    - **Replace**: Existing track is deleted, new file is uploaded

**New Files:**

- `frontend/src/components/ui/DuplicateModal.tsx` - Duplicate warning modal with action selection

**Files Modified:**

- `frontend/src/views/LibraryView.tsx` - Integrated duplicate detection into upload flow

---

## v0.7.2 — Bug Fixes & Polish

**Date:** December 2025

Critical bug fixes for duplicate detection, modal overlaps, and UI improvements.

**Bug Fixes:**

1. **Fixed Duplicate Detection Not Working**
   - Duplicate check now matches by title only when artist is unknown (from filename)
   - Previously required exact title + artist match, which failed since we only extract title from filename
   - Now correctly detects duplicates even when existing tracks have full metadata

2. **Fixed Modal Overlaps with Player Bar**
   - All modals now have `pb-28` padding to account for the player bar height
   - Modals affected: LibraryPickerModal, DuplicateModal, delete confirmations, create/edit playlist modals, settings modals, admin modals

3. **Replaced Browser Confirmation Dialogs**
   - PlaylistsView delete confirmation now uses in-app modal instead of `window.confirm()`
   - Consistent styling with other confirmation dialogs

4. **Added Import Progress Modal**
   - New `ImportProgressModal` component shows during track imports
   - Displays: progress bar, current file being processed, added/skipped counts
   - Cancel button to stop import at any time
   - Replaces the flickering caused by rapid state updates

5. **Added Duplicate Detection to Playlist Imports**
   - "Import from PC" in PlaylistDetailView now checks for duplicates
   - Same duplicate handling as Library view (Skip/Add Anyway/Replace)
   - Progress modal shows during import

**New Files:**

- `frontend/src/components/ui/ImportProgressModal.tsx` - Progress overlay for track imports

**Files Modified:**

- `backend/src/routes/tracks.ts` - Fixed duplicate check to match by title only when no artist provided
- `frontend/src/components/LibraryPickerModal.tsx` - Added pb-28 padding for player bar
- `frontend/src/components/ui/DuplicateModal.tsx` - Added pb-28 padding
- `frontend/src/views/LibraryView.tsx` - Integrated ImportProgressModal with cancel support
- `frontend/src/views/PlaylistDetailView.tsx` - Added duplicate detection and progress modal for imports
- `frontend/src/views/PlaylistsView.tsx` - Replaced browser confirm with in-app modal, fixed modal overlaps
- `frontend/src/views/SettingsView.tsx` - Fixed modal overlaps
- `frontend/src/views/AdminView.tsx` - Fixed modal overlaps
- `frontend/src/components/Sidebar.tsx` - Fixed logout modal overlap

---

## v0.7.3 — Duplicate Detection & Sorting Improvements

**Date:** December 2025

Fixed duplicate detection properly with filename tracking and added alphabetical sorting.

**Bug Fixes:**

1. **Fixed Duplicate Detection (Properly This Time)**
   - Root cause: Duplicate check compared filename against ID3 metadata title, which often differ
   - Solution: Added `originalFilename` column to tracks table
   - Backend now stores original filename (without extension) on upload
   - Duplicate check compares incoming filename against stored `originalFilename`
   - Falls back to title comparison for legacy tracks without `originalFilename`
   - Database migration applied: `0002_dear_satana.sql`

2. **Fixed Flickering Inside Playlists**
   - Added `silent` parameter to store actions: `uploadTrack`, `deleteTrack`, `addTrackToPlaylist`
   - Silent mode suppresses toast notifications and prevents individual playlist refreshes
   - Batch operations now do a single refresh at the end instead of refreshing after each track
   - Applied to both LibraryView and PlaylistDetailView import flows

3. **Added Alphabetical Sorting**
   - All track listings now sorted alphabetically by title (case-insensitive A-Z)
   - Library View: Tracks sorted in both search results and full listing
   - Playlist Detail View: Playlist tracks sorted alphabetically
   - Library Picker Modal: Both available tracks and existing tracks sorted

**Database Changes:**

- Added `original_filename` column to `tracks` table (nullable, for backwards compatibility)

**Files Modified:**

- `backend/src/db/schema.ts` - Added originalFilename column to tracks table
- `backend/src/routes/tracks.ts` - Store originalFilename on upload, compare against it in duplicate check
- `frontend/src/services/api.ts` - Added originalFilename to Track interface
- `frontend/src/stores/playlistStore.ts` - Added silent parameter to uploadTrack, deleteTrack, addTrackToPlaylist
- `frontend/src/views/LibraryView.tsx` - Silent mode imports, single refresh, alphabetical sorting
- `frontend/src/views/PlaylistDetailView.tsx` - Silent mode imports, single refresh, alphabetical sorting
- `frontend/src/components/LibraryPickerModal.tsx` - Alphabetical sorting for available and existing tracks

---

## v0.8.0 — Security Hardening

**Date:** December 2025

Phase 1 of the main release preparation. Critical security improvements to protect against common attacks.

**Security Features:**

1. **Rate Limiting on Auth Endpoints**
   - Global rate limit: 100 requests per minute per IP
   - Login: 5 attempts per minute per IP
   - Signup: 3 attempts per minute per IP
   - Change password: 3 attempts per minute per IP
   - Returns 429 Too Many Requests with retry-after info

2. **Password Requirements**
   - Minimum 8 characters (up from 6)
   - Requires at least one uppercase letter
   - Requires at least one lowercase letter
   - Requires at least one number
   - Real-time validation feedback on signup and change password forms
   - Password strength indicator (Weak/Fair/Good/Strong)

3. **JWT Expiration**
   - Tokens now expire after 7 days
   - Frontend detects expired tokens and shows "Session expired" message
   - Automatic logout on session expiration
   - Clean redirect to login page

4. **File Upload Limits**
   - Audio tracks: 50MB maximum
   - Playlist cover images: 5MB maximum
   - User avatars: 2MB maximum
   - Frontend validates file sizes before upload
   - Backend enforces limits with clear error messages

**Dependencies Added:**

- `@fastify/rate-limit` - Request rate limiting

**Files Modified:**

Backend:
- `backend/src/app.ts` - Added rate limit plugin registration
- `backend/src/routes/auth.ts` - Route-specific rate limits, password schema with requirements, JWT expiration
- `backend/src/routes/tracks.ts` - 50MB limit for track uploads
- `backend/src/routes/playlists.ts` - 5MB limit for cover images
- `backend/src/routes/users.ts` - 2MB limit for avatars

Frontend:
- `frontend/src/services/api.ts` - Session expired callback mechanism
- `frontend/src/stores/authStore.ts` - Session expired handling, auto-logout
- `frontend/src/views/SignUpView.tsx` - Password strength indicator, real-time validation
- `frontend/src/views/SettingsView.tsx` - Password strength indicator for change password
- `frontend/src/views/LibraryView.tsx` - File size validation before upload
- `frontend/src/views/PlaylistDetailView.tsx` - File size validation before upload

---

## v0.9.0 — Quality of Life & New Features

**Date:** December 2025

Phase 2 and 3 of the main release preparation. Enhanced usability and new features.

**Quality of Life Improvements (Phase 2):**

1. **Drag & Drop Upload**
   - Drag and drop zone in Library view
   - Drag and drop zone in Playlist detail view
   - Visual feedback with overlay when dragging files
   - Supports multiple files in single drop
   - Integrates with duplicate detection flow

2. **Track Metadata Editing**
   - EditTrackModal component for editing title, artist, album
   - Edit button on track rows in Library view
   - `PATCH /api/tracks/:id` endpoint for updating metadata
   - Toast confirmation on save

3. **Playlist Track Reordering**
   - Drag handles on playlist track rows using @dnd-kit
   - Drag and drop reordering in PlaylistDetailView
   - `PATCH /api/playlists/:id/reorder` endpoint
   - Position persisted across sessions

4. **Remember Volume Setting**
   - Volume stored in localStorage
   - Loads on app start
   - Mute state also persisted
   - Shuffle and repeat preferences saved

5. **Keyboard Shortcuts Help Modal**
   - KeyboardShortcutsModal component
   - Lists all shortcuts with descriptions
   - Press "?" to open from anywhere
   - Button in Settings to view shortcuts

**New Features (Phase 3):**

1. **Queue View**
   - QueuePanel component (slide-out from right)
   - Shows current track, upcoming, and previously played
   - Remove tracks from queue
   - Drag and drop reordering with @dnd-kit
   - Clear queue button
   - Queue icon in PlayerBar
   - "Q" keyboard shortcut to toggle

2. **Favorites System**
   - `favorites` table in database
   - `POST/DELETE /api/favorites/:trackId` endpoints
   - `GET /api/favorites` for listing all favorites
   - Heart icon on track rows (toggle favorite)
   - "Liked Songs" auto-playlist in sidebar
   - Animated heart on toggle
   - LikedSongsView with gradient header

3. **Recently Played**
   - `play_history` table in database
   - `POST /api/history` (logs play on track start)
   - `GET /api/history` (last 50 plays, deduplicated)
   - "Recently Played" section in HomeView
   - Shows time ago (e.g., "5m ago", "2h ago")

4. **Sort Options**
   - Sort dropdown in Library view
   - Options: Title (A-Z/Z-A), Artist, Date Added (Newest/Oldest), Duration
   - Remembered in localStorage
   - Visual indicator of current sort

**New Files:**

- `frontend/src/components/ui/DropZone.tsx`
- `frontend/src/components/ui/EditTrackModal.tsx`
- `frontend/src/components/ui/SortableTrackRow.tsx`
- `frontend/src/components/ui/KeyboardShortcutsModal.tsx`
- `frontend/src/components/player/QueuePanel.tsx`
- `frontend/src/components/ui/FavoriteButton.tsx`
- `frontend/src/stores/favoritesStore.ts`
- `frontend/src/views/LikedSongsView.tsx`
- `backend/src/routes/favorites.ts`
- `backend/src/routes/history.ts`

**Dependencies Added:**

- `@dnd-kit/core` - Drag and drop functionality
- `@dnd-kit/sortable` - Sortable lists
- `@dnd-kit/utilities` - DnD utilities

---

## v0.9.5 — Performance Optimization

**Date:** December 2025

Phase 4 of the main release preparation. Performance optimizations for smooth experience with large libraries.

**Performance Features:**

1. **Virtualized Lists**
   - Using @tanstack/react-virtual for efficient rendering
   - Library view uses virtualization for >50 tracks
   - Only visible rows + 10 overscan rendered
   - Maintains smooth scrolling with 1000+ tracks
   - VirtualizedTrackList reusable component

2. **Audio Preloading**
   - Preloads next track when current reaches 75% progress
   - Uses secondary Audio element for silent preloading
   - Seamless track transitions
   - Respects queue order and repeat mode
   - Skips preload in shuffle mode (unpredictable next)

3. **Image Optimization**
   - Native lazy loading (`loading="lazy"`) on all images
   - Async decoding (`decoding="async"`) for better performance
   - OptimizedImage component with fade-in animation
   - Placeholder background while loading
   - Applied across all views:
     - PlayerBar album art
     - QueuePanel track thumbnails
     - HomeView playlist covers and recently played
     - LikedSongsView track thumbnails
     - PlaylistDetailView and PlaylistsView covers
     - SortableTrackRow thumbnails
     - SearchView and AdminView images
     - SettingsView profile image

**New Files:**

- `frontend/src/components/ui/OptimizedImage.tsx`
- `frontend/src/components/ui/VirtualizedTrackList.tsx`

**Dependencies Added:**

- `@tanstack/react-virtual` - Virtual scrolling

**Files Modified:**

- `frontend/src/hooks/useAudioPlayer.ts` - Added preloading logic
- `frontend/src/views/LibraryView.tsx` - Added virtualization
- All view and component files with images - Added lazy loading

---

## v1.0.0 — Initial Release

**Date:** December 2025

Production-ready release of Resonance. Combines all features from v0.1.0 through v0.9.5 into a stable, deployable application.

**Deployment Ready:**

- Docker containerization with multi-stage builds
- Docker Compose production configuration
- Caddy reverse proxy support for automatic HTTPS
- Database migrations run at container startup
- Production-optimized Fastify logging (JSON format)

**All Features Included:**

- User authentication with invite codes
- Personal libraries with track upload
- Playlist management with cover images
- Audio playback with queue, shuffle, repeat
- Synced lyrics display
- Favorites and recently played
- Search across tracks and playlists
- Admin panel with user management
- Security hardening (rate limiting, password requirements, JWT expiration)
- Performance optimizations (virtualization, preloading, lazy loading)

---

## v1.5.0 — Universal Library Rework

**Date:** December 2025

Major architectural rework transforming from per-user libraries to a shared universal music library.

**Architecture Changes:**

1. **Universal Music Library**
   - All tracks now belong to a global shared library
   - All authenticated users can discover and play any track
   - Users create personal playlists from the shared library
   - Favorites work across the global track pool

2. **Admin-Only Uploads**
   - Only administrators can upload new tracks
   - Library view restricted to admin users
   - Non-admins see "Access Restricted" message if they navigate to Library
   - Regular users discover music via Search

3. **Audio Compression**
   - Added ffmpeg to Docker image for audio processing
   - All uploads compressed to 192kbps MP3 format
   - Reduces storage requirements significantly
   - High-bitrate source files (>256kbps) are automatically compressed
   - Already-compressed files (<256kbps MP3) are kept as-is

4. **Simplified Track Management**
   - Removed track metadata editing (title/artist/album)
   - Metadata is extracted once during upload and preserved
   - Removed PATCH endpoint from tracks API
   - Cleaner, more consistent track data

**Backend Changes:**

- `POST /api/tracks` - Admin only, with ffmpeg compression
- `GET /api/tracks` - Admin only (for Library view)
- `DELETE /api/tracks/:id` - Admin only
- `POST /api/tracks/check-duplicates` - Admin only
- `GET /api/tracks/:id` - Any authenticated user
- `GET /api/tracks/:id/stream` - Any authenticated user
- Search endpoint now queries global track library
- Playlist track addition no longer checks ownership
- Favorites no longer check track ownership

**Frontend Changes:**

- Sidebar: Library link only visible to admin users
- LibraryView: Admin guard shows "Access Restricted" for non-admins
- LibraryView: Removed edit button and EditTrackModal
- Users use Search to discover and play music

**Files Modified:**

Backend:
- `Dockerfile` - Added ffmpeg package
- `backend/src/routes/tracks.ts` - Admin-only routes, compression
- `backend/src/routes/search.ts` - Global track search
- `backend/src/routes/playlists.ts` - Removed ownership check
- `backend/src/routes/favorites.ts` - Removed ownership check

Frontend:
- `frontend/src/components/Sidebar.tsx` - Conditional Library link
- `frontend/src/views/LibraryView.tsx` - Admin guard, removed edit

---

## v2.0.0 — Bug Fixes & UI Improvements

**Date:** December 2025

Major bug fixes and user experience improvements for the universal library system.

**Bug Fixes:**

1. **Rate Limiting Fix**
   - Increased global rate limit from 100 to 1000 requests/minute
   - Allows bulk operations like batch track imports without hitting limits
   - Auth routes maintain stricter limits for security (3-5 requests/minute)

2. **History Logging Bug**
   - Fixed: Users can now log play history for any track in the global library
   - Previously only logged plays for tracks the user uploaded

3. **HomeView for Non-Admins**
   - Removed "Recently Added" section entirely for non-admin users
   - Previously showed error message trying to access admin-only API
   - Section now only renders for admin users

4. **Non-Null Assertions**
   - Fixed unsafe non-null assertions in users.ts
   - Added proper null checks after database operations

**UI Improvements:**

1. **Heart Icon in Player Bar**
   - Added favorite/unfavorite button next to currently playing track info
   - Pink filled heart shows when track is liked
   - Click to toggle favorite status

2. **Three-Dot Menu for Tracks**
   - Added context menu on hover for tracks in Search results
   - Menu options: "Add to Liked Songs" and "Add to Playlist"
   - Heart icon also visible on hover for quick favorite toggle
   - Playlist picker modal for selecting destination playlist

3. **Playlist Cover Image on Creation**
   - Can now upload cover image when creating a playlist
   - Previously required creating first, then editing to add cover
   - Shows preview of selected image before creation
   - Image optional - falls back to generated placeholder

**Files Modified:**

Backend:
- `backend/src/app.ts` - Increased rate limit to 1000/min
- `backend/src/routes/history.ts` - Fixed track ownership check
- `backend/src/routes/users.ts` - Fixed non-null assertions

Frontend:
- `frontend/src/views/HomeView.tsx` - Admin-only Recently Added section
- `frontend/src/components/player/PlayerBar.tsx` - Added heart icon
- `frontend/src/views/SearchView.tsx` - Added track context menu
- `frontend/src/views/PlaylistsView.tsx` - Cover upload on create

---

## v2.5.0 — Enhanced Playlist Features & UX Improvements

**Date:** December 2025

Major feature additions for playlist management, queue control, and user experience.

**New Features:**

1. **Queue Management**
   - "Play Next" option in track menus (adds track right after current)
   - "Add to Queue" option in track menus (adds to end of queue)
   - Available in playlist track menus and search results
   - Toast notifications confirm queue actions

2. **Playlist Track Menu**
   - Three-dot menu on playlist tracks now fully functional
   - Options: Play Next, Add to Queue, Add to Liked Songs, Add to Playlist, Remove from Playlist
   - Submenu for selecting destination playlist
   - Consistent with search results menu

3. **Playlist Sorting**
   - Sort dropdown in playlist detail view
   - Options: Custom Order, Title (A-Z), Title (Z-A), Artist, Duration, Date Added
   - Drag reordering only available in "Custom Order" mode
   - Visual indicator of current sort option

4. **Bulk Selection**
   - Checkbox selection for playlist tracks
   - Select all / deselect all via header checkbox
   - Bulk actions bar when tracks selected
   - Bulk "Add to Playlist" with playlist picker
   - Bulk "Remove from Playlist" with confirmation
   - Selection count indicator

5. **Import Liked Songs to Playlist**
   - New "Import to Playlist" button in Liked Songs view
   - Modal with existing playlists list
   - Option to create new playlist directly from modal
   - Progress indicator during import
   - Handles duplicates gracefully

6. **Sleep Timer**
   - Moon icon in player bar for sleep timer access
   - Preset options: 5, 15, 30, 45 minutes, 1 hour, 2 hours
   - Real-time countdown display in player bar
   - Auto-pauses playback when timer expires
   - Can cancel timer while active
   - Purple accent when timer is running

7. **Jump Back In Section**
   - Renamed "Recently Played" to "Jump Back In" on Home
   - New welcome section for users with no play history
   - "Start Listening" prompt with Search and Playlists buttons
   - Only shows for non-admin users who haven't played tracks yet

8. **Admin-Only Playlist Uploads**
   - "Add Tracks" button hidden for non-admin users in playlists
   - Drag & drop upload disabled for non-admins
   - Users add tracks via Search and "Add to Playlist" option

**Files Added/Modified:**

Frontend:
- `frontend/src/components/ui/SortableTrackRow.tsx` - Added queue options, selection checkbox
- `frontend/src/views/PlaylistDetailView.tsx` - Sorting, bulk selection, admin-only uploads
- `frontend/src/views/LikedSongsView.tsx` - Import to playlist feature
- `frontend/src/views/SearchView.tsx` - Added queue management options
- `frontend/src/views/HomeView.tsx` - Jump Back In section, welcome prompt
- `frontend/src/components/player/PlayerBar.tsx` - Sleep timer UI
- `frontend/src/stores/playerStore.ts` - Sleep timer state and actions

---

<!-- Future versions will be added here -->
