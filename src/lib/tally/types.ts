/**
 * Plain-data inputs and outputs for the tally module.
 *
 * PURITY CONTRACT: nothing under `src/lib/tally/` may import from the database
 * layer, from SvelteKit (`$app/*`, `$env/*`), or from `$lib/server/*`. Every
 * function here takes plain data and returns plain data so the whole voting
 * mechanism is testable in isolation (app-spec: "Testing priority: the tally
 * module ... as pure functions with table-driven tests").
 */

export type MemberId = string;
export type MovieId = string;
export type RoundId = string;

/** voting-spec lifecycle: only `pool` movies are eligible. */
export type MovieStatus = 'pool' | 'watched' | 'removed';

/** voting-spec: absence of a row is a third state ("not yet seen"), never a "no". */
export type StandingVoteValue = 'yes' | 'no';

/**
 * The four voting knobs the tally needs.
 *
 * `rewatch_cooldown` (the fifth group knob) is deliberately absent: it governs
 * whether a *watched* movie may be re-suggested into the pool, which happens
 * before any tally runs.
 */
export interface TallyConfig {
	/** N_FINALISTS (default 5) */
	nFinalists: number;
	/** APPROVAL_FLOOR (default 0.5) */
	approvalFloor: number;
	/** COVERAGE_FLOOR (default 0.6) */
	coverageFloor: number;
	/** VETO_THRESHOLD (default 1) */
	vetoThreshold: number;
}

export const DEFAULT_TALLY_CONFIG: TallyConfig = {
	nFinalists: 5,
	approvalFloor: 0.5,
	coverageFloor: 0.6,
	vetoThreshold: 1
};

export interface MovieInput {
	id: MovieId;
	/** `null` when TMDB had no runtime; ranks last on tiebreak rule 4. */
	runtimeMin: number | null;
	/** Feeds rotation fairness (tiebreak rule 3). */
	suggestedBy: MemberId;
	/** Defaults to `pool` when omitted. */
	status?: MovieStatus;
}

export interface StandingVoteInput {
	memberId: MemberId;
	movieId: MovieId;
	value: StandingVoteValue;
	/**
	 * An UPGRADED yes (voting-spec, Phase 1 → Stars). Omitted or `false` is a
	 * plain yes; `true` alongside `value: 'no'` is not a representable position and
	 * is read as an unstarred "no" rather than trusted — the database rejects such
	 * a row outright, so it can only arrive from a hand-built caller.
	 */
	starred?: boolean;
}

/**
 * One record per member of the group.
 *
 * voting-spec rule 3: "Measure members who have never won from their join
 * date, not as infinitely overdue" — hence `joinedAt` is required and
 * `lastWinAt` is nullable. `lastWinAt` is stamped when a round reaches
 * WATCHED, never when it is merely DECIDED.
 *
 * A member with no record at all is treated as having no fairness claim
 * (ranked last on rule 3); callers should supply a record for every member.
 */
export interface FairnessInput {
	memberId: MemberId;
	/** Epoch ms of Member.created_at. */
	joinedAt: number;
	/** Epoch ms of the last winning suggestion, or `null` if never won. */
	lastWinAt: number | null;
	/** Optional, carried through for auditing only. */
	lastWinRoundId?: RoundId | null;
	/** Optional, carried through for auditing only. */
	winsCount?: number;
}

/** `movieId: null` is an explicit "done, vetoed nothing" (voting-spec cross-cutting rules). */
export interface VetoInput {
	memberId: MemberId;
	movieId: MovieId | null;
}

/** `winnerId: null` is an explicit "no preference", not a missing vote. */
export interface PairVoteInput {
	memberId: MemberId;
	movieAId: MovieId;
	movieBId: MovieId;
	winnerId: MovieId | null;
}

/* ------------------------------------------------------------------ */
/* Tiebreaks                                                           */
/* ------------------------------------------------------------------ */

/**
 * The shared tail of the tiebreak chain, reused at the finalist boundary and
 * inside the runoff cycle resolution (voting-spec: "Reuse the runoff's chain").
 */
export type SharedTiebreakRule =
	| 'approval'
	| 'rotation_fairness'
	| 'shortest_runtime'
	| 'seeded_random';

/**
 * Phase 1's chain: the shared tail, preceded by stars.
 *
 * voting-spec, Stars: "A star is the highest-priority tie-breaker after the
 * approval count when selecting finalists in Phase 1. Nothing else." `stars` is
 * therefore in this union and deliberately NOT in `CycleTiebreakRule` — the type
 * is what stops a star from ever deciding a runoff.
 */
export type BoundaryTiebreakRule = 'stars' | SharedTiebreakRule;

/** The runoff's full chain: Copeland first, then the shared tail. No stars. */
export type CycleTiebreakRule = 'copeland' | SharedTiebreakRule;

export interface TiebreakOutcome<R extends string> {
	/** Which rule separated the top two contenders. */
	rule: R;
	/** The contenders that were still tied when that rule was applied. */
	contested: MovieId[];
}

/* ------------------------------------------------------------------ */
/* Phase 1                                                             */
/* ------------------------------------------------------------------ */

export type IneligibleReason = 'not_in_pool' | 'coverage_floor';

