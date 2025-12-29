-- Performance indexes for frequently queried columns
-- This migration adds indexes to optimize common query patterns

-- Favorites table indexes
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_track ON favorites(user_id, track_id);

-- Play history table indexes
CREATE INDEX IF NOT EXISTS idx_play_history_user_id ON play_history(user_id);
CREATE INDEX IF NOT EXISTS idx_play_history_user_played ON play_history(user_id, played_at);

-- Playlist tracks table indexes
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON playlist_tracks(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position ON playlist_tracks(playlist_id, position);

-- Playlists table indexes
CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists(user_id);

-- Tracks table indexes
CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
