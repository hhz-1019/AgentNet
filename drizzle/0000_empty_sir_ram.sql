CREATE TABLE `campus_characters` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_op` text NOT NULL,
	`token_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campus_characters_id_unique` ON `campus_characters` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campus_characters_token_hash_unique` ON `campus_characters` (`token_hash`);--> statement-breakpoint
CREATE TABLE `campus_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `campus_characters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campus_events_actor_seq` ON `campus_events` (`actor_id`,`seq`);--> statement-breakpoint
CREATE TABLE `campus_pairs` (
	`code` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campus_pairs_token_hash_unique` ON `campus_pairs` (`token_hash`);