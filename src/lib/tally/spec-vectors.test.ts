/**
 * Adapter runner for the independent spec vectors in `/spec-tests/`.
 *
 * Those vectors were hand-derived from docs/voting-spec.md by an agent that never saw
 * this implementation. `spec-tests/` is READ-ONLY here: it is the audit trail.
 * When a vector and this code disagree, docs/voting-spec.md's text is the sole
 * authority, and the disagreement is recorded in one of the three tables at the
 * bottom of this file — never resolved by editing the vector.
 *
 * The one exception is a change to the spec itself. On 2026-08-01 the
 * `attendee_votes >= 3` eligibility floor was removed from docs/voting-spec.md
 * (coverage is now the whole vote-count test), so V004's expected outcome, and
 * the redundant `attendee_votes_below_minimum` reasons in V005/V008/V039, were
 * re-derived from the amended text. On 2026-08-04 stars and soft member removal
 * were added to the spec, which retired no rule and changed no existing vector's
 * expected values; four new vectors (V041-V044) pin the new text. On 2026-08-05
 * the spec gave stars a *runoff* rung as well, directly below approval, revoking
 * its own "Stars play no part in Phase 2" guarantee; no existing vector reaches
 * the cycle chain with a star to its name, so again no expected value moved, and
 * three new vectors (V045-V047) pin the new rung. Every edit is dated and
 * explained in spec-tests/README.md §0; every other vector is untouched.
 *
 * Mapping notes (adapter concerns only, no semantics invented):
 *   - `random_seed` is a *string* in the vectors and the seed→choice mapping is
 *     explicitly implementation-defined, so it is hashed to this project's
 *     uint32 seed domain with the same FNV-1a the tiebreak already uses.
 *   - `ineligible_movies` lists *every* failing reason; `MovieTally` reports the
 *     first. The full reason set is re-derived here from the tally's own numbers.
 *   - `not_voted` per pair is derived as attendees − (a + b + no_preference);
 *     the tally module has no need to store it.
 *   - An "explicit veto pass" in the vector format is an attendance row with
 *     `runoff_submitted_at` set and no `vetoes` row; that is synthesised into
 *     this API's `{ movieId: null }` veto so V025's distinction is exercised.
 *   - `members[].removed_at` is filtered out HERE, in the adapter, exactly as the
 *     server does it (`loadAttendeeIds` / `loadStandingVotes` / `loadFairness`).
 *     The tally module is pure and takes an attendee set; "who is still in the
 *     group" is the caller's question, and the spec defines removal as an effect
 *     on that set rather than as a new tally rule.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computePhase1 } from './phase1.js';
import { computeRunoff } from './runoff.js';
import { fnv1a32 } from './prng.js';
import type {
	FairnessInput,
	MemberId,
	MovieId,
	MovieInput,
	MovieStatus,
	PairVoteInput,
	Phase1Result,
	RunoffResult,
	StandingVoteInput,
	TallyConfig,
	VetoInput
} from './types.js';

/* ------------------------------------------------------------------ */
/* Vector format                                                       */
/* ------------------------------------------------------------------ */

