import { describe, expect, it } from 'vitest';
import {
	computeCondorcet,
	computeCopeland,
	computeHeadToHead,
	findCondorcetWinner,
	generateMatchups,
	matchupCount,
	normalizePair,
	pairKey
} from './pairwise.js';
import { matrixVotes, members, reversed, type MatrixRow } from './testing.js';
import type { PairVoteInput } from './types.js';

const V = members(8);

describe('normalizePair / pairKey', () => {
	it('orders a pair canonically regardless of argument order', () => {
		expect(normalizePair('b', 'a')).toEqual({ a: 'a', b: 'b' });
		expect(normalizePair('a', 'b')).toEqual({ a: 'a', b: 'b' });
		expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
	});
});

describe('generateMatchups', () => {
	const cases: [finalists: number, pairs: number][] = [
		[0, 0],
		[1, 0],
		[2, 1],
		[3, 3],
		[4, 6],
		[5, 10]
	];
	for (const [finalists, pairs] of cases) {
		it(`${finalists} finalists → ${pairs} pairs`, () => {
			const ids = Array.from({ length: finalists }, (_, i) => `m${i}`);
			expect(generateMatchups(ids).length).toBe(pairs);
			expect(matchupCount(finalists)).toBe(pairs);
		});
	}

	it('emits each unordered pair exactly once, normalised', () => {
		const matchups = generateMatchups(['c', 'a', 'b']);
		expect(matchups.every(({ a, b }) => a < b)).toBe(true);
		expect(new Set(matchups.map(({ a, b }) => pairKey(a, b))).size).toBe(3);
	});

	it('ignores duplicate ids', () => {
		expect(generateMatchups(['a', 'a', 'b']).length).toBe(1);
	});

	it('is deterministic', () => {
		const ids = ['m5', 'm1', 'm3', 'm2'];
		expect(generateMatchups(ids)).toEqual(generateMatchups(ids));
	});
});

describe('head-to-head counting', () => {
	it('counts preferences, no-preferences, and derives the pair winner', () => {
		const rows: MatrixRow[] = [['a', 'b', 3, 1, 2]];
		const matrix = computeHeadToHead(['a', 'b'], matrixVotes(rows, V), V);
		expect(matrix).toEqual([{ a: 'a', b: 'b', aWins: 3, bWins: 1, noPreference: 2, winner: 'a' }]);
	});

	it('treats a dead heat as no winner', () => {
		const matrix = computeHeadToHead(['a', 'b'], matrixVotes([['a', 'b', 2, 2, 1]], V), V);
		expect(matrix[0].winner).toBeNull();
	});

	it('a movie beats another only by strictly more head-to-heads', () => {
		expect(computeHeadToHead(['a', 'b'], matrixVotes([['a', 'b', 1, 0, 7]], V), V)[0].winner).toBe('a');
		expect(computeHeadToHead(['a', 'b'], matrixVotes([['a', 'b', 0, 0, 8]], V), V)[0].winner).toBeNull();
	});

	it('reports zeroes for a pair nobody voted on', () => {
		const matrix = computeHeadToHead(['a', 'b'], [], V);
		expect(matrix).toEqual([{ a: 'a', b: 'b', aWins: 0, bWins: 0, noPreference: 0, winner: null }]);
	});

	it('normalises un-normalised incoming votes', () => {
		// Same information written as (b, a) instead of (a, b).
		const flipped: PairVoteInput[] = [{ memberId: 'v1', movieAId: 'b', movieBId: 'a', winnerId: 'a' }];
		const matrix = computeHeadToHead(['a', 'b'], flipped, V);
		expect(matrix[0]).toEqual({ a: 'a', b: 'b', aWins: 1, bWins: 0, noPreference: 0, winner: 'a' });
	});

	it('counts attendees only', () => {
		const votes: PairVoteInput[] = [
			{ memberId: 'v1', movieAId: 'a', movieBId: 'b', winnerId: 'a' },
			{ memberId: 'ghost', movieAId: 'a', movieBId: 'b', winnerId: 'b' }
		];
		const matrix = computeHeadToHead(['a', 'b'], votes, ['v1']);
		expect(matrix[0]).toMatchObject({ aWins: 1, bWins: 0 });
	});

	it('does not double-count a voter who changed their mind', () => {
		const votes: PairVoteInput[] = [
			{ memberId: 'v1', movieAId: 'a', movieBId: 'b', winnerId: 'a' },
			{ memberId: 'v1', movieAId: 'b', movieBId: 'a', winnerId: 'b' }
		];
		const matrix = computeHeadToHead(['a', 'b'], votes, V);
		expect(matrix[0]).toMatchObject({ aWins: 0, bWins: 1, noPreference: 0 });
	});

	it('ignores votes on pairs outside the round robin', () => {
		const votes: PairVoteInput[] = [{ memberId: 'v1', movieAId: 'a', movieBId: 'zz', winnerId: 'zz' }];
		const matrix = computeHeadToHead(['a', 'b'], votes, V);
		expect(matrix[0]).toMatchObject({ aWins: 0, bWins: 0, noPreference: 0 });
	});

	it('ignores a winner that names neither side of the pair', () => {
		const votes: PairVoteInput[] = [{ memberId: 'v1', movieAId: 'a', movieBId: 'b', winnerId: 'c' }];
		const matrix = computeHeadToHead(['a', 'b'], votes, V);
		expect(matrix[0]).toMatchObject({ aWins: 0, bWins: 0, noPreference: 0 });
	});

	it('does not depend on vote order', () => {
		const votes = matrixVotes(
			[
				['a', 'b', 3, 2, 1],
				['a', 'c', 1, 4, 0],
				['b', 'c', 2, 2, 2]
			],
			V
		);
		expect(computeHeadToHead(['a', 'b', 'c'], reversed(votes), V)).toEqual(
			computeHeadToHead(['a', 'b', 'c'], votes, V)
		);
	});
});

