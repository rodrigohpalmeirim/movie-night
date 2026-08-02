/**
 * Drizzle schema — the app-spec data model, which extends the voting spec's.
 *
 * Hard rules encoded here (all enforced by the DATABASE, not the client):
 *   - unique (member_id, movie_id) on standing votes  → one standing vote per member per movie
 *   - unique (round_id, member_id) on vetoes          → one veto per member per round
 *   - unique (round_id, member_id, unordered pair)    → one pair vote per member per pair,
 *                                                       with a CHECK that (a, b) is normalised a < b
 *   - unique (group_id, tmdb_id) on movies            → no duplicate suggestions per group
 *   - unique (group_id, display_name) on members      → claim-a-name identity
 *   - at most one round per group in a state before `decided` (partial unique index)
 *
 * `StandingVote` deliberately has no round scope while `Veto`/`PairVote` do;
 * the two layers must never be merged (voting-spec data model).
 *
 * Timestamps are epoch-milliseconds integers (`timestamp_ms`), with SQL-level
 * defaults of `unixepoch() * 1000` so raw inserts still get a value; the app
 * normally supplies explicit values.
 */

import { relations, sql } from 'drizzle-orm';
import { check, integer, primaryKey, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { DEFAULT_GROUP_CONFIG, type GroupConfig } from './config.js';

const nowMs = sql`(unixepoch() * 1000)`;

/** One frozen standing vote inside `rounds.standing_snapshot`. */
export interface SnapshotVote {
	member_id: string;
	movie_id: string;
	value: StandingVoteValue;
}

/* ------------------------------------------------------------------ */
/* Group                                                               */
/* ------------------------------------------------------------------ */

export const groups = sqliteTable(
	'groups',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		/** ≥128-bit URL-safe slug. Knowing the token *is* the authentication. */
		inviteToken: text('invite_token').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
		/**
		 * The five voting knobs, as one JSON blob.
		 *
		 * `createGroup` always writes the blob explicitly, so this default only
		 * covers a raw insert. It is the SQL literal frozen in
		 * `drizzle/0000_init.sql` and therefore still carries the retired
		 * `min_attendee_votes` key — no migration chases it, because
		 * `withConfigDefaults` drops the key on read and the next settings save
		 * rewrites the row without it.
		 */
		config: text('config', { mode: 'json' })
			.$type<GroupConfig>()
			.notNull()
			.default(DEFAULT_GROUP_CONFIG)
	},
	(t) => [uniqueIndex('groups_invite_token_unique').on(t.inviteToken)]
);

/* ------------------------------------------------------------------ */
/* Member — replaces the voting spec's User; all user_id refs mean member_id  */
/* ------------------------------------------------------------------ */

export const members = sqliteTable(
	'members',
	{
		id: text('id').primaryKey(),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		displayName: text('display_name').notNull(),
		/** Rotation fairness measures never-won members from this date. */
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
	},
	(t) => [
		// Members are never deleted — history references them.
		//
		// Case-INSENSITIVE, because "ana" alongside "Ana" is a typo that quietly
		// buys someone a second ballot. `lower()` is ASCII-only in SQLite, which is
		// the same fold the service layer applies.
		uniqueIndex('members_group_display_name_unique').on(t.groupId, sql`lower(${t.displayName})`),
		index('members_group_idx').on(t.groupId)
	]
);

/* ------------------------------------------------------------------ */
/* Movie                                                               */
/* ------------------------------------------------------------------ */

export const MOVIE_STATUSES = ['pool', 'watched', 'removed'] as const;
export type MovieStatus = (typeof MOVIE_STATUSES)[number];

/**
 * The richer TMDB facts, cached on the movie row as one JSON blob.
 *
 * One column rather than five: it is written as a unit by a single upstream
 * call, read as a unit by the detail screen and the card back, and never
 * queried by parts — the same reasoning that puts `standing_snapshot` on the
 * round. Everything inside is nullable or empty-able, because TMDB has all of
 * it for a blockbuster and none of it for a 1970s obscurity, and a missing
 * field must render as an absent section rather than an error.
 */
export interface MovieDetails {
	tagline: string | null;
	overview: string | null;
	/** Genre names, in TMDB's own order. */
	genres: string[];
	/** For $CERT_COUNTRY, falling back to US, then to whatever TMDB has. */
	certification: string | null;
	directors: string[];
	/** Top billing, truncated — the card back has room for five names. */
	cast: Array<{ name: string; character: string }>;
	/** A YouTube video id, never a URL and never an embed. */
	trailerKey: string | null;
}