interface Vector {
	id: string;
	description: string;
	input: {
		config: {
			N_FINALISTS: number;
			APPROVAL_FLOOR: number;
			COVERAGE_FLOOR: number;
			VETO_THRESHOLD: number;
			REWATCH_COOLDOWN: number | null;
			/**
			 * The retired eligibility floor. Still present in every vector file as
			 * the record of what they were derived against; read by nothing.
			 */
			MIN_ATTENDEE_VOTES?: number;
		};
		members: Array<{
			id: string;
			join_order: number;
			joined_at: string;
			/** Set = this member left the group; absent or null = still in it. */
			removed_at?: string | null;
			fairness: { last_win_at: string | null; wins_count: number };
		}>;
		attendance: Array<{ user_id: string; attending: boolean; runoff_submitted_at: string | null }>;
		movies: Array<{
			id: string;
			title: string;
			runtime_min: number | null;
			suggested_by: string;
			added_at: string;
			status: string;
			watched_at: string | null;
		}>;
		standing_votes: Array<{
			user_id: string;
			movie_id: string;
			value: 'yes' | 'no';
			/** An upgraded yes. Absent = a plain yes/no. */
			starred?: boolean;
		}>;
		vetoes: Array<{ user_id: string; movie_id: string | null }>;
		pair_votes: Array<{ user_id: string; movie_a_id: string; movie_b_id: string; winner_id: string | null }>;
		random_seed: string;
	};
	expected: {
		eligible_movie_ids: string[] | null;
		ineligible_movies: Array<{ movie_id: string; reason: string; coverage: number; attendee_votes: number }>;
		tallies: Record<
			string,
			{
				attendee_votes: number;
				yes_votes: number;
				coverage: number;
				approval: number;
				/** Only the post-2026-08-04 vectors carry this; asserted when present. */
				star_votes?: number;
			}
		>;
		finalist_ids: string[] | null;
		finalist_ids_ranked: string[] | null;
		rank_order_asserted: boolean;
		finalist_boundary_tiebreak: {
			rule: string;
			tied_movie_ids: string[];
			admitted?: string[];
			excluded?: string[];
			permissible_admitted?: string[][];
			permissible_finalist_sets?: string[][];
		} | null;
		veto_counts: Record<string, number>;
		veto_disqualified_ids: string[];
		vetoes_ignored_insufficient_finalists: boolean;
		surviving_finalist_ids: string[] | null;
		pairwise: Array<{
			a: string;
			b: string;
			a_preferred: number;
			b_preferred: number;
			no_preference: number;
			not_voted: number;
			pair_winner: string | null;
		}>;
		copeland_scores: Record<string, number>;
		outcome: 'winner' | 'winner_outright' | 'no_clear_favourite';
		phase2_skipped: boolean;
		winner_id: string | null;
		permissible_winner_ids: string[];
		decided_by: string | null;
		standing_vote_side_effects: Array<{ user_id: string; movie_id: string; value: string; was: string | null }>;
		pairwise_pairs_required?: number;
		veto_taps_max?: number;
		pair_taps_max?: number;
	};
}

const VECTOR_DIR = fileURLToPath(new URL('../../../spec-tests/vectors/', import.meta.url));

const vectors: Vector[] = readdirSync(VECTOR_DIR)
	.filter((name) => name.endsWith('.json'))
	.sort()
	.map((name) => JSON.parse(readFileSync(VECTOR_DIR + name, 'utf8')) as Vector);

/* ------------------------------------------------------------------ */
/* Adjudication registry                                              */
/* ------------------------------------------------------------------ */

/**
 * (b) Vector misreadings / internal inconsistencies. spec-tests/ is read-only,
 * so the affected *field* is not asserted here and the reason is named.
 * Everything else in those vectors is still asserted.
 */
const FIELD_NOT_ASSERTED: Record<string, { fields: string[]; why: string }> = {
	// V001/V002/V005/V006/V008/V011/V013/V036/V037 all expect
	// `surviving_finalist_ids: []` for an outright win, but V040 — whose entire
	// point is that Phase 2 is skipped — expects `["m1"]` for the same
	// situation. The two cannot both hold. docs/voting-spec.md says RUNOFF is
	// "skipped entirely", so "surviving finalists" is undefined for these
	// rounds; this runner asserts the field only when Phase 2 actually ran.
	SURVIVING_WHEN_PHASE2_SKIPPED: {
		fields: ['surviving_finalist_ids (winner_outright vectors only)'],
		why: 'vectors disagree with each other ([] in V001 et al. vs ["m1"] in V040) on a field the spec leaves undefined when Phase 2 is skipped'
	},
	// V022's expected side effect says u2's standing vote on m2 was "yes" before
	// the veto, but V022's own `standing_votes` input contains `u2/m2 = no`, and
	// its own asserted tally for m2 (3 attendee_votes, 2 yes) is only reachable
	// if u2 held "no". The (user, movie, value) triple is asserted; the `was`
	// snapshot for this one vector is not, because it contradicts the vector's
	// own input. docs/voting-spec.md says only "Vetoing sets the voter's standing vote
	// on that movie to 'no'" and says nothing about the prior value.
	SIDE_EFFECT_WAS_SUBFIELD: {
		fields: ['standing_vote_side_effects[].was (V022 only)'],
		why: 'V022 claims was="yes" for u2/m2 while its own standing_votes input records u2/m2=no'
	}
};

