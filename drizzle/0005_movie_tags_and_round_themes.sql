-- Hand-trimmed, like 0003 and 0004. drizzle-kit wanted two table rebuilds:
--   * `groups`, chasing the retired `min_attendee_votes` default frozen in
--     0000_init.sql — the same chase 0004 declined, for the same reason, and
--     meta/0005_snapshot.json keeps the old literal so the snapshot stays true.
--   * `rounds`, because SQLite cannot add a table-level CHECK. As in 0004, the
--     CHECK arrives on the column instead: `theme_label` carries "a theme is a
--     folded key and a label, or neither", which may reference its sibling
--     `theme` because that column is added first. Every existing round has
--     neither, so nothing already stored can fail it.
CREATE TABLE `movie_tags` (
	`movie_id` text NOT NULL,
	`tag` text NOT NULL,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`movie_id`, `tag`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "movie_tags_tag_folded" CHECK("movie_tags"."tag" = lower("movie_tags"."tag") and length("movie_tags"."tag") > 0)
);
--> statement-breakpoint
CREATE INDEX `movie_tags_tag_idx` ON `movie_tags` (`tag`);--> statement-breakpoint
ALTER TABLE `rounds` ADD `theme` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `theme_label` text CHECK (("rounds"."theme" is null and "rounds"."theme_label" is null) or ("rounds"."theme" is not null and "rounds"."theme" = lower("rounds"."theme") and "rounds"."theme_label" is not null));
