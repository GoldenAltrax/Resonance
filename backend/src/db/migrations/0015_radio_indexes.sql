-- Radio looks up co-plays and shared playlists by track
CREATE INDEX IF NOT EXISTS idx_play_history_track_played ON play_history(track_id, played_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id ON playlist_tracks(track_id);