/**
 * (c) Genuine spec ambiguities blocking a vector assertion. Empty = none: all
 * 40 vectors are fully asserted.
 */
const PENDING_HUMAN_DECISION: Record<string, string> = {};

/**
 * Points on which docs/voting-spec.md has moved since the vectors were derived: two
 * readings the vectors could not distinguish (both settled in favour of the
 * behaviour already implemented here) and one rule the spec dropped outright.
 * Kept as a record of the reconciliation.
 */
const SETTLED_BY_SPEC_AMENDMENT = {
	/**
	 * Rotation-fairness rung when it cannot name a single winner.
	 *
	 * Amended spec: "Each rule *ranks and narrows* the tied set; whatever remains
	 * tied falls through to the next rule. A rule that separates nothing is
	 * skipped. In particular, at rule 4 a finalist whose suggester is not
	 * attending has the worst possible fairness claim and is eliminated by that
	 * rung (rather than the rung being skipped as indecisive)."
	 *
	 * → rank & narrow, i.e. `rotationFairnessKey` returning `+Infinity`
	 *   eliminates a no-claim finalist. Already implemented; no change needed.
	 *   (The spec called this rule 3 until the star rung pushed it down to 4; the
	 *   rung itself never moved relative to anything below it.)
	 */
	ROTATION_FAIRNESS_NARROWING: 'settled: rank & narrow — +Infinity eliminates no-claim finalists at rotation fairness',

	/**
	 * Whether the veto's standing-vote flip feeds back into its own round.
	 *
	 * Amended spec: "This flip is forward-looking only: the round's tallies are
	 * computed from a snapshot of standing votes taken when finalists were
	 * computed, so a veto can never mutate the tallies of the round it was cast
	 * in."
	 *
	 * → FREEZE. `computeRunoff` was already agnostic about where its
	 *   `standingVotes` come from; the server now persists the snapshot on the
	 *   round (`rounds.standing_snapshot`) and passes that, never live rows.
	 *   Enforced by the stage-2 integration test "a veto flip does not change the
	 *   frozen tallies of its own round".
	 */
	VETO_FLIP_FEEDBACK: 'settled: freeze — computeRunoff is fed rounds.standing_snapshot',

	/**
	 * The `attendee_votes >= 3` eligibility floor.
	 *
	 * Amended spec (2026-08-01): eligibility is `status = pool` and
	 * `coverage >= COVERAGE_FLOOR`, full stop. The absolute floor locked small
	 * groups out — a three-person night with one abstention could never make
	 * anything eligible — while coverage already does the job as a share.
	 *
	 * → REMOVED, and unlike the two above this one changed an answer: V004's
	 *   movie (coverage 2/3, two votes) is now eligible and wins outright. See
	 *   spec-tests/README.md §0.
	 */
	MIN_ATTENDEE_VOTES_REMOVED: 'removed: coverage is the whole vote-count test; V004 re-derived',

	/**
	 * Stars, and soft member removal (2026-08-04).
	 *
	 * Amended spec, as it read that day: a star is "an UPGRADED yes", unlimited,
	 * and "the highest-priority tie-breaker after the approval count when selecting
	 * finalists in Phase 1. Nothing else." (The "nothing else" half was revoked the
	 * next day — see `STARS_IN_THE_RUNOFF` below.) And: "Removed members leave the present,
	 * not the past" — a removed member is not in any attendee set, so nothing they
	 * recorded reaches a tally computed after their removal, while history keeps
	 * naming them.
	 *
	 * → ADDED, and neither rule changed an existing answer: every pre-2026-08-04
	 *   vector has zero stars and no removed members, so the star rung separates
	 *   nothing there and is skipped, and the attendee filter is a no-op. V041-V044
	 *   pin the new text. See spec-tests/README.md §0.
	 */
	STARS_AND_MEMBER_REMOVAL: 'added: star rung below yes-votes in Phase 1 only; removal empties the attendee set',

	/**
	 * Stars in the runoff (2026-08-05) — the one amendment that *revoked* a
	 * guarantee rather than adding to one.
	 *
	 * The spec used to promise "Stars play no role ... in the runoff's cycle
	 * tiebreak chain". It now reads: "3. Stars — more `star_votes` among attendees
	 * wins. Below approval and not above it: a star may separate finalists that
	 * both the pairwise vote and standing approval have tied, and never promotes a
	 * film past a better-approved one." So the cycle chain is
	 * `copeland → approval → stars → rotation fairness → shortest runtime →
	 * seeded random`, and rules 4-6 keep the numbering the boundary chain gives
	 * them.
	 *
	 * → ADDED, and it changed no existing answer either: every vector that reaches
	 *   the cycle chain has zero stars on every finalist, so the new rung compares
	 *   0 with 0 and is skipped. V045-V047 pin the rung, its position below
	 *   approval, and its attendee scope. See spec-tests/README.md §0.
	 */
	STARS_IN_THE_RUNOFF: 'added: star rung directly below approval in Phase 2; the old "no part in Phase 2" guarantee is revoked'
} as const;

