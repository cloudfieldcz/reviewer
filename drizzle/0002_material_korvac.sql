CREATE TABLE `comment_replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_replies_comment_idx` ON `comment_replies` (`comment_id`);--> statement-breakpoint
ALTER TABLE `comments` ADD `resolved_at` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `resolved_by` integer REFERENCES users(id);