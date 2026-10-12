CREATE TABLE IF NOT EXISTS `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`album` text,
	`duration` integer,
	`cover_url` text,
	`source_url` text,
	`external_id` text,
	`batch_label` text,
	`playlist_id` text,
	`playlist_position` integer,
	`youtube_id` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`track_id` text,
	`requested_by` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_download_jobs_status` ON `download_jobs` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_download_jobs_external` ON `download_jobs` (`external_id`);
