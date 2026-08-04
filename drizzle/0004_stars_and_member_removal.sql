-- Hand-trimmed, like 0003. drizzle-kit wanted two extra table rebuilds:
--   * `groups`, chasing the retired `min_attendee_votes` default frozen in
--     0000_init.sql. Nothing reads that key (`withConfigDefaults` projects it
--     away), so meta/0004_snapshot.json keeps the old literal and no migration
--     chases it.
--   * `standing_votes`, because SQLite cannot add a table-level CHECK. It can
--     add a COLUMN carrying one, and such a CHECK may reference a sibling
--     column, so `starred = 0 OR value = 'yes'` — "a star implies a yes" — is
--     enforced by the database on inserts and updates alike, with no rebuild.
--     (The generated rebuild would not even have run: it selected `starred`
--     from the table it was about to add `starred` to.)
ALTER TABLE `members` ADD `removed_at` integer;--> statement-breakpoint
ALTER TABLE `standing_votes` ADD `starred` integer DEFAULT false NOT NULL CHECK ("standing_votes"."starred" in (0, 1) and ("standing_votes"."starred" = 0 or "standing_votes"."value" = 'yes'));--> statement-breakpoint
ALTER TABLE `vetoes` ADD `previous_starred` integer;
