/**
 * Round lifecycle: OPEN → RUNOFF → DECIDED → WATCHED, plus ABANDONED.
 *
 * Two rules shape everything here.
 *
 * 1. **Every transition is a conditional update.** app-spec: "Transitions are
 *    conditional updates (`UPDATE ... WHERE state = <expected>`): any member can
 *    advance the round, so two simultaneous taps must resolve to one transition
 *    and one no-op, never a double-advance or recomputed finalists." The plan/apply
 *    split below exists so that a losing tap discards its computed finalists
 *    instead of writing them.
 *
 * 2. **OPEN → RUNOFF freezes three things**: the finalist set, the standing votes
 *    behind it, and the group's knobs. See `rounds.standing_snapshot` and
 *    `rounds.config_snapshot`.
 */

import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import {
	ACTIVE_ROUND_STATES,
	attendance,
	fairness,
	members,
	movies,
	newId,
	newRandomSeed,
	pairVotes,
	rounds,
	standingVotes,
	toTallyConfig,
	vetoes,
	type Attendance,
	type Db,
	type GroupConfig,
	type Round,
	type SnapshotVote,
	type Veto,
	type TiebreakRule
} from '../db/index.js';
import { notifyGroup } from '../events.js';
import { fail, ok, type Result } from '../result.js';
import { upsertStandingVote } from './movies.js';
import {
	computePhase1,
	computeRunoff,
	generateMatchups,
	memberSeed,
	pairKey,
	seededShuffle,
	type FairnessInput,
	type Matchup,
	type MovieInput,
	type Phase1Result,
	type RunoffResult,
	type StandingVoteInput
} from '../../tally/index.js';

/* ------------------------------------------------------------------ */
/* Loading tally inputs                                                */
/* ------------------------------------------------------------------ */

export function loadTallyMovies(db: Db, groupId: string): MovieInput[] {
	return db
		.select({
			id: movies.id,
			runtimeMin: movies.runtimeMin,
			suggestedBy: movies.suggestedBy,
			status: movies.status
		})
		.from(movies)
		.where(eq(movies.groupId, groupId))
		.all();
}

/** Live standing votes for the whole group, scoped through the movie's group. */
export function loadStandingVotes(db: Db, groupId: string): StandingVoteInput[] {
	return db
		.select({
			memberId: standingVotes.memberId,
			movieId: standingVotes.movieId,
			value: standingVotes.value
		})
		.from(standingVotes)
		.innerJoin(movies, eq(movies.id, standingVotes.movieId))
		.where(eq(movies.groupId, groupId))
		.all();
}

/**
 * One record per member, so rotation fairness can measure never-won members from
 * their join date. Derived with a LEFT JOIN rather than requiring a fairness row,
 * so a member missing one still gets a join date instead of silently losing all
 * fairness claim.
 */
export function loadFairness(db: Db, groupId: string): FairnessInput[] {
	return db
		.select({
			memberId: members.id,
			joinedAt: members.createdAt,
			lastWinAt: fairness.lastWinAt,
			winsCount: fairness.winsCount
		})
		.from(members)
		.leftJoin(fairness, eq(fairness.memberId, members.id))
		.where(eq(members.groupId, groupId))
		.all()
		.map((row) => ({
			memberId: row.memberId,
			joinedAt: row.joinedAt.getTime(),
			lastWinAt: row.lastWinAt?.getTime() ?? null,
			winsCount: row.winsCount ?? 0
		}));
}

/**
 * Movies that already won a round which has been DECIDED but not yet marked
 * WATCHED.
 *
 * voting-spec keeps `status` and the fairness counter moving only at WATCHED, so
 * such a winner is legitimately still `status = pool`. But it must not be able to
 * win a *second* round: that produced two WATCHED transitions for one viewing and
 * `wins_count = 2` for a single film. Excluding it from eligibility fixes the
 * double count without touching the spec's WATCHED-only rule.
 */
export function pendingWinnerIds(db: Db, groupId: string): string[] {
	return db
		.select({ winnerId: rounds.winnerId })
		.from(rounds)
		.where(and(eq(rounds.groupId, groupId), eq(rounds.state, 'decided'), isNotNull(rounds.winnerId)))
		.all()
		.flatMap((row) => (row.winnerId ? [row.winnerId] : []));
}

/** Attendees are members with `attending = true`; no row means "hasn't answered". */
export function loadAttendeeIds(db: Db, roundId: string): string[] {
	return db
		.select({ memberId: attendance.memberId })
		.from(attendance)
		.where(and(eq(attendance.roundId, roundId), eq(attendance.attending, true)))
		.all()
		.map((row) => row.memberId);
}

