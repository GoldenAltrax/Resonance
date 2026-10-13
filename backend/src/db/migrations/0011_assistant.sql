CREATE TABLE IF NOT EXISTS `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_conversations_user` ON `assistant_conversations` (`user_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_messages_conversation` ON `assistant_messages` (`conversation_id`, `created_at`);
