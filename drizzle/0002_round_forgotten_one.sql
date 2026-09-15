CREATE TABLE `campus_registration_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `campus_characters` ADD `token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `campus_characters` ADD `owner_key_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `campus_characters_owner_key_hash_unique` ON `campus_characters` (`owner_key_hash`);