export function loadAttendance(db: Db, roundId: string): Attendance[] {
	return db.select().from(attendance).where(eq(attendance.roundId, roundId)).all();
}

/** The frozen snapshot, in the tally module's input shape. */
export function snapshotToStandingVotes(snapshot: SnapshotVote[] | null): StandingVoteInput[] {
	return (snapshot ?? []).map((row) => ({
		memberId: row.member_id,
		movieId: row.movie_id,
		value: row.value
	}));
}

/* ------------------------------------------------------------------ */
/* Reading rounds                                                      */
/* ------------------------------------------------------------------ */

/** The at-most-one round in a state before `decided`. */
export function getActiveRound(db: Db, groupId: string): Round | undefined {
	return db
		.select()
		.from(rounds)
		.where(and(eq(rounds.groupId, groupId), inArray(rounds.state, [...ACTIVE_ROUND_STATES])))
		.get();
}

/**
 * What the round tab shows: the active round if there is one, otherwise the most
 * recent round so the group can still see (and mark watched) the last result.
 */
export function getCurrentRound(db: Db, groupId: string): Round | undefined {
	return (
		getActiveRound(db, groupId) ??
		db
			.select()
			.from(rounds)
			.where(eq(rounds.groupId, groupId))
			.orderBy(desc(rounds.createdAt), desc(rounds.id))
			.limit(1)
			.get()
	);
}

