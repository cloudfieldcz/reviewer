ALTER TABLE `comments` ADD `context` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text DEFAULT 'url' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `site_uploaded_at` text;