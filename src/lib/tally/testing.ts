/**
 * Test fixtures for the tally module. Deliberately NOT re-exported from
 * `index.ts` — this is scaffolding for the table-driven tests, not public API.
 */

import { normalizePair } from './pairwise.js';
import {
	DEFAULT_TALLY_CONFIG,
	type FairnessInput,
	type MemberId,
	type MovieId,
	type MovieInput,
	type PairVoteInput,
	type StandingVoteInput,
	type TallyConfig,
	type VetoInput
} from './types.js';

export function movie(id: MovieId, overrides: Partial<Omit<MovieInput, 'id'>> = {}): MovieInput {
	return { id, runtimeMin: 100, suggestedBy: 'suggester', status: 'pool', ...overrides };
}

/** `members(3)` → ['v1', 'v2', 'v3'] */
export function members(count: number, prefix = 'v'): MemberId[] {
	return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}

/**
 * Standing votes for one movie: the first `yes` members vote yes, the next `no`
 * vote no, and the first `stars` of the yes-voters star theirs (a star is an
 * upgraded yes, so it can only land on one).
 */
export function standing(
	movieId: MovieId,
	yes: number,
	no: number,
	voters: readonly MemberId[],
	stars = 0
): StandingVoteInput[] {
	if (yes + no > voters.length) throw new Error(`standing(${movieId}): not enough voters`);
	if (stars > yes) throw new Error(`standing(${movieId}): ${stars} stars on ${yes} yes-votes`);
	return [
		...voters
			.slice(0, yes)
			.map((memberId, i) => ({ memberId, movieId, value: 'yes' as const, starred: i < stars })),
		...voters.slice(yes, yes + no).map((memberId) => ({ memberId, movieId, value: 'no' as const }))
	];
}

export function fair(memberId: MemberId, joinedAt: number, lastWinAt: number | null = null): FairnessInput {
	return { memberId, joinedAt, lastWinAt };
}

export function config(overrides: Partial<TallyConfig> = {}): TallyConfig {
	return { ...DEFAULT_TALLY_CONFIG, ...overrides };
}

export function veto(memberId: MemberId, movieId: MovieId | null): VetoInput {
	return { memberId, movieId };
}

/** One row of a desired head-to-head matrix: `[x, y, xWins, yWins, noPreference]`. */
export type MatrixRow = [MovieId, MovieId, number, number, number];

/**
 * Synthesises pair votes that produce the requested head-to-head matrix.
 *
 * Voters are reused across pairs (which is legal: uniqueness is per member per
 * pair) and the pair is written in the order given, so the caller's ordering
 * also exercises the a<b normalisation.
 */
export function matrixVotes(rows: readonly MatrixRow[], voters: readonly MemberId[]): PairVoteInput[] {
	const out: PairVoteInput[] = [];
	for (const [x, y, xWins, yWins, noPreference] of rows) {
		if (xWins + yWins + noPreference > voters.length) {
			throw new Error(`matrixVotes(${x} vs ${y}): needs ${xWins + yWins + noPreference} voters`);
		}
		let i = 0;
		for (let k = 0; k < xWins; k++) out.push({ memberId: voters[i++], movieAId: x, movieBId: y, winnerId: x });
		for (let k = 0; k < yWins; k++) out.push({ memberId: voters[i++], movieAId: x, movieBId: y, winnerId: y });
		for (let k = 0; k < noPreference; k++)
			out.push({ memberId: voters[i++], movieAId: x, movieBId: y, winnerId: null });
	}
	return out;
}

/** Reverses an array — used to prove results never depend on input order. */
export function reversed<T>(items: readonly T[]): T[] {
	return items.slice().reverse();
}

/** Deterministic "shuffle" for order-independence assertions. */
export function rotate<T>(items: readonly T[], by = 1): T[] {
	const n = items.length;
	if (n === 0) return [];
	const shift = ((by % n) + n) % n;
	return [...items.slice(shift), ...items.slice(0, shift)];
}

export { normalizePair };
