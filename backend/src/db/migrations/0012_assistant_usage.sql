ALTER TABLE `assistant_messages` ADD `model` text;
--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `cache_read_tokens` integer;
--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `cache_write_tokens` integer;
--> statement-breakpoint
ALTER TABLE `assistant_messages` ADD `web_searches` integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer
);
