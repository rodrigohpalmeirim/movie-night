DROP INDEX `members_group_display_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `members_group_display_name_unique` ON `members` (`group_id`,lower("display_name"));--> statement-breakpoint
ALTER TABLE `vetoes` ADD `previous_standing_value` text;