describe('Copeland score', () => {
	it('counts pairwise victories, scoring nothing for a dead heat', () => {
		const rows: MatrixRow[] = [
			['a', 'b', 3, 1, 0], // a
			['a', 'c', 3, 1, 0], // a
			['b', 'c', 2, 2, 0] // tie
		];
		const matrix = computeHeadToHead(['a', 'b', 'c'], matrixVotes(rows, V), V);
		expect(computeCopeland(['a', 'b', 'c'], matrix)).toEqual({ a: 2, b: 0, c: 0 });
	});

	it('gives every movie a key, even a total loser', () => {
		const matrix = computeHeadToHead(['a', 'b'], matrixVotes([['a', 'b', 3, 0, 0]], V), V);
		expect(computeCopeland(['a', 'b'], matrix)).toEqual({ a: 1, b: 0 });
	});
});

describe('Condorcet winner', () => {
	it('finds the movie that beats every other finalist', () => {
		const rows: MatrixRow[] = [
			['a', 'b', 3, 1, 0],
			['a', 'c', 4, 1, 0],
			['b', 'c', 3, 2, 0]
		];
		const { condorcetWinnerId, copeland } = computeCondorcet(['a', 'b', 'c'], matrixVotes(rows, V), V);
		expect(condorcetWinnerId).toBe('a');
		expect(copeland).toEqual({ a: 2, b: 1, c: 0 });
	});

	it('returns null for a three-way cycle', () => {
		// A beats B, B beats C, C beats A.
		const rows: MatrixRow[] = [
			['a', 'b', 2, 1, 0],
			['b', 'c', 2, 1, 0],
			['a', 'c', 1, 2, 0]
		];
		const { condorcetWinnerId, copeland } = computeCondorcet(['a', 'b', 'c'], matrixVotes(rows, V), V);
		expect(condorcetWinnerId).toBeNull();
		expect(copeland).toEqual({ a: 1, b: 1, c: 1 });
	});

	it('returns null when the top contender merely ties one rival', () => {
		const rows: MatrixRow[] = [
			['a', 'b', 3, 1, 0],
			['a', 'c', 2, 2, 0], // tie: `a` does not beat everyone
			['b', 'c', 3, 1, 0]
		];
		expect(findCondorcetWinner(['a', 'b', 'c'], computeHeadToHead(['a', 'b', 'c'], matrixVotes(rows, V), V))).toBeNull();
	});

	it('returns null when nobody voted at all', () => {
		expect(findCondorcetWinner(['a', 'b', 'c'], computeHeadToHead(['a', 'b', 'c'], [], V))).toBeNull();
	});

	it('a lone finalist wins vacuously', () => {
		expect(findCondorcetWinner(['a'], [])).toBe('a');
	});

	it('an empty finalist set has no winner', () => {
		expect(findCondorcetWinner([], [])).toBeNull();
	});

	it('handles the full 5-finalist round robin', () => {
		const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
		const rows: MatrixRow[] = generateMatchups(ids).map(({ a, b }) => [a, b, 4, 1, 0] as MatrixRow);
		// Every pair won by the lexicographically smaller id → m1 beats all.
		const { matrix, condorcetWinnerId, copeland } = computeCondorcet(ids, matrixVotes(rows, V), V);
		expect(matrix.length).toBe(10);
		expect(condorcetWinnerId).toBe('m1');
		expect(copeland).toEqual({ m1: 4, m2: 3, m3: 2, m4: 1, m5: 0 });
	});
});
