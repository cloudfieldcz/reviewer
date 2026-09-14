-- Hand-written. drizzle-kit generates a full table rebuild for a column drop on SQLite; inside the
-- migrator's transaction `PRAGMA foreign_keys=OFF` is a no-op, so `DROP TABLE comments` would cascade
-- away every row of `comment_replies`. Plain ALTERs keep the table (and its replies) in place.
ALTER TABLE `comments` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `status_at` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `status_by` integer REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `comments`
   SET `status` = 'approved',
       `status_at` = `resolved_at`,
       `status_by` = `resolved_by`
 WHERE `resolved_at` IS NOT NULL
   AND `resolved_by` IN (SELECT `id` FROM `users` WHERE `role` = 'admin');--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `resolved_at`;--> statement-breakpoint
ALTER TABLE `comments` DROP COLUMN `resolved_by`;