export interface MovieTally {
	movieId: MovieId;
	/** Attendees with any standing vote on this movie. */
	attendeeVotes: number;
	/** Attendee standing votes with value `yes`. */
	yesVotes: number;
	/** Attendee standing votes with value `no`. */
	noVotes: number;
	/**
	 * Attendee standing votes that are a STARRED yes — a subset of `yesVotes`.
	 *
	 * Tiebreak only: it never enters `coverage`, `approval`, eligibility or the
	 * approval floor, and it is not consulted anywhere in Phase 2.
	 */
	starVotes: number;
	/** attendeeVotes / attendees (0 when there are no attendees). */
	coverage: number;
	/** yesVotes / attendeeVotes — divides by voters who saw the card (0 when none did). */
	approval: number;
	eligible: boolean;
	/** First failed eligibility condition, or `null` when eligible. */
	ineligibleReason: IneligibleReason | null;
	/** approval >= APPROVAL_FLOOR (only meaningful together with `eligible`). */
	clearsApprovalFloor: boolean;
}

export type Phase1Outcome = 'runoff' | 'outright_winner' | 'no_clear_favourite';

export interface Phase1Result {
	attendeeCount: number;
	/** One entry per input movie, in input order. */
	tallies: MovieTally[];
	/** Eligible movies only, ranked by the finalist comparator. */
	eligible: MovieTally[];
	/** Eligible AND clearing the approval floor, ranked by the finalist comparator. */
	candidates: MovieTally[];
	/** The promoted finalists, best first. Empty for `no_clear_favourite`. */
	finalistIds: MovieId[];
	outcome: Phase1Outcome;
	/** Set only when `outcome === 'outright_winner'`. */
	outrightWinnerId: MovieId | null;
	/** Set only when the Nth/N+1th places were tied on yes-votes. */
	boundaryTiebreak: TiebreakOutcome<BoundaryTiebreakRule> | null;
}

/* ------------------------------------------------------------------ */
/* Phase 2                                                             */
/* ------------------------------------------------------------------ */

export interface VetoResult {
	/** Veto count per finalist, from attendees only. Every finalist has a key. */
	counts: Record<MovieId, number>;
	/** Attendees who submitted an explicit "no veto". */
	passes: MemberId[];
	/**
	 * The vetoes that actually count: cast by an attendee, on a finalist.
	 *
	 * voting-spec: "Vetoing sets the voter's standing vote on that movie to
	 * 'no', so the two layers can never contradict each other." This is the
	 * exact set of standing-vote upserts the write path owes, and it is emitted
	 * even when the vetoes are ignored for *ranking* (the exception below
	 * suppresses disqualification, not the voter's stated position). The flip is
	 * forward-looking: it must not retroactively alter this round's tallies.
	 */
	effectiveVetoes: Array<{ memberId: MemberId; movieId: MovieId }>;
	/** Finalists with counts >= VETO_THRESHOLD — reported even when ignored. */
	disqualifiedIds: MovieId[];
	/** Finalists that go to the round robin, in finalist order. */
	survivingIds: MovieId[];
	/**
	 * voting-spec exception: "if vetoes leave fewer than two finalists, ignore
	 * them for ranking but surface them prominently in the UI".
	 */
	vetoesIgnored: boolean;
}

export interface HeadToHead {
	/** Normalised so that `a < b` lexicographically. */
	a: MovieId;
	b: MovieId;
	aWins: number;
	bWins: number;
	noPreference: number;
	/** The pairwise victor, or `null` for a dead heat. */
	winner: MovieId | null;
}

export interface Matchup {
	a: MovieId;
	b: MovieId;
}

export interface CondorcetResult {
	/** All unordered pairs, deterministically ordered. */
	matrix: HeadToHead[];
	/** Pairwise victories per movie (ties score 0 for both). */
	copeland: Record<MovieId, number>;
	/** The movie that beats every other survivor, or `null` if none does. */
	condorcetWinnerId: MovieId | null;
}

export interface RunoffResult {
	/** Approval/coverage tallies recomputed against the *current* attendee set. */
	tallies: MovieTally[];
	veto: VetoResult;
	matrix: HeadToHead[];
	copeland: Record<MovieId, number>;
	condorcetWinnerId: MovieId | null;
	/** `null` only when there were no finalists to rank at all. */
	winnerId: MovieId | null;
	/** `null` when a Condorcet winner decided it outright. */
	tiebreak: TiebreakOutcome<CycleTiebreakRule> | null;
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface Phase1Input {
	/** Members marked `attending = true` on the round. Duplicates are ignored. */
	attendeeIds: MemberId[];
	movies: MovieInput[];
	standingVotes: StandingVoteInput[];
	config: TallyConfig;
	fairness: FairnessInput[];
	/** Round.random_seed — makes every random tiebreak reproducible. */
	seed: number;
}

export interface RunoffInput {
	/**
	 * Round.finalist_ids, computed once at OPEN → RUNOFF and never recomputed
	 * (app-spec: attendance changes afterwards do not change the finalist set).
	 */
	finalistIds: MovieId[];
	/** The *current* attendee set — tallies always compute on read. */
	attendeeIds: MemberId[];
	movies: MovieInput[];
	standingVotes: StandingVoteInput[];
	vetoes: VetoInput[];
	pairVotes: PairVoteInput[];
	config: TallyConfig;
	fairness: FairnessInput[];
	seed: number;
}
