/**
 * Movie suggestion, standing votes, and removal.
 *
 * The pool is persistent and independent of rounds: "Suggestions are open at all
 * times", and standing votes are "editable at any time from a pool screen".
 * Neither is phase-gated — and neither can disturb a round in RUNOFF, because
 * that round's tallies come from its frozen snapshot.
 */

import { and, eq } from 'drizzle-orm';
import {
	movies,
	newId,
	rounds,
	standingVotes,
	type Db,
	type GroupConfig,
	type Movie,
	type StandingVote,
	type StandingVoteValue
} from '../db/index.js';
import { notifyGroup } from '../events.js';
import { fail, ok, type Result } from '../result.js';
import { TmdbUnavailableError, type TmdbClient } from '../tmdb.js';

export type SuggestOutcome =
	/** Freshly added to the pool. */
	| { kind: 'created'; movie: Movie }
	/** Already in the pool: "suggesting an existing pool movie just navigates to it". */
	| { kind: 'exists'; movie: Movie }
	/** Was removed; restored with standing votes intact. */
	| { kind: 'restored'; movie: Movie }
	/** Watched and past its cooldown; back in the pool with votes as a starting point. */
	| { kind: 'rewatch'; movie: Movie };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * app-spec: "Duplicates are blocked per group on `tmdb_id`: suggesting an existing
 * pool movie just navigates to it; re-suggesting a *watched* movie follows the
 * re-watch/cooldown rule in the voting spec; re-suggesting a *removed* movie
 * restores it (standing votes intact)."
 *
 * voting-spec: "Optionally allow a watched movie back after a cooldown (default:
 * never, configurable) with standing votes restored as a starting point voters
 * can revise." `rewatch_cooldown === null` means never.
 */
