CREATE TABLE `campus_oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `campus_oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `campus_oauth_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `campus_characters`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campus_oauth_codes_expires` ON `campus_oauth_codes` (`expires_at`);