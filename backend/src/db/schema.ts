import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { getTableColumns } from 'drizzle-orm';

// Users table
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  profileImage: text('profile_image'),
  preferences: text('preferences'), // JSON string of synced player preferences
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Playlists table
export const playlists = sqliteTable('playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  coverImage: text('cover_image'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Tracks table
export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  duration: integer('duration').notNull(), // in seconds
  filePath: text('file_path').notNull(),
  originalFilename: text('original_filename'), // Original filename for duplicate detection
  coverArt: text('cover_art'), // Relative path to extracted album art (e.g. "images/cover-uuid.jpg")
  // Audio analysis fields for Radio mode (similar track matching)
  bpm: integer('bpm'), // Beats per minute (tempo)
  key: text('key'), // Musical key (e.g., "C", "Am", "F#m")
  energy: integer('energy'), // Energy level 0-100 (loudness/intensity)
  // Volume normalization (EBU R128), measured at ingest
  loudness: real('loudness'), // Integrated loudness in LUFS
  truePeak: real('true_peak'), // True peak in dBTP
  // Acoustic fingerprinting fields (added v4.4.0)
  acoustidFingerprint: text('acoustid_fingerprint'), // Chromaprint compressed fingerprint string
  acoustidId: text('acoustid_id'), // AcoustID result ID
  musicbrainzRecordingId: text('musicbrainz_recording_id'), // Top-confidence MusicBrainz Recording ID
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Playlist-Track junction table (many-to-many)
export const playlistTracks = sqliteTable('playlist_tracks', {
  id: text('id').primaryKey(),
  playlistId: text('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Favorites table (user's liked tracks)
export const favorites = sqliteTable('favorites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Play history table (recently played tracks)
export const playHistory = sqliteTable('play_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  playedAt: integer('played_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Track skips table (used for smart recommendation penalty)
// Application-level data isolation note: SQLite has no native Row-Level Security (RLS).
// Enforcement is done at the application layer — every query that reads or mutates user
// data is filtered by userId (ownership check). This is the SQLite equivalent of RLS.
export const trackSkips = sqliteTable('track_skips', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  skipPosition: integer('skip_position').notNull(), // 0-100 % through track when skipped
  skippedAt: integer('skipped_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Invite codes table for admin-managed registration
export const inviteCodes = sqliteTable('invite_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  maxUses: integer('max_uses'), // null = unlimited
  usedCount: integer('used_count').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  expiresAt: integer('expires_at', { mode: 'timestamp' }), // null = never expires
});

// Download queue for the "Add music" pipeline (services/downloader.ts)
export const downloadJobs = sqliteTable('download_jobs', {
  id: text('id').primaryKey(),
  // queued -> searching -> downloading -> importing -> done | skipped | failed
  status: text('status').notNull().default('queued'),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  duration: integer('duration'), // expected length in seconds, used to pick the right YouTube upload
  coverUrl: text('cover_url'),
  sourceUrl: text('source_url'), // set when the request already points at a specific YouTube video
  externalId: text('external_id'), // e.g. "itunes:617154366", "spotify:track:...", for de-duplicating requests
  batchLabel: text('batch_label'), // album or playlist the request came from
  playlistId: text('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  playlistPosition: integer('playlist_position'),
  youtubeId: text('youtube_id'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  trackId: text('track_id').references(() => tracks.id, { onDelete: 'set null' }),
  requestedBy: text('requested_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Admin assistant chats. Every message (including tool calls and results) is kept so
// mistakes can be reviewed later and used to improve the prompt and tools.
export const assistantConversations = sqliteTable('assistant_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const assistantMessages = sqliteTable('assistant_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => assistantConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant' (API roles; tool results are 'user' messages)
  content: text('content').notNull(), // JSON: Anthropic message content blocks
  // Token usage of the model call that produced an assistant message, for the Usage tab.
  // input_tokens excludes cached tokens (rows from before 0012 include them).
  model: text('model'),
  inputTokens: integer('input_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  cacheWriteTokens: integer('cache_write_tokens'),
  outputTokens: integer('output_tokens'),
  webSearches: integer('web_searches'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Small key/value store for admin settings (e.g. the API credit balance entered on the Usage tab)
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Type exports for use in the app
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type PlaylistTrack = typeof playlistTracks.$inferSelect;
export type NewPlaylistTrack = typeof playlistTracks.$inferInsert;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type PlayHistory = typeof playHistory.$inferSelect;
export type NewPlayHistory = typeof playHistory.$inferInsert;
export type DownloadJob = typeof downloadJobs.$inferSelect;
export type AssistantMessage = typeof assistantMessages.$inferSelect;
export type TrackSkip = typeof trackSkips.$inferSelect;
export type NewTrackSkip = typeof trackSkips.$inferInsert;

// Columns safe to send to clients. The Chromaprint fingerprint is several KB per track and
// only used server-side for duplicate detection, so it is excluded from every API response.
export const trackPublicColumns = { acoustidFingerprint: false } as const;

const { acoustidFingerprint: _fingerprint, ...publicTrackFields } = getTableColumns(tracks);
export const trackPublicSelect = publicTrackFields;
