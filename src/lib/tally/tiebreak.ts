/**
 * The deterministic tiebreak chain, shared by the finalist boundary and the
 * runoff cycle resolution.
 *
 * voting-spec, Phase 1: "Ties at the finalist boundary ... must be broken
 * deterministically, never by insertion order", by the key
 * `yes_votes → star_votes → approval → rotation fairness → shortest runtime →
 * seeded random`.
 *
 * voting-spec, Phase 2: "1. Copeland score — most pairwise victories wins.
 * 2. Approval — the higher-approved finalist wins (the `approval` fraction, not
 * the raw yes count). 3. Stars — more `star_votes` among attendees wins.
 * 4. Rotation fairness. 5. Shortest runtime. 6. Seeded random."
 *
 * So both chains are assembled from the same five tie-breakers and differ only
 * in where the star sits: above approval at the boundary, below it in the
 * runoff. Stars USED to be a boundary rung and nothing else ("Stars play no part
 * in Phase 2"); the amended spec gives them the runoff rung directly below
 * approval, on the reasoning that the cycle chain already falls back to standing
 * signals the moment the live vote ties — `approval` is one — so a star is not a
 * new kind of input there, only a finer-grained one, and it is reached only once
 * both the pairwise vote and approval have refused to decide. The product rule
 * both chains keep: stars are seasoning, not votes. Every rung above them is a
 * yes-signal, so they separate films that signal has already tied and never
 * promote one past it — past more yes-votes at the boundary, past a better
 * approval in the runoff.
 *
 * Approval being the fraction rather than the yes-count was ambiguous in the
 * original spec text and has since been made explicit there; the independent
 * spec vectors pin it as V029.
 *
 * The spec also now settles how the rungs compose: "Each rule *ranks and
 * narrows* the tied set; whatever remains tied falls through to the next rule.
 * A rule that separates nothing is skipped." A lexicographic sort over the whole
 * chain implements exactly that, and `describeDecision` reports the last rule
 * that actually separated the winner from the runner-up.
 */

import { seededKey } from './prng.js';
import type {
	BoundaryTiebreakRule,
	CycleTiebreakRule,
	FairnessInput,
	MemberId,
	MovieId,
	MovieInput,
	SharedTiebreakRule,
	TiebreakOutcome
} from './types.js';

/** Everything the chain can compare, precomputed once per movie. */
export interface RankRow {
	movieId: MovieId;
	/** Attendee yes-votes: the Phase 1 ranking key. */
	yesVotes: number;
	/** Attendee starred yes-votes: boundary rung 1, and runoff rule 3. */
	starVotes: number;
	/** Attendee approval ratio: runoff rule 2, boundary rung 2. */
	approval: number;
	/** Pairwise victories: runoff rule 1 (0 outside the runoff). */
	copeland: number;
	/** Rotation fairness: epoch ms since which the suggester has been waiting; lower wins. */
	fairnessKey: number;
	/** Runtime in minutes; lower wins; +Infinity when unknown. */
	runtimeKey: number;
	/** Seeded pseudo-random key in [0, 1); lower wins. */
	randomKey: number;
}

type Direction = 'asc' | 'desc';

interface ChainStep<R extends string> {
	/** `null` for the primary ranking key, which is not itself a tiebreak. */
	rule: R | null;
	field: keyof RankRow;
	dir: Direction;
}

/*
 * The five shared steps, as named parts rather than one array: `approval` and
 * `stars` swap places between the two chains, so only the bottom three are a
 * contiguous run either chain can splice in whole.
 *
 * They are typed at `SharedTiebreakRule`, which every chain's rule union
 * contains, so both chains below compose them without a cast.
 */
const STARS: ChainStep<SharedTiebreakRule> = { rule: 'stars', field: 'starVotes', dir: 'desc' };
const APPROVAL: ChainStep<SharedTiebreakRule> = { rule: 'approval', field: 'approval', dir: 'desc' };
const TAIL: ChainStep<SharedTiebreakRule>[] = [
	{ rule: 'rotation_fairness', field: 'fairnessKey', dir: 'asc' },
	{ rule: 'shortest_runtime', field: 'runtimeKey', dir: 'asc' },
	{ rule: 'seeded_random', field: 'randomKey', dir: 'asc' }
];

/**
 * Phase 1: rank by attendee yes-votes, then STARS, then approval, then the tail.
 *
 * voting-spec, Selecting finalists:
 *   1. yes_votes  among attendees, descending   -- the primary ranking key
 *   2. star_votes among attendees, descending
 *   3. approval / 4. rotation fairness / 5. shortest runtime / 6. seeded random
 *
 * Stars sit *below* yes-votes by construction, which is the guarantee the spec
 * makes about them here: "a star separates only films those signals have already
 * tied and never promotes one past them: past a film with more yes-votes in
 * Phase 1, or past a better-approved one in the runoff."
 */
export const BOUNDARY_CHAIN: ChainStep<BoundaryTiebreakRule>[] = [
	{ rule: null, field: 'yesVotes', dir: 'desc' },
	STARS,
	APPROVAL,
	...TAIL
];

/**
 * Phase 2 cycle resolution: Copeland, then approval, then STARS, then the tail.
 *
 * voting-spec, Tally: "1. Copeland score. 2. Approval. 3. Stars — more
 * `star_votes` among attendees wins. Below approval and not above it: a star may
 * separate finalists that both the pairwise vote and standing approval have
 * tied, and never promotes a film past a better-approved one."
 *
 * Stars sit one rung lower here than at the boundary (where they are above
 * approval) on purpose: in the runoff a star speaks only when the live pairwise
 * vote AND standing approval have both refused to decide.
 */
