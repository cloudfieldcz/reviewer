CREATE TABLE `project_owners` (
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	`added_by` integer,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `project_owners_user_idx` ON `project_owners` (`user_id`);