/* ------------------------------------------------------------------ */
/* Adapter                                                            */
/* ------------------------------------------------------------------ */

/**
 * `attendee_votes_below_minimum` is deliberately absent: the floor it names is
 * gone from the spec, so a vector still claiming it fails the "unknown reason
 * enum" assertion below rather than being quietly accepted.
 */
const REASON_MAP = {
	status_not_pool: 'not_in_pool',
	coverage_below_floor: 'coverage_floor'
} as const;

function ms(iso: string | null): number | null {
	return iso === null ? null : Date.parse(iso);
}

function toConfig(v: Vector): TallyConfig {
	return {
		nFinalists: v.input.config.N_FINALISTS,
		approvalFloor: v.input.config.APPROVAL_FLOOR,
		coverageFloor: v.input.config.COVERAGE_FLOOR,
		vetoThreshold: v.input.config.VETO_THRESHOLD
	};
}

/**
 * Members who left the group. Their rows survive — history refers to them — but
 * they are not part of the group's present, so nothing they ever recorded may
 * reach a tally computed now (voting-spec: "Removed members leave the present,
 * not the past").
 */
function removedIds(v: Vector): Set<MemberId> {
	return new Set(
		v.input.members.filter((m) => m.removed_at !== undefined && m.removed_at !== null).map((m) => m.id)
	);
}

/**
 * The attendee set: `attending = true` AND still in the group. A removed member's
 * RSVP is inert even when it was cast before they were removed — the mid-round
 * edge the removal rule names explicitly.
 */
function toAttendeeIds(v: Vector): MemberId[] {
	const removed = removedIds(v);
	return v.input.attendance
		.filter((row) => row.attending && !removed.has(row.user_id))
		.map((row) => row.user_id);
}

function toMovies(v: Vector): MovieInput[] {
	return v.input.movies.map((m) => ({
		id: m.id,
		runtimeMin: m.runtime_min,
		suggestedBy: m.suggested_by,
		status: m.status as MovieStatus
	}));
}

function toStandingVotes(v: Vector): StandingVoteInput[] {
	const removed = removedIds(v);
	return v.input.standing_votes
		.filter((s) => !removed.has(s.user_id))
		.map((s) => ({
			memberId: s.user_id,
			movieId: s.movie_id,
			value: s.value,
			starred: s.starred === true
		}));
}

function toFairness(v: Vector): FairnessInput[] {
	const removed = removedIds(v);
	return v.input.members
		.filter((m) => !removed.has(m.id))
		.map((m) => ({
			memberId: m.id,
			joinedAt: Date.parse(m.joined_at),
			lastWinAt: ms(m.fairness.last_win_at),
			winsCount: m.fairness.wins_count
		}));
}