export async function suggestMovie(input: {
	db: Db;
	groupId: string;
	config: GroupConfig;
	actorId: string;
	tmdbId: unknown;
	tmdb: TmdbClient;
	now?: Date;
}): Promise<Result<SuggestOutcome>> {
	const tmdbId = typeof input.tmdbId === 'string' ? Number(input.tmdbId) : input.tmdbId;
	if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) {
		return fail('invalid_input', 'A numeric TMDB id is required');
	}
	const now = input.now ?? new Date();

	const existing = input.db
		.select()
		.from(movies)
		.where(and(eq(movies.groupId, input.groupId), eq(movies.tmdbId, tmdbId)))
		.get();

	if (existing) {
		if (existing.status === 'pool') return ok({ kind: 'exists', movie: existing });

		if (existing.status === 'removed') {
			const restored = input.db
				.update(movies)
				.set({ status: 'pool', removedAt: null, removedBy: null })
				.where(eq(movies.id, existing.id))
				.returning()
				.get();
			notifyGroup(input.groupId);
			return ok({ kind: 'restored', movie: restored });
		}

		// status === 'watched'
		const cooldownDays = input.config.rewatch_cooldown;
		if (cooldownDays === null) {
			return fail('rewatch_cooldown', `"${existing.title}" has already been watched`);
		}
		const watchedAt = existing.watchedAt?.getTime() ?? 0;
		const readyAt = watchedAt + cooldownDays * DAY_MS;
		if (now.getTime() < readyAt) {
			const daysLeft = Math.ceil((readyAt - now.getTime()) / DAY_MS);
			return fail(
				'rewatch_cooldown',
				`"${existing.title}" can be suggested again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
			);
		}
		// `watched_at` is KEPT: it is the historical fact that the group watched this
		// film, it is what the next cooldown is measured from, and history refers to
		// it. Only the status returns to `pool`.
		const revived = input.db
			.update(movies)
			.set({ status: 'pool' })
			.where(eq(movies.id, existing.id))
			.returning()
			.get();
		notifyGroup(input.groupId);
		return ok({ kind: 'rewatch', movie: revived });
	}

	let detail;
	try {
		detail = await input.tmdb.detail(tmdbId);
	} catch (error) {
		if (error instanceof TmdbUnavailableError) {
			// Generic on purpose: `error.message` carries the upstream status (401 for a
			// bad key, 429 for throttling), which is server configuration, not the
			// member's business. Matches what movies/search returns.
			return fail('tmdb_unavailable', 'Movie lookup is unavailable right now');
		}
		throw error;
	}

	try {
		const created = input.db
			.insert(movies)
			.values({
				id: newId(),
				groupId: input.groupId,
				tmdbId: detail.tmdbId,
				title: detail.title,
				year: detail.year,
				runtimeMin: detail.runtimeMin,
				posterPath: detail.posterPath,
				suggestedBy: input.actorId,
				addedAt: now,
				status: 'pool'
			})
			.returning()
			.get();
		notifyGroup(input.groupId);
		return ok({ kind: 'created', movie: created });
	} catch {
		// Lost a race against another member suggesting the same film; the unique
		// (group_id, tmdb_id) index caught it, so just navigate to theirs.
		const raced = input.db
			.select()
			.from(movies)
			.where(and(eq(movies.groupId, input.groupId), eq(movies.tmdbId, tmdbId)))
			.get();
		if (raced) return ok({ kind: 'exists', movie: raced });
		return fail('invalid_input', 'Could not save that movie');
	}
}

/**
 * Standing-vote upsert. Idempotent on the unique (member_id, movie_id) key:
 * "a voter changing their mind updates in place. Re-submitting must not
 * double-count."
 */
export function setStandingVote(input: {
	db: Db;
	groupId: string;
	memberId: string;
	movieId: string;
	value: unknown;
	now?: Date;
}): Result<StandingVote> {
	if (input.value !== 'yes' && input.value !== 'no') {
		return fail('invalid_input', 'Vote must be "yes" or "no"');
	}
	const value = input.value as StandingVoteValue;
	const now = input.now ?? new Date();

	const movie = input.db
		.select()
		.from(movies)
		.where(and(eq(movies.id, input.movieId), eq(movies.groupId, input.groupId)))
		.get();
	if (!movie) return fail('unknown_movie', 'That movie is not in this group');

	const row = upsertStandingVote(input.db, {
		memberId: input.memberId,
		movieId: input.movieId,
		value,
		now
	});
	notifyGroup(input.groupId);
	return ok(row);
}

/** Shared by the pool screen and by the veto's forward-looking flip. */
export function upsertStandingVote(
	db: Db,
	input: { memberId: string; movieId: string; value: StandingVoteValue; now: Date }
): StandingVote {
	return db
		.insert(standingVotes)
		.values({
			memberId: input.memberId,
			movieId: input.movieId,
			value: input.value,
			updatedAt: input.now
		})
		.onConflictDoUpdate({
			target: [standingVotes.memberId, standingVotes.movieId],
			set: { value: input.value, updatedAt: input.now }
		})
		.returning()
		.get();
}

/**
 * app-spec: "Any member can remove a pool movie ... Removal sets `status =
 * removed` and records who removed it; standing votes are kept so restoring (by
 * re-suggesting) loses nothing."
 */
export function removeMovie(input: {
	db: Db;
	groupId: string;
	movieId: string;
	actorId: string;
	now?: Date;
}): Result<Movie> {
	const now = input.now ?? new Date();
	const movie = input.db
		.select()
		.from(movies)
		.where(and(eq(movies.id, input.movieId), eq(movies.groupId, input.groupId)))
		.get();
	if (!movie) return fail('unknown_movie', 'That movie is not in this group');
	if (movie.status === 'removed') return ok(movie); // idempotent
	if (movie.status === 'watched') {
		return fail('invalid_input', 'Watched movies live in history and are not removed');
	}

	// A finalist of a live runoff cannot be removed: it would still be tallied from
	// the frozen snapshot and could still win, leaving a film that is
	// simultaneously removed-by-someone and watched.
	const liveRound = input.db
		.select({ finalistIds: rounds.finalistIds })
		.from(rounds)
		.where(and(eq(rounds.groupId, input.groupId), eq(rounds.state, 'runoff')))
		.get();
	if (liveRound?.finalistIds?.includes(input.movieId)) {
		return fail(
			'wrong_phase',
			`"${movie.title}" is a finalist tonight — it can be removed once the round is done`
		);
	}

	const updated = input.db
		.update(movies)
		.set({ status: 'removed', removedAt: now, removedBy: input.actorId })
		.where(and(eq(movies.id, input.movieId), eq(movies.status, 'pool')))
		.returning()
		.get();
	if (!updated) return fail('state_changed', 'That movie changed while you were looking at it');
	notifyGroup(input.groupId);
	return ok(updated);
}
