CREATE TABLE `attendance` (
	`round_id` text NOT NULL,
	`member_id` text NOT NULL,
	`attending` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_by` text NOT NULL,
	`runoff_submitted_at` integer,
	PRIMARY KEY(`round_id`, `member_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_round_idx` ON `attendance` (`round_id`);--> statement-breakpoint
CREATE TABLE `fairness` (
	`member_id` text PRIMARY KEY NOT NULL,
	`last_win_round_id` text,
	`last_win_at` integer,
	`wins_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_win_round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`invite_token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`config` text DEFAULT '{"n_finalists":5,"approval_floor":0.5,"coverage_floor":0.6,"veto_threshold":1,"rewatch_cooldown":null,"min_attendee_votes":3}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_invite_token_unique` ON `groups` (`invite_token`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_group_display_name_unique` ON `members` (`group_id`,`display_name`);--> statement-breakpoint
CREATE INDEX `members_group_idx` ON `members` (`group_id`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`runtime_min` integer,
	`poster_path` text,
	`suggested_by` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`status` text DEFAULT 'pool' NOT NULL,
	`watched_at` integer,
	`removed_at` integer,
	`removed_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggested_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movies_status_check" CHECK("movies"."status" in ('pool', 'watched', 'removed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_group_tmdb_unique` ON `movies` (`group_id`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `movies_group_status_idx` ON `movies` (`group_id`,`status`);--> statement-breakpoint
CREATE TABLE `pair_votes` (
	`round_id` text NOT NULL,
	`member_id` text NOT NULL,
	`movie_a_id` text NOT NULL,
	`movie_b_id` text NOT NULL,
	`winner_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`round_id`, `member_id`, `movie_a_id`, `movie_b_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movie_a_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movie_b_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pair_votes_pair_normalized" CHECK("pair_votes"."movie_a_id" < "pair_votes"."movie_b_id"),
	CONSTRAINT "pair_votes_winner_in_pair" CHECK("pair_votes"."winner_id" is null or "pair_votes"."winner_id" = "pair_votes"."movie_a_id" or "pair_votes"."winner_id" = "pair_votes"."movie_b_id")
);
--> statement-breakpoint
CREATE INDEX `pair_votes_round_idx` ON `pair_votes` (`round_id`);--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_by` text NOT NULL,
	`closes_at` integer,
	`finalist_ids` text,
	`winner_id` text,
	`tiebreak_rule_used` text,
	`random_seed` integer DEFAULT (abs(random()) % 4294967296) NOT NULL,
	`decided_at` integer,
	`watched_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`winner_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rounds_state_check" CHECK("rounds"."state" in ('open', 'runoff', 'decided', 'watched', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_one_active_per_group` ON `rounds` (`group_id`) WHERE "rounds"."state" in ('open', 'runoff');--> statement-breakpoint
CREATE INDEX `rounds_group_created_idx` ON `rounds` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `standing_votes` (
	`member_id` text NOT NULL,
	`movie_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`member_id`, `movie_id`),
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "standing_votes_value_check" CHECK("standing_votes"."value" in ('yes', 'no'))
);
--> statement-breakpoint
CREATE INDEX `standing_votes_movie_idx` ON `standing_votes` (`movie_id`);--> statement-breakpoint
CREATE TABLE `vetoes` (
	`round_id` text NOT NULL,
	`member_id` text NOT NULL,
	`movie_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`round_id`, `member_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vetoes_round_movie_idx` ON `vetoes` (`round_id`,`movie_id`);