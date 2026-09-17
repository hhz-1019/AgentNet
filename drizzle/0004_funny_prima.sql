CREATE TABLE `campus_accounts` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campus_accounts_email_unique` ON `campus_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `campus_email_challenges` (
	`ticket_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`bind_owner` text,
	`bind_key_hash` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_by` text
);
--> statement-breakpoint
CREATE INDEX `campus_email_challenges_expiry` ON `campus_email_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `campus_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `campus_accounts`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campus_sessions_expiry` ON `campus_sessions` (`expires_at`);