export function getRound(db: Db, groupId: string, roundId: string): Round | undefined {
	return db
		.select()
		.from(rounds)
		.where(and(eq(rounds.groupId, groupId), eq(rounds.id, roundId)))
		.get();
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

/**
 * "At most one active round per group (active = any state before DECIDED)."
 * Enforced by the partial unique index; the pre-read only exists to turn the
 * constraint violation into a useful message.
 *
 * "Creating a round marks nobody as attending" — no attendance rows are written.
 */
export function createRound(input: {
	db: Db;
	groupId: string;
	actorId: string;
	closesAt?: Date | null;
	now?: Date;
	seed?: number;
}): Result<Round> {
	const now = input.now ?? new Date();
	const existing = getActiveRound(input.db, input.groupId);
	if (existing) return fail('active_round_exists', 'This group already has a round in progress');

	try {
		const round = input.db
			.insert(rounds)
			.values({
				id: newId(),
				groupId: input.groupId,
				state: 'open',
				createdAt: now,
				createdBy: input.actorId,
				closesAt: input.closesAt ?? null,
				randomSeed: input.seed ?? newRandomSeed()
			})
			.returning()
			.get();
		notifyGroup(input.groupId);
		return ok(round);
	} catch {
		// Lost the race against another member's tap: the partial unique index
		// rejected the second insert, which is exactly the desired outcome.
		return fail('active_round_exists', 'This group already has a round in progress');
	}
}

/* ------------------------------------------------------------------ */
/* Advance (plan / apply)                                              */
/* ------------------------------------------------------------------ */

export type AdvancePlan =
	| {
			kind: 'open_to_runoff';
			roundId: string;
			finalistIds: string[];
			snapshot: SnapshotVote[];
			configSnapshot: GroupConfig;
			phase1: Phase1Result;
			at: Date;
	  }
	| {
			kind: 'open_to_decided';
			roundId: string;
			finalistIds: string[];
			snapshot: SnapshotVote[];
			configSnapshot: GroupConfig;
			phase1: Phase1Result;
			winnerId: string | null;
			at: Date;
	  }
	| {
			kind: 'runoff_to_decided';
			roundId: string;
			winnerId: string | null;
			tiebreakRuleUsed: TiebreakRule | null;
			runoff: RunoffResult;
			at: Date;
	  };

/**
 * Computes what the next transition *would* do, without writing anything. Split
 * out from `applyAdvance` so a concurrent tap can be proven to become a no-op:
 * two plans may be built from the same OPEN state, but only the first apply wins
 * and the second one's finalists are thrown away.
 */
export function planAdvance(input: {
	db: Db;
	groupId: string;
	config: GroupConfig;
	round: Round;
	now?: Date;
}): Result<AdvancePlan> {
	const { db, round } = input;
	const now = input.now ?? new Date();

	if (round.state === 'open') {
		const attendeeIds = loadAttendeeIds(db, round.id);
		// app-spec: the transition to RUNOFF "is blocked with an explanatory
		// message while attendees < MIN_ATTENDEE_VOTES — otherwise no movie could
		// be eligible and the round would end 'no clear favourite' for a reason the
		// group can fix in one tap."
		if (attendeeIds.length < input.config.min_attendee_votes) {
			return fail(
				'not_enough_attendees',
				`${attendeeIds.length} attending, but ${input.config.min_attendee_votes} are needed before a movie can be eligible`
			);
		}

		const liveVotes = loadStandingVotes(db, input.groupId);
		// A film awaiting its "we watched it" tap is spoken for; it must not be able
		// to win a second round and consume its suggester's turn twice.
		const pending = new Set(pendingWinnerIds(db, input.groupId));
		const phase1 = computePhase1({
			attendeeIds,
			movies: loadTallyMovies(db, input.groupId).filter((movie) => !pending.has(movie.id)),
			standingVotes: liveVotes,
			config: toTallyConfig(input.config),
			fairness: loadFairness(db, input.groupId),
			seed: round.randomSeed
		});

		// The snapshot covers exactly the finalists: they are the only movies whose
		// approval feeds the runoff tiebreak and the reveal's approval numbers, and
		// bounding it at n_finalists × members keeps the JSON small no matter how
		// large the pool grows.
		const finalistSet = new Set(phase1.finalistIds);
		const snapshot: SnapshotVote[] = liveVotes
			.filter((vote) => finalistSet.has(vote.movieId))
			.map((vote) => ({ member_id: vote.memberId, movie_id: vote.movieId, value: vote.value }));

		if (phase1.outcome === 'runoff') {
			return ok({
				kind: 'open_to_runoff',
				roundId: round.id,
				finalistIds: phase1.finalistIds,
				snapshot,
				configSnapshot: input.config,
				phase1,
				at: now
			});
		}
		// Outright winner, or nothing cleared the floor: "Skipped entirely when only
		// one movie clears the approval floor" / "the round ends in a distinct
		// DECIDED-with-no-winner presentation".
		return ok({
			kind: 'open_to_decided',
			roundId: round.id,
			finalistIds: phase1.finalistIds,
			snapshot,
			configSnapshot: input.config,
			phase1,
			winnerId: phase1.outrightWinnerId,
			at: now
		});
	}

	if (round.state === 'runoff') {
		// The same floor as OPEN → RUNOFF. Without it, RSVPing everyone out before
		// the reveal produced a "winner" from an empty electorate: an all-zero
		// head-to-head matrix decided by runtime, with the "hasn't voted" warning
		// silently empty because nobody counted as an attendee any more.
		const attendeeIds = loadAttendeeIds(db, round.id);
		// From the FROZEN config: a knob edited mid-runoff must not retro-affect it.
		const floor = round.configSnapshot?.min_attendee_votes ?? input.config.min_attendee_votes;
		if (attendeeIds.length < floor) {
			return fail(
				'not_enough_attendees',
				`${attendeeIds.length} attending, but ${floor} are needed to decide a winner`
			);
		}
		const evaluated = evaluateRunoff({ db, groupId: input.groupId, round });
		if (!evaluated.ok) return evaluated;
		const runoff = evaluated.value;
		return ok({
			kind: 'runoff_to_decided',
			roundId: round.id,
			winnerId: runoff.winnerId,
			tiebreakRuleUsed: (runoff.tiebreak?.rule ?? null) as TiebreakRule | null,
			runoff,
			at: now
		});
	}

	return fail('illegal_transition', `A ${round.state} round cannot be advanced`);
}

/**
 * The conditional update. Returns `state_changed` when another tap got there
 * first, which callers treat as a successful no-op rather than an error.
 */
export function applyAdvance(db: Db, groupId: string, plan: AdvancePlan): Result<Round> {
	if (plan.kind === 'runoff_to_decided') {
		const updated = db
			.update(rounds)
			.set({
				state: 'decided',
				winnerId: plan.winnerId,
				tiebreakRuleUsed: plan.tiebreakRuleUsed,
				decidedAt: plan.at
			})
			.where(and(eq(rounds.id, plan.roundId), eq(rounds.state, 'runoff')))
			.returning()
			.get();
		if (!updated) return fail('state_changed', 'Someone else already revealed the winner');
		notifyGroup(groupId);
		return ok(updated);
	}

	const toRunoff = plan.kind === 'open_to_runoff';
	const updated = db
		.update(rounds)
		.set({
			state: toRunoff ? 'runoff' : 'decided',
			finalistIds: plan.finalistIds,
			standingSnapshot: plan.snapshot,
			configSnapshot: plan.configSnapshot,
			runoffAt: plan.at,
			winnerId: toRunoff ? null : plan.winnerId,
			tiebreakRuleUsed: null,
			decidedAt: toRunoff ? null : plan.at
		})
		.where(and(eq(rounds.id, plan.roundId), eq(rounds.state, 'open')))
		.returning()
		.get();
	if (!updated) return fail('state_changed', 'Someone else already closed swiping');
	notifyGroup(groupId);
	return ok(updated);
}

export function advanceRound(input: {
	db: Db;
	groupId: string;
	config: GroupConfig;
	roundId: string;
	now?: Date;
}): Result<{ round: Round; plan: AdvancePlan }> {
	const round = getRound(input.db, input.groupId, input.roundId);
	if (!round) return fail('unknown_round', 'Round not found');
	const plan = planAdvance({ ...input, round });
	if (!plan.ok) return plan;
	const applied = applyAdvance(input.db, input.groupId, plan.value);
	if (!applied.ok) return applied;
	return ok({ round: applied.value, plan: plan.value });
}

/**
 * Recomputes the runoff from the FROZEN snapshot and the CURRENT attendee set.
 * Used both to decide the round and to render the reveal, so the two can never
 * disagree.
 */
export function evaluateRunoff(input: { db: Db; groupId: string; round: Round }): Result<RunoffResult> {
	const { db, round } = input;
	if (round.finalistIds === null || round.standingSnapshot === null || round.configSnapshot === null) {
		return fail('wrong_phase', 'This round has no finalists yet');
	}
	return ok(
		computeRunoff({
			finalistIds: round.finalistIds,
			attendeeIds: loadAttendeeIds(db, round.id),
			movies: loadTallyMovies(db, input.groupId),
			// Frozen: a veto cast during this round can never move these numbers.
			standingVotes: snapshotToStandingVotes(round.standingSnapshot),
			vetoes: db
				.select({ memberId: vetoes.memberId, movieId: vetoes.movieId })
				.from(vetoes)
				.where(eq(vetoes.roundId, round.id))
				.all(),
			pairVotes: db
				.select({
					memberId: pairVotes.memberId,
					movieAId: pairVotes.movieAId,
					movieBId: pairVotes.movieBId,
					winnerId: pairVotes.winnerId
				})
				.from(pairVotes)
				.where(eq(pairVotes.roundId, round.id))
				.all(),
			config: toTallyConfig(round.configSnapshot),
			fairness: loadFairness(db, input.groupId),
			seed: round.randomSeed
		})
	);
}

/* ------------------------------------------------------------------ */
/* Abandon / watched                                                   */
/* ------------------------------------------------------------------ */

/**
 * app-spec: "any member can abandon a round at any point before WATCHED — movie
 * night got cancelled ... does not update fairness counters, which only move on
 * WATCHED."
 */
export function abandonRound(input: { db: Db; groupId: string; roundId: string }): Result<Round> {
	const round = getRound(input.db, input.groupId, input.roundId);
	if (!round) return fail('unknown_round', 'Round not found');
	if (round.state === 'abandoned') return ok(round);
	// Only a round that has not produced a result can be cancelled. Abandoning a
	// DECIDED round would erase a night from history and leave its winner
	// permanently unwatchable, so the fairness counter could never move.
	if (round.state !== 'open' && round.state !== 'runoff') {
		return fail('illegal_transition', `A ${round.state} round cannot be abandoned`);
	}

	const updated = input.db
		.update(rounds)
		.set({ state: 'abandoned' })
		.where(and(eq(rounds.id, round.id), inArray(rounds.state, ['open', 'runoff'])))
		.returning()
		.get();
	if (!updated) return fail('state_changed', 'That round changed while you were looking at it');
	notifyGroup(input.groupId);
	return ok(updated);
}

/**
 * "WATCHED — Retires the movie, stamps `watched_at`, updates the fairness counter
 * per the voting spec."
 *
 * voting-spec: "Update the fairness counter for the winner's `suggested_by` when
 * the movie is marked **watched**, not when the round is decided — otherwise an
 * abandoned movie night still consumes someone's turn."
 */
export function markWatched(input: {
	db: Db;
	groupId: string;
	roundId: string;
	now?: Date;
}): Result<Round> {
	const now = input.now ?? new Date();
	const round = getRound(input.db, input.groupId, input.roundId);
	if (!round) return fail('unknown_round', 'Round not found');
	if (round.state !== 'decided') {
		return fail('illegal_transition', `A ${round.state} round cannot be marked watched`);
	}
	if (round.winnerId === null) {
		return fail('no_winner_to_watch', 'This round ended with no clear favourite, so there is nothing to retire');
	}
	const winnerId = round.winnerId;

	return input.db.transaction((tx) => {
		const db = tx as unknown as Db;
		const updated = db
			.update(rounds)
			.set({ state: 'watched', watchedAt: now })
			.where(and(eq(rounds.id, round.id), eq(rounds.state, 'decided')))
			.returning()
			.get();
		if (!updated) return fail('state_changed', 'Someone else already marked this watched');

		const winner = db.select().from(movies).where(eq(movies.id, winnerId)).get();
		if (!winner) return fail('unknown_movie', 'The winning movie has gone missing');

		// "When a movie is watched, set status = watched and stamp watched_at. Its
		// standing votes are archived, not deleted."
		db.update(movies).set({ status: 'watched', watchedAt: now }).where(eq(movies.id, winnerId)).run();

		db.insert(fairness)
			.values({
				memberId: winner.suggestedBy,
				lastWinRoundId: round.id,
				lastWinAt: now,
				winsCount: 1
			})
			.onConflictDoUpdate({
				target: fairness.memberId,
				set: {
					lastWinRoundId: round.id,
					lastWinAt: now,
					winsCount: sql`${fairness.winsCount} + 1`
				}
			})
			.run();

		notifyGroup(input.groupId);
		return ok(updated);
	});
}

/* ------------------------------------------------------------------ */
/* RSVP                                                                */
/* ------------------------------------------------------------------ */

/**
 * app-spec: "any member can RSVP anyone (trust-based, like everything else) ...
 * Proxy RSVPs record who set them ('in — marked by Ana') so mistakes are visible
 * and reversible." and "RSVP can change any time until the round is DECIDED."
 */
export function setRsvp(input: {
	db: Db;
	groupId: string;
	roundId: string;
	memberId: string;
	attending: unknown;
	actorId: string;
	now?: Date;
}): Result<Attendance> {
	if (typeof input.attending !== 'boolean') {
		return fail('invalid_input', 'attending must be true or false');
	}
	const now = input.now ?? new Date();
	const round = getRound(input.db, input.groupId, input.roundId);
	if (!round) return fail('unknown_round', 'Round not found');
	if (round.state !== 'open' && round.state !== 'runoff') {
		return fail('wrong_phase', 'RSVPs are closed once the winner is revealed');
	}
	const target = input.db
		.select()
		.from(members)
		.where(and(eq(members.groupId, input.groupId), eq(members.id, input.memberId)))
		.get();
	if (!target) return fail('unknown_member', 'That member is not in this group');

	const row = input.db
		.insert(attendance)
		.values({
			roundId: input.roundId,
			memberId: input.memberId,
			attending: input.attending,
			updatedAt: now,
			updatedBy: input.actorId
		})
		.onConflictDoUpdate({
			target: [attendance.roundId, attendance.memberId],
			set: { attending: input.attending, updatedAt: now, updatedBy: input.actorId }
		})
		.returning()
		.get();
	notifyGroup(input.groupId);
	return ok(row);
}

/* ------------------------------------------------------------------ */
/* Veto                                                                */
/* ------------------------------------------------------------------ */

function requireRunoffAttendee(
	db: Db,
	groupId: string,
	roundId: string,
	memberId: string
): Result<Round> {
	const round = getRound(db, groupId, roundId);
	if (!round) return fail('unknown_round', 'Round not found');
	if (round.state !== 'runoff') {
		return fail('wrong_phase', `Runoff votes are only accepted in RUNOFF, not ${round.state}`);
	}
	const rsvp = db
		.select()
		.from(attendance)
		.where(and(eq(attendance.roundId, roundId), eq(attendance.memberId, memberId)))
		.get();
	if (!rsvp || !rsvp.attending) {
		return fail('not_attending', 'Only attendees vote in the runoff — RSVP in first');
	}
	return ok(round);
}

/**
 * "each attendee may veto **one finalist** ... Skippable." A `movieId` of null is
 * the explicit pass, recorded as a row so "done, vetoed nothing" is never
 * confused with "hasn't opened the app".
 *
 * The standing-vote flip touches **only the acting member's own** standing vote,
 * and is fully reversible — see `applyOwnVetoFlip`. Anything wider would let one
 * member's veto rewrite another member's permanent pool answers.
 */
export function castVeto(input: {
	db: Db;
	groupId: string;
	roundId: string;
	memberId: string;
	movieId: unknown;
	now?: Date;
}): Result<{ movieId: string | null; submitted: boolean }> {
	const now = input.now ?? new Date();
	const gate = requireRunoffAttendee(input.db, input.groupId, input.roundId, input.memberId);
	if (!gate.ok) return gate;
	const round = gate.value;

	const movieId = input.movieId === undefined || input.movieId === '' ? null : input.movieId;
	if (movieId !== null && typeof movieId !== 'string') {
		return fail('invalid_input', 'movie_id must be a string or null');
	}
	const finalistIds = round.finalistIds ?? [];
	if (movieId !== null && !finalistIds.includes(movieId)) {
		return fail('invalid_input', 'You can only veto one of tonight’s finalists');
	}

	return input.db.transaction((tx) => {
		const db = tx as unknown as Db;
		const previous = db
			.select()
			.from(vetoes)
			.where(and(eq(vetoes.roundId, input.roundId), eq(vetoes.memberId, input.memberId)))
			.get();

		const flip = applyOwnVetoFlip({
			db,
			memberId: input.memberId,
			previous,
			nextMovieId: movieId,
			now
		});

		db.insert(vetoes)
			.values({
				roundId: input.roundId,
				memberId: input.memberId,
				movieId,
				previousStandingValue: flip.previousStandingValue,
				createdAt: now
			})
			.onConflictDoUpdate({
				target: [vetoes.roundId, vetoes.memberId],
				set: { movieId, previousStandingValue: flip.previousStandingValue, createdAt: now }
			})
			.run();

		const submitted = maybeMarkSubmitted({ db, round, memberId: input.memberId, now });
		notifyGroup(input.groupId);
		return ok({ movieId, submitted });
	});
}

/** What a veto row remembers about the standing vote it overwrote. */
export type PreviousStandingValue = 'yes' | 'no' | 'absent';

/**
 * The whole of the veto's effect on the permanent layer, for ONE member.
 *
 * voting-spec: "Vetoing sets the voter's standing vote on that movie to 'no', so
 * the two layers can never contradict each other." The flip is forward-looking —
 * the round reads its frozen snapshot, so it cannot move tonight's numbers — but
 * it is still a destructive write to a permanent, user-owned answer, so three
 * rules apply:
 *
 *  1. **Only the acting member's row is ever written.** Recomputing flips for the
 *     whole round (the previous behaviour) let member X's veto silently revert
 *     member Y's later pool-screen edit, stamped with X's timestamp.
 *  2. **Moving or retracting a veto restores the old target exactly**, including
 *     back to *no row at all* — "not yet seen" is a distinct third state, and
 *     leaving a "no" behind would both destroy a real answer and inflate the
 *     coverage denominator for every future round.
 *  3. **A later explicit edit by that member wins.** If the standing row was
 *     touched after the flip (`updated_at > veto.created_at`), the member has
 *     since answered for themselves and the restore is skipped.
 */
export function applyOwnVetoFlip(input: {
	db: Db;
	memberId: string;
	previous: Veto | undefined;
	nextMovieId: string | null;
	now: Date;
}): { previousStandingValue: PreviousStandingValue | null } {
	const { db, memberId, previous, nextMovieId, now } = input;

	// Same target as before. Nothing to restore, but the flip must be re-asserted:
	// if the member set that film back to "yes" on the pool screen in between,
	// leaving it there would let the two layers contradict each other, which is the
	// whole reason the flip exists.
	if (previous && previous.movieId === nextMovieId) {
		// Both null: the member re-submitted an explicit pass. Nothing was ever
		// flipped, so there is nothing to re-assert.
		if (nextMovieId === null) return { previousStandingValue: null };
		const current = db
			.select()
			.from(standingVotes)
			.where(and(eq(standingVotes.memberId, memberId), eq(standingVotes.movieId, nextMovieId)))
			.get();
		const editedSinceFlip =
			current !== undefined && current.updatedAt.getTime() > previous.createdAt.getTime();
		// Only an edit made since the flip may replace the remembered value; reading
		// it unconditionally would remember the "no" this very flip wrote and destroy
		// the real pre-veto answer.
		const remembered: PreviousStandingValue | null = editedSinceFlip
			? (current?.value ?? 'absent')
			: (previous.previousStandingValue ?? null);
		upsertStandingVote(db, { memberId, movieId: nextMovieId, value: 'no', now });
		return { previousStandingValue: remembered ?? 'absent' };
	}

	// Undo the old flip first.
	if (previous?.movieId && previous.previousStandingValue) {
		restoreStandingVote({
			db,
			memberId,
			movieId: previous.movieId,
			to: previous.previousStandingValue,
			flippedAt: previous.createdAt
		});
	}

	if (nextMovieId === null) return { previousStandingValue: null };

	// Remember what we are about to overwrite, then overwrite it.
	const current = db
		.select()
		.from(standingVotes)
		.where(and(eq(standingVotes.memberId, memberId), eq(standingVotes.movieId, nextMovieId)))
		.get();
	const remembered: PreviousStandingValue = current ? current.value : 'absent';
	upsertStandingVote(db, { memberId, movieId: nextMovieId, value: 'no', now });
	return { previousStandingValue: remembered };
}

/**
 * Puts a standing vote back to what the veto overwrote — unless the member has
 * edited it themselves since, in which case their explicit answer wins.
 */
function restoreStandingVote(input: {
	db: Db;
	memberId: string;
	movieId: string;
	to: PreviousStandingValue;
	flippedAt: Date;
}): void {
	const { db, memberId, movieId } = input;
	const current = db
		.select()
		.from(standingVotes)
		.where(and(eq(standingVotes.memberId, memberId), eq(standingVotes.movieId, movieId)))
		.get();

	// Edited after the flip → that edit is the member's real opinion. Leave it.
	if (current && current.updatedAt.getTime() > input.flippedAt.getTime()) return;

	if (input.to === 'absent') {
		// Back to the third state: no row at all.
		db.delete(standingVotes)
			.where(and(eq(standingVotes.memberId, memberId), eq(standingVotes.movieId, movieId)))
			.run();
		return;
	}
	upsertStandingVote(db, { memberId, movieId, value: input.to, now: input.flippedAt });
}

/* ------------------------------------------------------------------ */
/* Pair votes                                                          */
/* ------------------------------------------------------------------ */

/**
 * "Present one pair per screen: two posters, tap the preferred one. Allow 'skip /
 * no preference'." `winner: null` is that explicit no-preference.
 *
 * The pair is validated against the full finalist set rather than the current
 * survivors, so a vote cast just before someone else's veto disqualifies a movie
 * is still accepted; the tally then ignores pairs that are not in the surviving
 * round robin anyway.
 */
export function castPairVote(input: {
	db: Db;
	groupId: string;
	roundId: string;
	memberId: string;
	a: unknown;
	b: unknown;
	winner?: unknown;
	now?: Date;
}): Result<{ a: string; b: string; winnerId: string | null; submitted: boolean }> {
	const now = input.now ?? new Date();
	const gate = requireRunoffAttendee(input.db, input.groupId, input.roundId, input.memberId);
	if (!gate.ok) return gate;
	const round = gate.value;

	if (typeof input.a !== 'string' || typeof input.b !== 'string' || input.a === input.b) {
		return fail('invalid_input', 'Two distinct movie ids are required');
	}
	const finalistIds = round.finalistIds ?? [];
	if (!finalistIds.includes(input.a) || !finalistIds.includes(input.b)) {
		return fail('invalid_input', 'Both movies must be finalists of this round');
	}
	const winnerId =
		input.winner === undefined || input.winner === null || input.winner === '' ? null : input.winner;
	if (winnerId !== null && winnerId !== input.a && winnerId !== input.b) {
		return fail('invalid_input', 'The winner must be one of the two movies, or null for no preference');
	}

	// Normalised to a < b so the primary key really is per unordered pair; the
	// CHECK constraint in the schema would reject anything else.
	const [a, b] = input.a < input.b ? [input.a, input.b] : [input.b, input.a];

	return input.db.transaction((tx) => {
		const db = tx as unknown as Db;
		db.insert(pairVotes)
			.values({
				roundId: input.roundId,
				memberId: input.memberId,
				movieAId: a,
				movieBId: b,
				winnerId: winnerId as string | null,
				createdAt: now
			})
			.onConflictDoUpdate({
				target: [pairVotes.roundId, pairVotes.memberId, pairVotes.movieAId, pairVotes.movieBId],
				set: { winnerId: winnerId as string | null, createdAt: now }
			})
			.run();

		const submitted = maybeMarkSubmitted({ db, round, memberId: input.memberId, now });
		notifyGroup(input.groupId);
		return ok({ a, b, winnerId: (winnerId as string | null) ?? null, submitted });
	});
}

/* ------------------------------------------------------------------ */
/* Per-member runoff progress                                          */
/* ------------------------------------------------------------------ */

export interface MemberRunoffProgress {
	/** Surviving finalists, i.e. the pairs this member is asked about. */
	matchups: Matchup[];
	/** In this member's own shuffled order (app-spec: "per-user shuffled order"). */
	order: Matchup[];
	done: number;
	total: number;
	nextPair: Matchup | null;
	vetoSubmitted: boolean;
	myVetoMovieId: string | null;
	myPairVotes: Array<{ a: string; b: string; winnerId: string | null }>;
	complete: boolean;
}

export function memberRunoffProgress(input: {
	db: Db;
	round: Round;
	memberId: string;
}): MemberRunoffProgress {
	const { db, round } = input;
	const finalistIds = round.finalistIds ?? [];

	// Deliberately the FULL frozen finalist set, not the survivors.
	//
	// Asking only about survivors leaked other people's vetoes: the difference
	// between this list and the published finalist list named every disqualified
	// film, and with VETO_THRESHOLD > 1 it was a live veto counter. The tally
	// already ignores pairs involving a disqualified movie, and app-spec's effort
	// budget explicitly allows "up to 10 pairwise taps" at N_FINALISTS <= 5, so
	// asking C(N,2) closes the channel at no cost to the budget.
	const matchups = generateMatchups(finalistIds);
	const myVeto = db
		.select()
		.from(vetoes)
		.where(and(eq(vetoes.roundId, round.id), eq(vetoes.memberId, input.memberId)))
		.get();
	const mine = db
		.select()
		.from(pairVotes)
		.where(and(eq(pairVotes.roundId, round.id), eq(pairVotes.memberId, input.memberId)))
		.all();
	const cast = new Set(mine.map((row) => pairKey(row.movieAId, row.movieBId)));

	const order = seededShuffle(matchups, memberSeed(round.randomSeed, input.memberId));
	const outstanding = order.filter((pair) => !cast.has(pairKey(pair.a, pair.b)));
	const done = matchups.length - outstanding.length;

	return {
		matchups,
		order,
		done,
		total: matchups.length,
		nextPair: outstanding[0] ?? null,
		vetoSubmitted: myVeto !== undefined,
		myVetoMovieId: myVeto?.movieId ?? null,
		myPairVotes: mine.map((row) => ({ a: row.movieAId, b: row.movieBId, winnerId: row.winnerId })),
		complete: myVeto !== undefined && outstanding.length === 0
	};
}

/**
 * app-spec: "`runoff_submitted_at` is set when a voter finishes their last pair
 * (or passes the veto screen), so 'done, chose nothing' is distinguishable from
 * 'hasn't opened the app'."
 *
 * Implemented as "has recorded a veto decision AND has no outstanding pairs".
 * The veto pass itself is already recorded explicitly as a `vetoes` row with
 * `movie_id = null`, which is what the cross-cutting rule ("Record veto-pass
 * skips explicitly") actually demands; `runoff_submitted_at` then means the
 * stronger, more useful thing the reveal warning needs — this member is finished.
 */
export function maybeMarkSubmitted(input: {
	db: Db;
	round: Round;
	memberId: string;
	now: Date;
}): boolean {
	const progress = memberRunoffProgress({
		db: input.db,
		round: input.round,
		memberId: input.memberId
	});

	if (!progress.complete) {
		// Recompute rather than latch: a member with outstanding work must not stay
		// flagged "voted" just because they were finished at some earlier point.
		input.db
			.update(attendance)
			.set({ runoffSubmittedAt: null })
			.where(
				and(
					eq(attendance.roundId, input.round.id),
					eq(attendance.memberId, input.memberId),
					isNotNull(attendance.runoffSubmittedAt)
				)
			)
			.run();
		return false;
	}

	input.db
		.update(attendance)
		.set({ runoffSubmittedAt: input.now })
		.where(
			and(
				eq(attendance.roundId, input.round.id),
				eq(attendance.memberId, input.memberId),
				// Keep the first completion time rather than bumping it on every edit.
				isNull(attendance.runoffSubmittedAt)
			)
		)
		.run();
	return true;
}

/**
 * voting-spec: "Pre-fill each voter's veto with last round's target if that movie
 * is a finalist again. Without this, the person who genuinely cannot watch horror
 * re-vetoes every week; with it, that costs one tap."
 */
export function vetoPrefillFor(input: {
	db: Db;
	groupId: string;
	round: Round;
	memberId: string;
}): string | null {
	const finalistIds = input.round.finalistIds ?? [];
	if (finalistIds.length === 0) return null;

	// Abandoning a round "discards the round's vetoes and pair votes", so an
	// abandoned night must not pre-fill the next one.
	const previous = input.db
		.select({ id: rounds.id })
		.from(rounds)
		.where(
			and(
				eq(rounds.groupId, input.groupId),
				lt(rounds.createdAt, input.round.createdAt),
				ne(rounds.state, 'abandoned')
			)
		)
		.orderBy(desc(rounds.createdAt), desc(rounds.id))
		.limit(1)
		.get();
	if (!previous) return null;

	const lastVeto = input.db
		.select({ movieId: vetoes.movieId })
		.from(vetoes)
		.where(and(eq(vetoes.roundId, previous.id), eq(vetoes.memberId, input.memberId)))
		.get();
	const target = lastVeto?.movieId ?? null;
	return target !== null && finalistIds.includes(target) ? target : null;
}