export const CYCLE_CHAIN: ChainStep<CycleTiebreakRule>[] = [
	{ rule: 'copeland', field: 'copeland', dir: 'desc' },
	APPROVAL,
	STARS,
	...TAIL
];

function stepCompare<R extends string>(step: ChainStep<R>, a: RankRow, b: RankRow): number {
	const av = a[step.field] as number;
	const bv = b[step.field] as number;
	if (av === bv) return 0;
	// +Infinity === +Infinity is handled above, so plain subtraction is safe.
	return step.dir === 'desc' ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
}

/**
 * Compares two rows and reports which rule separated them.
 *
 * `stepIndex` is the index into the chain that decided; when nothing in the
 * chain separates them (only possible if two rows share a seeded random key)
 * the movie id breaks the tie so the ordering stays total, and the decision is
 * still attributed to `seeded_random`.
 */
export function decide<R extends string>(
	chain: ChainStep<R>[],
	a: RankRow,
	b: RankRow
): { cmp: number; rule: R | null; stepIndex: number } {
	for (let i = 0; i < chain.length; i++) {
		const cmp = stepCompare(chain[i], a, b);
		if (cmp !== 0) return { cmp, rule: chain[i].rule, stepIndex: i };
	}
	const cmp = a.movieId < b.movieId ? -1 : a.movieId > b.movieId ? 1 : 0;
	return { cmp, rule: chain[chain.length - 1].rule, stepIndex: chain.length - 1 };
}

export function comparator<R extends string>(chain: ChainStep<R>[]): (a: RankRow, b: RankRow) => number {
	return (a, b) => decide(chain, a, b).cmp;
}

/** Sorts a copy of `rows` best-first. Total and independent of input order. */
export function rank<R extends string>(chain: ChainStep<R>[], rows: readonly RankRow[]): RankRow[] {
	return rows.slice().sort(comparator(chain));
}

/**
 * Given rows already ranked best-first, describes the decision at `boundary`
 * (the index of the first *loser*): which rule separated `rows[boundary - 1]`
 * from `rows[boundary]`, and everything that was still tied at that point.
 *
 * Returns `null` when the primary ranking key (chain step 0, `rule: null`)
 * already separated them — i.e. when there was no tie to break.
 */
export function describeDecision<R extends string>(
	chain: ChainStep<R>[],
	ranked: readonly RankRow[],
	boundary: number
): TiebreakOutcome<R> | null {
	if (boundary <= 0 || boundary >= ranked.length) return null;
	const winner = ranked[boundary - 1];
	const loser = ranked[boundary];
	const { rule, stepIndex } = decide(chain, winner, loser);
	if (rule === null) return null;

	// Everything tied with the winner on every step strictly before the
	// deciding one was genuinely in contention.
	const contested = ranked
		.filter((row) => chain.slice(0, stepIndex).every((step) => stepCompare(step, winner, row) === 0))
		.map((row) => row.movieId);

	return { rule, contested };
}

/**
 * voting-spec rule 4: "the finalist suggested by whichever *attendee* has gone
 * longest without a winning suggestion ... Restrict it to attendees, or absent
 * members accumulate 'owed a win' credit for nights they skipped. Measure
 * members who have never won from their join date, not as infinitely overdue."
 *
 * Returns the timestamp the suggester has been waiting since (lower = waited
 * longer = stronger claim). `+Infinity` means "no claim at all": the suggester
 * is not attending, or has no fairness record.
 *
 * SETTLED by the amended spec: "at rule 4 a finalist whose suggester is not
 * attending has the worst possible fairness claim and is eliminated by that rung
 * (rather than the rung being skipped as indecisive)." `+Infinity` is exactly
 * that worst possible claim, so such a finalist loses the rung and drops out of
 * contention for the later rungs.
 */
export function rotationFairnessKey(
	movie: MovieInput,
	attendees: ReadonlySet<MemberId>,
	fairness: ReadonlyMap<MemberId, FairnessInput>
): number {
	if (!attendees.has(movie.suggestedBy)) return Number.POSITIVE_INFINITY;
	const record = fairness.get(movie.suggestedBy);
	if (!record) return Number.POSITIVE_INFINITY;
	return record.lastWinAt ?? record.joinedAt;
}

/** voting-spec rule 5. Unknown runtimes rank last rather than first. */
export function runtimeKey(movie: MovieInput): number {
	return movie.runtimeMin ?? Number.POSITIVE_INFINITY;
}

export function buildRankRow(
	movie: MovieInput,
	stats: { yesVotes: number; starVotes?: number; approval: number; copeland?: number },
	ctx: {
		attendees: ReadonlySet<MemberId>;
		fairness: ReadonlyMap<MemberId, FairnessInput>;
		seed: number;
	}
): RankRow {
	return {
		movieId: movie.id,
		yesVotes: stats.yesVotes,
		// Defaults to 0 — "nobody starred this" — which makes the star rung separate
		// nothing. Both chains have a star rung now, so both callers pass the real
		// count; the default only keeps a hand-built row honest.
		starVotes: stats.starVotes ?? 0,
		approval: stats.approval,
		copeland: stats.copeland ?? 0,
		fairnessKey: rotationFairnessKey(movie, ctx.attendees, ctx.fairness),
		runtimeKey: runtimeKey(movie),
		randomKey: seededKey(ctx.seed, movie.id)
	};
}