/**
 * Veto rows, plus a synthesised explicit pass for every attendee who submitted
 * their runoff (`runoff_submitted_at` set) without a veto row — the vector
 * format's way of recording "done, vetoed nothing".
 */
function toVetoes(v: Vector): VetoInput[] {
	const removed = removedIds(v);
	const withRow = new Set(v.input.vetoes.map((x) => x.user_id));
	const explicit: VetoInput[] = v.input.vetoes
		.filter((x) => !removed.has(x.user_id))
		.map((x) => ({ memberId: x.user_id, movieId: x.movie_id }));
	const passes: VetoInput[] = v.input.attendance
		.filter(
			(row) => row.attending && row.runoff_submitted_at !== null && !withRow.has(row.user_id) && !removed.has(row.user_id)
		)
		.map((row) => ({ memberId: row.user_id, movieId: null }));
	return [...explicit, ...passes];
}

function toPairVotes(v: Vector): PairVoteInput[] {
	const removed = removedIds(v);
	return v.input.pair_votes
		.filter((p) => !removed.has(p.user_id))
		.map((p) => ({
			memberId: p.user_id,
			movieAId: p.movie_a_id,
			movieBId: p.movie_b_id,
			winnerId: p.winner_id
		}));
}

/** The vectors' seeds are opaque strings; the mapping to a uint32 is ours. */
function toSeed(v: Vector): number {
	return fnv1a32(v.input.random_seed);
}

interface RoundOutcome {
	phase1: Phase1Result;
	runoff: RunoffResult | null;
	outcome: 'winner' | 'winner_outright' | 'no_clear_favourite';
	phase2Skipped: boolean;
	winnerId: MovieId | null;
	decidedBy: string | null;
}

/** `decide_round(...)` from the vectors' README, composed from this API. */
function decideRound(v: Vector, seedOverride?: number): RoundOutcome {
	const config = toConfig(v);
	const attendeeIds = toAttendeeIds(v);
	const movies = toMovies(v);
	const standingVotes = toStandingVotes(v);
	const fairness = toFairness(v);
	const seed = seedOverride ?? toSeed(v);

	const phase1 = computePhase1({ attendeeIds, movies, standingVotes, config, fairness, seed });

	if (phase1.outcome === 'no_clear_favourite') {
		return {
			phase1,
			runoff: null,
			outcome: 'no_clear_favourite',
			phase2Skipped: false,
			winnerId: null,
			decidedBy: null
		};
	}

	if (phase1.outcome === 'outright_winner') {
		// "RUNOFF ... skipped entirely when only one movie clears the approval
		// floor" — so no veto tally and no round robin is computed at all.
		return {
			phase1,
			runoff: null,
			outcome: 'winner_outright',
			phase2Skipped: true,
			winnerId: phase1.outrightWinnerId,
			decidedBy: 'single_clear_approval_floor'
		};
	}

	const runoff = computeRunoff({
		finalistIds: phase1.finalistIds,
		attendeeIds,
		movies,
		standingVotes,
		vetoes: toVetoes(v),
		pairVotes: toPairVotes(v),
		config,
		fairness,
		seed
	});

	return {
		phase1,
		runoff,
		outcome: 'winner',
		phase2Skipped: false,
		winnerId: runoff.winnerId,
		decidedBy: runoff.tiebreak === null ? 'condorcet' : runoff.tiebreak.rule
	};
}

/** Re-derives the *complete* set of eligibility failures the vectors enumerate. */
function failedReasons(v: Vector, movieId: MovieId): string[] {
	const config = toConfig(v);
	const attendees = toAttendeeIds(v).length;
	const tally = decideRound(v).phase1.tallies.find((t) => t.movieId === movieId)!;
	const movie = v.input.movies.find((m) => m.id === movieId)!;
	const reasons: string[] = [];
	if (movie.status !== 'pool') reasons.push('not_in_pool');
	if (!(tally.attendeeVotes + 1e-9 >= config.coverageFloor * attendees) || attendees === 0) {
		reasons.push('coverage_floor');
	}
	return reasons;
}

const sorted = (ids: readonly string[]) => [...ids].sort();

/* ------------------------------------------------------------------ */
/* The suite                                                          */
/* ------------------------------------------------------------------ */

