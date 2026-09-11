CREATE TABLE `campus_conversations` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`decision_id` text NOT NULL,
	`speaker_id` text NOT NULL,
	`speaker_name` text NOT NULL,
	`recipient_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`place` text NOT NULL,
	`at` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`speaker_id`) REFERENCES `campus_characters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `campus_characters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campus_conversations_id_unique` ON `campus_conversations` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campus_conversations_decision_id_unique` ON `campus_conversations` (`decision_id`);--> statement-breakpoint
CREATE INDEX `campus_conversations_speaker_seq` ON `campus_conversations` (`speaker_id`,`seq`);--> statement-breakpoint
CREATE INDEX `campus_conversations_recipient_seq` ON `campus_conversations` (`recipient_id`,`seq`);