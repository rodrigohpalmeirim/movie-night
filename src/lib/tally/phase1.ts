/**
 * Phase 1 — swipe: coverage, approval, eligibility and finalist selection.
 *
 * voting-spec:
 *   attendee_votes(movie) = attendees with a standing vote on this movie
 *   coverage(movie)       = attendee_votes(movie) / attendees
 *   approval(movie)       = yes_votes among attendees / attendee_votes(movie)
 *   Require coverage >= COVERAGE_FLOOR.
 *
 * Coverage is the whole of the eligibility test. There is no separate floor on
 * the raw vote count: a fixed minimum locked small groups out of every round,
 * and coverage — a *share* of the attendees — already carries the "a movie
 * nobody has seen yet waits for the next round" job at any group size.
 */

import { BOUNDARY_CHAIN, buildRankRow, describeDecision, rank, type RankRow } from './tiebreak.js';
import type {
	FairnessInput,
	MemberId,
	MovieId,
	MovieInput,
	MovieTally,
	Phase1Input,
	Phase1Result,
	StandingVoteInput,
	TallyConfig
} from './types.js';

/**
 * Floors are compared cross-multiplied with a tolerance so that a group of 5
 * attendees with 3 votes clears a 0.6 coverage floor regardless of binary
 * floating-point representation. Without this, `3/5 >= 0.6` style comparisons
 * are a coin flip across different floor values.
 */
const EPSILON = 1e-9;

/** `value >= floor * total`, tolerant of float representation error. */
export function meetsRatio(value: number, floor: number, total: number): boolean {
	return value + EPSILON >= floor * total;
}

export function attendeeSet(attendeeIds: readonly MemberId[]): Set<MemberId> {
	return new Set(attendeeIds);
}

export function fairnessMap(records: readonly FairnessInput[]): Map<MemberId, FairnessInput> {
	const map = new Map<MemberId, FairnessInput>();
	for (const record of records) map.set(record.memberId, record);
	return map;
}

/**
 * Indexes standing votes by movie, keeping only attendees' votes and
 * de-duplicating by member (the DB's unique (member_id, movie_id) makes
 * duplicates impossible, but the tally must not silently double-count if a
 * caller passes them anyway — voting-spec: "Re-submitting must not
 * double-count").
 */
export function indexStandingVotes(
	votes: readonly StandingVoteInput[],
	attendees: ReadonlySet<MemberId>
): Map<MovieId, Map<MemberId, 'yes' | 'no'>> {
	const byMovie = new Map<MovieId, Map<MemberId, 'yes' | 'no'>>();
	for (const vote of votes) {
		if (!attendees.has(vote.memberId)) continue;
		let members = byMovie.get(vote.movieId);
		if (!members) {
			members = new Map();
			byMovie.set(vote.movieId, members);
		}
		members.set(vote.memberId, vote.value);
	}
	return byMovie;
}

export function computeMovieTally(
	movie: MovieInput,
	attendeeCount: number,
	votes: ReadonlyMap<MemberId, 'yes' | 'no'> | undefined,
	config: TallyConfig
): MovieTally {
	let yesVotes = 0;
	let noVotes = 0;
	if (votes) {
		for (const value of votes.values()) {
			if (value === 'yes') yesVotes++;
			else noVotes++;
		}
	}
	const attendeeVotes = yesVotes + noVotes;
	const coverage = attendeeCount > 0 ? attendeeVotes / attendeeCount : 0;
	// approval divides by voters who saw the card, never by total attendees.
	const approval = attendeeVotes > 0 ? yesVotes / attendeeVotes : 0;

	const inPool = (movie.status ?? 'pool') === 'pool';
	// `attendeeCount > 0`: with an empty electorate coverage is 0/0, which is not
	// a share of anything — nothing is eligible rather than everything.
	const clearsCoverage = attendeeCount > 0 && meetsRatio(attendeeVotes, config.coverageFloor, attendeeCount);

	const ineligibleReason = !inPool ? 'not_in_pool' : !clearsCoverage ? 'coverage_floor' : null;

	return {
		movieId: movie.id,
		attendeeVotes,
		yesVotes,
		noVotes,
		coverage,
		approval,
		eligible: ineligibleReason === null,
		ineligibleReason,
		clearsApprovalFloor: attendeeVotes > 0 && meetsRatio(yesVotes, config.approvalFloor, attendeeVotes)
	};
}

/** Tallies every movie against the given attendee set, in input order. */
export function computeTallies(
	movies: readonly MovieInput[],
	attendeeIds: readonly MemberId[],
	standingVotes: readonly StandingVoteInput[],
	config: TallyConfig
): MovieTally[] {
	const attendees = attendeeSet(attendeeIds);
	const byMovie = indexStandingVotes(standingVotes, attendees);
	return movies.map((movie) => computeMovieTally(movie, attendees.size, byMovie.get(movie.id), config));
}

/**
 * Phase 1 in full: tally, filter, rank, promote.
 *
 * "Rank eligible movies by yes_votes among attendees. Promote the top
 * N_FINALISTS that also satisfy approval >= APPROVAL_FLOOR."
 *
 * Resolution of an ambiguity: the approval floor is applied as a *filter over
 * the eligible set before* taking the top N, not as a filter over the top N.
 * The following sentence ("If fewer than two movies clear the floor: exactly
 * one clears it → it wins outright") counts floor-clearing movies group-wide,
 * which only makes sense if the floor is the filter that defines the candidate
 * set. The alternative reading also lets a high-yes / low-approval movie
 * consume a finalist slot and then be discarded, shrinking the runoff for no
 * reason.
 */
export function computePhase1(input: Phase1Input): Phase1Result {
	const { movies, attendeeIds, standingVotes, config, fairness, seed } = input;
	const attendees = attendeeSet(attendeeIds);
	const fair = fairnessMap(fairness);

	const tallies = computeTallies(movies, attendeeIds, standingVotes, config);
	const tallyById = new Map(tallies.map((tally) => [tally.movieId, tally]));
	const movieById = new Map(movies.map((movie) => [movie.id, movie]));

	const rowFor = (tally: MovieTally): RankRow =>
		buildRankRow(movieById.get(tally.movieId)!, { yesVotes: tally.yesVotes, approval: tally.approval }, {
			attendees,
			fairness: fair,
			seed
		});

	const eligibleRows = rank(
		BOUNDARY_CHAIN,
		tallies.filter((tally) => tally.eligible).map(rowFor)
	);
	const candidateRows = rank(
		BOUNDARY_CHAIN,
		tallies.filter((tally) => tally.eligible && tally.clearsApprovalFloor).map(rowFor)
	);

	const nFinalists = Math.max(1, Math.floor(config.nFinalists));
	const finalistIds = candidateRows.slice(0, nFinalists).map((row) => row.movieId);

	// One movie to compare against nothing is not a runoff — voting-spec:
	// "Exactly one clears it → it wins outright, skip Phase 2."
	const outcome =
		finalistIds.length === 0 ? 'no_clear_favourite' : finalistIds.length === 1 ? 'outright_winner' : 'runoff';

	return {
		attendeeCount: attendees.size,
		tallies,
		eligible: eligibleRows.map((row) => tallyById.get(row.movieId)!),
		candidates: candidateRows.map((row) => tallyById.get(row.movieId)!),
		finalistIds,
		outcome,
		outrightWinnerId: outcome === 'outright_winner' ? finalistIds[0] : null,
		boundaryTiebreak: describeDecision(BOUNDARY_CHAIN, candidateRows, nFinalists)
	};
}
