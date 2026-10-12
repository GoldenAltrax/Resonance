-- Remove duplicate favorites (same user + track), keeping the earliest row
DELETE FROM favorites
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM favorites GROUP BY user_id, track_id
);
--> statement-breakpoint
DROP INDEX IF EXISTS idx_favorites_user_track;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_track_unique ON favorites(user_id, track_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_track_skips_user_track ON track_skips(user_id, track_id);