describe('spec vectors (independently derived from docs/voting-spec.md)', () => {
	it('found all 47 vector files', () => {
		expect(vectors.length).toBe(47);
		expect(vectors.map((v) => v.id)).toEqual(
			Array.from({ length: 47 }, (_, i) => `V${String(i + 1).padStart(3, '0')}`)
		);
	});

	for (const v of vectors) {
		const pending = PENDING_HUMAN_DECISION[v.id];
		const runner = pending ? it.skip : it;

		runner(`${v.id} — ${v.description}`, () => {
			const got = decideRound(v);
			const want = v.expected;

			/* --- load-bearing: outcome --------------------------------- */
			expect(got.outcome, 'outcome').toBe(want.outcome);
			expect(got.phase2Skipped, 'phase2_skipped').toBe(want.phase2_skipped);
			expect(got.decidedBy, 'decided_by').toBe(want.decided_by);

			// `winner_id: null` + a multi-entry `permissible_winner_ids` is the
			// vectors' convention for a seeded-random result: assert the rule
			// reached and the permissible set, never a specific id.
			if (want.winner_id !== null) {
				expect(got.winnerId, 'winner_id').toBe(want.winner_id);
			} else if (want.permissible_winner_ids.length > 0) {
				expect(want.permissible_winner_ids, 'winner within permissible set').toContain(got.winnerId);
			} else {
				expect(got.winnerId, 'winner_id (no winner)').toBeNull();
			}
			if (got.winnerId !== null) {
				expect(want.permissible_winner_ids, 'permissible_winner_ids').toContain(got.winnerId);
			}

			/* --- load-bearing: eligibility ----------------------------- */
			const eligible = got.phase1.eligible.map((t) => t.movieId);
			expect(sorted(eligible), 'eligible_movie_ids').toEqual(want.eligible_movie_ids);

			for (const expectedReason of want.ineligible_movies) {
				const mapped = REASON_MAP[expectedReason.reason as keyof typeof REASON_MAP];
				expect(mapped, `unknown reason enum ${expectedReason.reason}`).toBeDefined();
				expect(failedReasons(v, expectedReason.movie_id), `${expectedReason.movie_id} reasons`).toContain(mapped);
				expect(eligible, 'ineligible movie must not be eligible').not.toContain(expectedReason.movie_id);
			}

			/* --- diagnostics: tallies ---------------------------------- */
			for (const [movieId, want2] of Object.entries(want.tallies)) {
				const tally = got.phase1.tallies.find((t) => t.movieId === movieId);
				expect(tally, `tally for ${movieId}`).toBeDefined();
				expect(tally!.attendeeVotes, `${movieId}.attendee_votes`).toBe(want2.attendee_votes);
				expect(tally!.yesVotes, `${movieId}.yes_votes`).toBe(want2.yes_votes);
				expect(tally!.coverage, `${movieId}.coverage`).toBeCloseTo(want2.coverage, 4);
				expect(tally!.approval, `${movieId}.approval`).toBeCloseTo(want2.approval, 4);
				if (want2.star_votes !== undefined) {
					expect(tally!.starVotes, `${movieId}.star_votes`).toBe(want2.star_votes);
				}
			}

			/* --- load-bearing: finalists ------------------------------- */
			// `null` means "not asserted" (V017: a seeded-random boundary tie
			// makes the finalist set implementation-defined).
			if (want.finalist_ids !== null) {
				expect(sorted(got.phase1.finalistIds), 'finalist_ids').toEqual(want.finalist_ids);
			}
			if (want.rank_order_asserted && want.finalist_ids_ranked !== null) {
				expect(got.phase1.finalistIds, 'finalist_ids_ranked').toEqual(want.finalist_ids_ranked);
			}

			/* --- boundary tiebreak ------------------------------------- */
			if (want.finalist_boundary_tiebreak === null) {
				expect(got.phase1.boundaryTiebreak, 'finalist_boundary_tiebreak').toBeNull();
			} else {
				const bt = got.phase1.boundaryTiebreak;
				expect(bt, 'finalist_boundary_tiebreak').not.toBeNull();
				expect(bt!.rule, 'boundary rule').toBe(want.finalist_boundary_tiebreak.rule);
				// `contested` is the set still tied when the deciding rung fired;
				// it must be a subset of the vector's yes-vote tie set.
				for (const id of bt!.contested) {
					expect(want.finalist_boundary_tiebreak.tied_movie_ids, 'contested ⊆ tied_movie_ids').toContain(id);
				}
				if (want.finalist_boundary_tiebreak.admitted) {
					for (const id of want.finalist_boundary_tiebreak.admitted) {
						expect(got.phase1.finalistIds, 'admitted').toContain(id);
					}
				}
				for (const id of want.finalist_boundary_tiebreak.excluded ?? []) {
					expect(got.phase1.finalistIds, 'excluded').not.toContain(id);
				}
				if (want.finalist_boundary_tiebreak.permissible_finalist_sets) {
					expect(
						want.finalist_boundary_tiebreak.permissible_finalist_sets.map((s) => sorted(s).join()),
						'finalist set within permissible sets'
					).toContain(sorted(got.phase1.finalistIds).join());
				}
			}

			/* --- veto -------------------------------------------------- */
			expect(got.runoff?.veto.disqualifiedIds ?? [], 'veto_disqualified_ids').toEqual(
				want.veto_disqualified_ids
			);
			expect(
				got.runoff?.veto.vetoesIgnored ?? false,
				'vetoes_ignored_insufficient_finalists'
			).toBe(want.vetoes_ignored_insufficient_finalists);

			if (got.runoff === null) {
				// An empty expected `veto_counts` asserts that no veto tally is
				// computed at all, because RUNOFF never happened — either it was
				// skipped for an outright winner, or the round ended with no
				// clear favourite.
				expect(want.veto_counts, 'veto_counts must be empty when there is no runoff').toEqual({});
			} else if (want.finalist_ids !== null && Object.keys(want.veto_counts).length > 0) {
				expect(got.runoff.veto.counts, 'veto_counts').toEqual(want.veto_counts);
			}

			if (got.runoff !== null) {
				if (want.surviving_finalist_ids !== null) {
					expect(sorted(got.runoff.veto.survivingIds), 'surviving_finalist_ids').toEqual(
						want.surviving_finalist_ids
					);
				}
			} else if (want.outcome === 'no_clear_favourite') {
				// Unambiguous across every no-clear-favourite vector: nothing survives.
				expect(want.surviving_finalist_ids, 'surviving_finalist_ids').toEqual([]);
			}
			// For `winner_outright` the field is withheld — see
			// FIELD_NOT_ASSERTED.SURVIVING_WHEN_PHASE2_SKIPPED.

			/* --- standing-vote side effects ---------------------------- */
			// Forward-looking writes owed by the veto step; they must not have
			// changed this round's tallies (already asserted above).
			const standingBefore = new Map(
				v.input.standing_votes.map((s) => [`${s.user_id} ${s.movie_id}`, s.value])
			);
			const gotSideEffects = (got.runoff?.veto.effectiveVetoes ?? []).map((e) => ({
				user_id: e.memberId,
				movie_id: e.movieId,
				value: 'no' as const
			}));
			const key = (s: { user_id: string; movie_id: string; value: string }) =>
				`${s.user_id}/${s.movie_id}=${s.value}`;
			expect(gotSideEffects.map(key).sort(), 'standing_vote_side_effects').toEqual(
				want.standing_vote_side_effects.map(key).sort()
			);

			// The `was` sub-field is cross-checked against the vector's own
			// `standing_votes` input rather than asserted against this code,
			// which never produces it — see
			// FIELD_NOT_ASSERTED.SIDE_EFFECT_WAS_SUBFIELD for the one vector
			// whose `was` contradicts its own input.
			for (const effect of want.standing_vote_side_effects) {
				const actualBefore = standingBefore.get(`${effect.user_id} ${effect.movie_id}`) ?? null;
				if (v.id !== 'V022') {
					expect(effect.was, `${v.id} ${effect.user_id}/${effect.movie_id}.was`).toBe(actualBefore);
				}
			}

			/* --- pairwise + copeland ----------------------------------- */
			if (got.runoff === null) {
				expect(want.pairwise, 'pairwise must be empty when there is no runoff').toEqual([]);
				expect(want.copeland_scores, 'copeland_scores must be empty when there is no runoff').toEqual({});
			} else if (want.finalist_ids !== null && want.pairwise.length > 0) {
				const attendees = toAttendeeIds(v).length;
				const gotPairs = got.runoff.matrix.map((h) => ({
					a: h.a,
					b: h.b,
					a_preferred: h.aWins,
					b_preferred: h.bWins,
					no_preference: h.noPreference,
					not_voted: attendees - h.aWins - h.bWins - h.noPreference,
					pair_winner: h.winner
				}));
				const byPair = (rows: typeof gotPairs) => [...rows].sort((x, y) => `${x.a}|${x.b}`.localeCompare(`${y.a}|${y.b}`));
				expect(byPair(gotPairs), 'pairwise').toEqual(byPair(want.pairwise as typeof gotPairs));
				expect(got.runoff.copeland, 'copeland_scores').toEqual(want.copeland_scores);
			}

			/* --- effort budget (V039 only) ----------------------------- */
			if (want.pairwise_pairs_required !== undefined) {
				expect(got.runoff!.matrix.length, 'pairwise_pairs_required').toBe(want.pairwise_pairs_required);
				expect(got.runoff!.matrix.length, 'pair_taps_max').toBeLessThanOrEqual(want.pair_taps_max!);
			}
		});
	}

	/* --- reproducibility of the seeded rungs ----------------------- */

	it('V017 — a seeded-random finalist boundary is reproducible from the stored seed', () => {
		const v = vectors.find((x) => x.id === 'V017')!;
		const a = decideRound(v).phase1.finalistIds;
		const b = decideRound(v).phase1.finalistIds;
		expect(a).toEqual(b);
		// ...and both permissible sets are actually reachable across seeds.
		const reached = new Set(
			Array.from({ length: 80 }, (_, s) => sorted(decideRound(v, s).phase1.finalistIds).join())
		);
		expect(reached).toEqual(new Set(['m1,m2', 'm1,m3']));
	});

	it('V034 — a seeded-random winner is reproducible from the stored seed', () => {
		const v = vectors.find((x) => x.id === 'V034')!;
		expect(decideRound(v).winnerId).toBe(decideRound(v).winnerId);
		const reached = new Set(Array.from({ length: 80 }, (_, s) => decideRound(v, s).winnerId));
		expect(reached).toEqual(new Set(['m1', 'm2']));
	});

	it('V025 — an explicit veto pass is recorded and counts as no veto', () => {
		const v = vectors.find((x) => x.id === 'V025')!;
		const got = decideRound(v);
		// u1 and u2 submitted with no veto row; u3 never opened the app.
		expect(got.runoff!.veto.passes).toEqual(['u1', 'u2']);
		expect(got.runoff!.veto.disqualifiedIds).toEqual([]);
	});

	it('records the adjudication registry, so it shows up in test output', () => {
		// (b) fields withheld because a vector contradicts the spec or itself.
		expect(Object.keys(FIELD_NOT_ASSERTED)).toEqual([
			'SURVIVING_WHEN_PHASE2_SKIPPED',
			'SIDE_EFFECT_WAS_SUBFIELD'
		]);
		// (c) vectors skipped pending a human decision: none.
		expect(Object.keys(PENDING_HUMAN_DECISION)).toEqual([]);
		// (c) ambiguities no vector distinguished, now settled in docs/voting-spec.md
		// in favour of the behaviour already implemented.
		expect(Object.keys(SETTLED_BY_SPEC_AMENDMENT)).toEqual([
			'ROTATION_FAIRNESS_NARROWING',
			'VETO_FLIP_FEEDBACK',
			'MIN_ATTENDEE_VOTES_REMOVED',
			'STARS_AND_MEMBER_REMOVAL',
			'STARS_IN_THE_RUNOFF'
		]);
	});
});