export const movies = sqliteTable(
	'movies',
	{
		id: text('id').primaryKey(),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		tmdbId: integer('tmdb_id').notNull(),
		title: text('title').notNull(),
		year: integer('year'),
		/** Feeds tiebreak rule 4 (shortest runtime); null when TMDB has none. */
		runtimeMin: integer('runtime_min'),
		posterPath: text('poster_path'),
		/**
		 * Cached TMDB extras. Null = never successfully fetched; the lazy backfill
		 * fills it in on a later read.
		 */
		details: text('details', { mode: 'json' }).$type<MovieDetails>(),
		/**
		 * When the details call was last ATTEMPTED, successfully or not. A failed
		 * attempt still stamps it, which is what stops a permanently-404ing film
		 * from re-hitting TMDB on every single page load.
		 */
		detailsFetchedAt: integer('details_fetched_at', { mode: 'timestamp_ms' }),
		suggestedBy: text('suggested_by')
			.notNull()
			.references(() => members.id),
		addedAt: integer('added_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
		status: text('status', { enum: MOVIE_STATUSES }).notNull().default('pool'),
		watchedAt: integer('watched_at', { mode: 'timestamp_ms' }),
		removedAt: integer('removed_at', { mode: 'timestamp_ms' }),
		removedBy: text('removed_by').references(() => members.id)
	},
	(t) => [
		// Duplicates are blocked per group on tmdb_id.
		uniqueIndex('movies_group_tmdb_unique').on(t.groupId, t.tmdbId),
		index('movies_group_status_idx').on(t.groupId, t.status),
		check('movies_status_check', sql`${t.status} in ('pool', 'watched', 'removed')`)
	]
);

/* ------------------------------------------------------------------ */
/* StandingVote — the permanent layer, no round scope                  */
/* ------------------------------------------------------------------ */

export const STANDING_VOTE_VALUES = ['yes', 'no'] as const;
export type StandingVoteValue = (typeof STANDING_VOTE_VALUES)[number];

export const standingVotes = sqliteTable(
	'standing_votes',
	{
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		movieId: text('movie_id')
			.notNull()
			.references(() => movies.id, { onDelete: 'cascade' }),
		value: text('value', { enum: STANDING_VOTE_VALUES }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
	},
	(t) => [
		// unique (member_id, movie_id). Absence of a row = "not yet seen", which
		// is a third state and must never be collapsed into "no".
		primaryKey({ name: 'standing_votes_pk', columns: [t.memberId, t.movieId] }),
		index('standing_votes_movie_idx').on(t.movieId),
		check('standing_votes_value_check', sql`${t.value} in ('yes', 'no')`)
	]
);

/* ------------------------------------------------------------------ */
/* Round                                                               */
/* ------------------------------------------------------------------ */

export const ROUND_STATES = ['open', 'runoff', 'decided', 'watched', 'abandoned'] as const;
export type RoundState = (typeof ROUND_STATES)[number];

/** States "before decided" — the ones that make a round *active*. */
export const ACTIVE_ROUND_STATES = ['open', 'runoff'] as const;

export const TIEBREAK_RULES = [
	'copeland',
	'approval',
	'rotation_fairness',
	'shortest_runtime',
	'seeded_random'
] as const;
export type TiebreakRule = (typeof TIEBREAK_RULES)[number];

export const rounds = sqliteTable(
	'rounds',
	{
		id: text('id').primaryKey(),
		groupId: text('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		state: text('state', { enum: ROUND_STATES }).notNull().default('open'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
		createdBy: text('created_by')
			.notNull()
			.references(() => members.id),
		closesAt: integer('closes_at', { mode: 'timestamp_ms' }),
		/** Frozen at OPEN → RUNOFF; never recomputed when attendance changes. */
		finalistIds: text('finalist_ids', { mode: 'json' }).$type<string[]>(),
		/** When OPEN → RUNOFF ran, i.e. when the three snapshots below were taken. */
		runoffAt: integer('runoff_at', { mode: 'timestamp_ms' }),
		/**
		 * Standing votes on the finalists, frozen at OPEN → RUNOFF.
		 *
		 * voting-spec (Veto): "the round's tallies are computed from a snapshot of
		 * standing votes taken when finalists were computed, so a veto can never
		 * mutate the tallies of the round it was cast in."
		 *
		 * Stored as JSON on the round rather than in a snapshot table: it is a
		 * write-once artefact of one transition, always read as a whole unit,
		 * never queried by parts, and bounded by n_finalists × members (≈100
		 * rows). A table would add FKs, a cascade and a join to every runoff read
		 * for no query power — the same reasoning that already puts
		 * `finalist_ids` here.
		 */
		standingSnapshot: text('standing_snapshot', { mode: 'json' }).$type<SnapshotVote[]>(),
		/**
		 * The group's voting knobs, frozen at OPEN → RUNOFF.
		 *
		 * app-spec: "Knob changes take effect at the next finalist computation;
		 * they never retro-affect a round already in RUNOFF or later." Without
		 * this, editing VETO_THRESHOLD mid-runoff would silently re-decide which
		 * finalists are disqualified.
		 */
		configSnapshot: text('config_snapshot', { mode: 'json' }).$type<GroupConfig>(),
		/** null while `decided` = "no clear favourite". */
		winnerId: text('winner_id').references(() => movies.id),
		tiebreakRuleUsed: text('tiebreak_rule_used', { enum: TIEBREAK_RULES }),
		/** Persisted at creation so any seeded tiebreak is reproducible. */
		randomSeed: integer('random_seed').notNull().default(sql`(abs(random()) % 4294967296)`),
		decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
		watchedAt: integer('watched_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		// At most one round per group with state before `decided`.
		uniqueIndex('rounds_one_active_per_group')
			.on(t.groupId)
			.where(sql`${t.state} in ('open', 'runoff')`),
		index('rounds_group_created_idx').on(t.groupId, t.createdAt),
		check('rounds_state_check', sql`${t.state} in ('open', 'runoff', 'decided', 'watched', 'abandoned')`)
	]
);

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export const attendance = sqliteTable(
	'attendance',
	{
		roundId: text('round_id')
			.notNull()
			.references(() => rounds.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		/** No row = hasn't answered; false = explicitly out. Default is out. */
		attending: integer('attending', { mode: 'boolean' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
		/** Self, or whoever proxy-RSVPed ("in — marked by Ana"). */
		updatedBy: text('updated_by')
			.notNull()
			.references(() => members.id),
		/** Set = "done, even if they vetoed nothing"; null = hasn't opened the app. */
		runoffSubmittedAt: integer('runoff_submitted_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		primaryKey({ name: 'attendance_pk', columns: [t.roundId, t.memberId] }),
		index('attendance_round_idx').on(t.roundId)
	]
);

/* ------------------------------------------------------------------ */
/* Veto                                                                */
/* ------------------------------------------------------------------ */

export const vetoes = sqliteTable(
	'vetoes',
	{
		roundId: text('round_id')
			.notNull()
			.references(() => rounds.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		/** null = explicit "no veto" — recorded, never inferred from absence. */
		movieId: text('movie_id').references(() => movies.id),
		/**
		 * What this member's standing vote on `movie_id` was immediately BEFORE the
		 * veto flipped it to "no".
		 *
		 * voting-spec: "Vetoing sets the voter's standing vote on that movie to
		 * 'no'." That write is destructive, so retracting or moving a veto needs to
		 * be able to put back exactly what was there — including putting back
		 * *nothing*, since "no row" is the distinct third state ("not yet seen")
		 * and must never decay into a "no". `'absent'` records that case
		 * explicitly; SQL NULL here means "no flip was applied for this row"
		 * (an explicit pass, or a veto that never counted).
		 */
		previousStandingValue: text('previous_standing_value', {
			enum: ['yes', 'no', 'absent']
		}),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
	},
	(t) => [
		// unique (round_id, member_id): one veto per round, enforced server-side
		// by the constraint rather than by the client.
		primaryKey({ name: 'vetoes_pk', columns: [t.roundId, t.memberId] }),
		index('vetoes_round_movie_idx').on(t.roundId, t.movieId)
	]
);

/* ------------------------------------------------------------------ */
/* PairVote                                                            */
/* ------------------------------------------------------------------ */

export const pairVotes = sqliteTable(
	'pair_votes',
	{
		roundId: text('round_id')
			.notNull()
			.references(() => rounds.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id),
		/** Normalised: movie_a_id < movie_b_id, enforced by CHECK below. */
		movieAId: text('movie_a_id')
			.notNull()
			.references(() => movies.id),
		movieBId: text('movie_b_id')
			.notNull()
			.references(() => movies.id),
		/** null = explicit "no preference", not a missing vote. */
		winnerId: text('winner_id').references(() => movies.id),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
	},
	(t) => [
		// unique (round_id, member_id, unordered pair). The CHECK makes the pair
		// canonical, so the primary key is genuinely per unordered pair and
		// (b, a) cannot sneak in as a second row.
		primaryKey({ name: 'pair_votes_pk', columns: [t.roundId, t.memberId, t.movieAId, t.movieBId] }),
		check('pair_votes_pair_normalized', sql`${t.movieAId} < ${t.movieBId}`),
		check(
			'pair_votes_winner_in_pair',
			sql`${t.winnerId} is null or ${t.winnerId} = ${t.movieAId} or ${t.winnerId} = ${t.movieBId}`
		),
		index('pair_votes_round_idx').on(t.roundId)
	]
);

/* ------------------------------------------------------------------ */
/* Fairness                                                            */
/* ------------------------------------------------------------------ */

export const fairness = sqliteTable('fairness', {
	memberId: text('member_id')
		.primaryKey()
		.references(() => members.id),
	lastWinRoundId: text('last_win_round_id').references(() => rounds.id),
	/**
	 * Stamped when a round reaches WATCHED (never merely DECIDED). Denormalised
	 * from the round so rotation fairness needs no join; it is a stamped fact,
	 * not a running counter.
	 */
	lastWinAt: integer('last_win_at', { mode: 'timestamp_ms' }),
	winsCount: integer('wins_count').notNull().default(0)
});

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const groupsRelations = relations(groups, ({ many }) => ({
	members: many(members),
	movies: many(movies),
	rounds: many(rounds)
}));

export const membersRelations = relations(members, ({ one, many }) => ({
	group: one(groups, { fields: [members.groupId], references: [groups.id] }),
	standingVotes: many(standingVotes),
	fairness: one(fairness, { fields: [members.id], references: [fairness.memberId] })
}));

export const moviesRelations = relations(movies, ({ one, many }) => ({
	group: one(groups, { fields: [movies.groupId], references: [groups.id] }),
	suggester: one(members, { fields: [movies.suggestedBy], references: [members.id] }),
	standingVotes: many(standingVotes)
}));

export const standingVotesRelations = relations(standingVotes, ({ one }) => ({
	member: one(members, { fields: [standingVotes.memberId], references: [members.id] }),
	movie: one(movies, { fields: [standingVotes.movieId], references: [movies.id] })
}));

export const roundsRelations = relations(rounds, ({ one, many }) => ({
	group: one(groups, { fields: [rounds.groupId], references: [groups.id] }),
	winner: one(movies, { fields: [rounds.winnerId], references: [movies.id] }),
	attendance: many(attendance),
	vetoes: many(vetoes),
	pairVotes: many(pairVotes)
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
	round: one(rounds, { fields: [attendance.roundId], references: [rounds.id] }),
	member: one(members, { fields: [attendance.memberId], references: [members.id] })
}));

export const vetoesRelations = relations(vetoes, ({ one }) => ({
	round: one(rounds, { fields: [vetoes.roundId], references: [rounds.id] }),
	member: one(members, { fields: [vetoes.memberId], references: [members.id] }),
	movie: one(movies, { fields: [vetoes.movieId], references: [movies.id] })
}));

export const pairVotesRelations = relations(pairVotes, ({ one }) => ({
	round: one(rounds, { fields: [pairVotes.roundId], references: [rounds.id] }),
	member: one(members, { fields: [pairVotes.memberId], references: [members.id] })
}));

export const fairnessRelations = relations(fairness, ({ one }) => ({
	member: one(members, { fields: [fairness.memberId], references: [members.id] }),
	lastWinRound: one(rounds, { fields: [fairness.lastWinRoundId], references: [rounds.id] })
}));

/* ------------------------------------------------------------------ */
/* Row types                                                           */
/* ------------------------------------------------------------------ */

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
export type StandingVote = typeof standingVotes.$inferSelect;
export type NewStandingVote = typeof standingVotes.$inferInsert;
export type Round = typeof rounds.$inferSelect;
export type NewRound = typeof rounds.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type Veto = typeof vetoes.$inferSelect;
export type NewVeto = typeof vetoes.$inferInsert;
export type PairVote = typeof pairVotes.$inferSelect;
export type NewPairVote = typeof pairVotes.$inferInsert;
export type Fairness = typeof fairness.$inferSelect;
export type NewFairness = typeof fairness.$inferInsert;
