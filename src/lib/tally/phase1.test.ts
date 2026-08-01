import { describe, expect, it } from 'vitest';
import { computeMovieTally, computePhase1, computeTallies, indexStandingVotes, meetsRatio } from './phase1.js';
import { generateMatchups } from './pairwise.js';
import { config, fair, members, movie, reversed, rotate, standing } from './testing.js';
import type { FairnessInput, MovieInput, Phase1Input, StandingVoteInput } from './types.js';

const V = members(10); // v1..v10

function phase1(overrides: Partial<Phase1Input> = {}): Phase1Input {
	return {
		attendeeIds: V.slice(0, 5),
		movies: [],
		standingVotes: [],
		config: config(),
		fairness: V.map((m, i) => fair(m, 1000 + i)),
		seed: 12345,
		...overrides
	};
}

describe('meetsRatio (float-safe floor comparison)', () => {
	const cases: [label: string, value: number, floor: number, total: number, expected: boolean][] = [
		['3 of 5 clears 0.6 exactly', 3, 0.6, 5, true],
		['2 of 5 misses 0.6', 2, 0.6, 5, false],
		['7 of 10 clears 0.7 exactly', 7, 0.7, 10, true],
		['3 of 6 misses 0.6 (needs 3.6)', 3, 0.6, 6, false],
		['4 of 6 clears 0.6', 4, 0.6, 6, true],
		['2 of 4 clears 0.5 exactly', 2, 0.5, 4, true],
		['1 of 3 misses 0.5', 1, 0.5, 3, false],
		['2 of 3 clears 0.5', 2, 0.5, 3, true],
		['0 of 0 clears any floor vacuously', 0, 0.6, 0, true]
	];
	for (const [label, value, floor, total, expected] of cases) {
		it(label, () => expect(meetsRatio(value, floor, total)).toBe(expected));
	}
});

describe('coverage and approval arithmetic', () => {
	// voting-spec: coverage = attendee_votes / attendees;
	//              approval = yes among attendees / attendee_votes
	const cases: [label: string, yes: number, no: number, attendees: number, coverage: number, approval: number][] = [
		['3 yes of 5 attendees, nobody said no', 3, 0, 5, 0.6, 1],
		['approval divides by voters who saw the card', 3, 2, 5, 1, 0.6],
		['8 yes 2 no of 10', 8, 2, 10, 1, 0.8],
		['2 yes of 2 votes in a 10-person night', 2, 0, 10, 0.2, 1],
		['no votes at all', 0, 0, 5, 0, 0],
		['all no', 0, 4, 5, 0.8, 0]
	];
	for (const [label, yes, no, attendeeCount, coverage, approval] of cases) {
		it(label, () => {
			const voters = members(attendeeCount);
			const tally = computeTallies([movie('m')], voters, standing('m', yes, no, voters), config())[0];
			expect(tally.coverage).toBeCloseTo(coverage, 10);
			expect(tally.approval).toBeCloseTo(approval, 10);
			expect(tally.attendeeVotes).toBe(yes + no);
			expect(tally.yesVotes).toBe(yes);
			expect(tally.noVotes).toBe(no);
		});
	}

	it('never conflates a missing vote with a "no"', () => {
		// 3 yes out of 5 attendees: coverage 0.6, approval 1.0. If the two silent
		// attendees read as "no", approval would be 0.6 and coverage 1.0.
		const voters = members(5);
		const tally = computeTallies([movie('m')], voters, standing('m', 3, 0, voters), config())[0];
		expect(tally.coverage).toBeCloseTo(0.6, 10);
		expect(tally.approval).toBe(1);
		expect(tally.noVotes).toBe(0);
	});

	it('counts attendees only', () => {
		const attendeeIds = ['v1', 'v2', 'v3'];
		const votes: StandingVoteInput[] = [
			{ memberId: 'v1', movieId: 'm', value: 'yes' },
			{ memberId: 'v9', movieId: 'm', value: 'yes' }, // not attending
			{ memberId: 'v8', movieId: 'm', value: 'no' } // not attending
		];
		const tally = computeTallies([movie('m')], attendeeIds, votes, config())[0];
		expect(tally.attendeeVotes).toBe(1);
		expect(tally.yesVotes).toBe(1);
	});

	it('does not double-count a re-submitted vote', () => {
		const votes: StandingVoteInput[] = [
			{ memberId: 'v1', movieId: 'm', value: 'yes' },
			{ memberId: 'v1', movieId: 'm', value: 'no' } // changed their mind
		];
		const tally = computeTallies([movie('m')], ['v1', 'v2'], votes, config())[0];
		expect(tally.attendeeVotes).toBe(1);
		expect(tally.yesVotes).toBe(0);
		expect(tally.noVotes).toBe(1);
	});

	it('indexes only attendees, de-duplicated by member', () => {
		const index = indexStandingVotes(
			[
				{ memberId: 'v1', movieId: 'm', value: 'yes' },
				{ memberId: 'v1', movieId: 'm', value: 'no' },
				{ memberId: 'v7', movieId: 'm', value: 'yes' }
			],
			new Set(['v1'])
		);
		expect(index.get('m')?.size).toBe(1);
		expect(index.get('m')?.get('v1')).toBe('no');
	});
});

describe('eligibility: coverage floor AND status = pool', () => {
	type Case = [
		label: string,
		yes: number,
		no: number,
		attendees: number,
		cfg: Partial<ReturnType<typeof config>>,
		status: MovieInput['status'],
		eligible: boolean,
		reason: string | null
	];
	const cases: Case[] = [
		['exactly at the coverage floor', 3, 0, 5, {}, 'pool', true, null],
		['one vote below the coverage floor', 2, 0, 5, {}, 'pool', false, 'coverage_floor'],
		['coverage floor of 0.6 with 6 attendees needs 4 votes', 3, 0, 6, {}, 'pool', false, 'coverage_floor'],
		['...and 4 votes clears it', 4, 0, 6, {}, 'pool', true, null],
		// Coverage is the only vote-count test there is: 2 of 3 is a 0.67 share, so
		// it is eligible even though a three-person group can never reach the three
		// separate ballots the old MIN_ATTENDEE_VOTES floor demanded.
		['2 of 3 clears coverage and is eligible', 2, 0, 3, {}, 'pool', true, null],
		['a single vote in a one-attendee round is eligible', 1, 0, 1, {}, 'pool', true, null],
		['3 of 3 clears it too', 3, 0, 3, {}, 'pool', true, null],
		['coverage floor is configurable', 2, 0, 10, { coverageFloor: 0.2 }, 'pool', true, null],
		['...and still bites above the configured share', 1, 0, 10, { coverageFloor: 0.2 }, 'pool', false, 'coverage_floor'],
		['a watched movie is never eligible', 5, 0, 5, {}, 'watched', false, 'not_in_pool'],
		['a removed movie is never eligible', 5, 0, 5, {}, 'removed', false, 'not_in_pool'],
		['zero attendees means nothing is eligible', 0, 0, 0, {}, 'pool', false, 'coverage_floor']
	];

	for (const [label, yes, no, attendeeCount, cfg, status, eligible, reason] of cases) {
		it(label, () => {
			const voters = members(Math.max(attendeeCount, yes + no));
			const attendeeIds = voters.slice(0, attendeeCount);
			const tally = computeMovieTally(
				movie('m', { status }),
				attendeeIds.length,
				new Map(standing('m', yes, no, attendeeIds).map((v) => [v.memberId, v.value])),
				config(cfg)
			);
			expect(tally.eligible).toBe(eligible);
			expect(tally.ineligibleReason).toBe(reason);
		});
	}

	it('defaults a movie with no explicit status to pool', () => {
		const voters = members(3);
		const input: MovieInput = { id: 'm', runtimeMin: 90, suggestedBy: 'v1' };
		const tally = computeTallies([input], voters, standing('m', 3, 0, voters), config())[0];
		expect(tally.eligible).toBe(true);
	});
});

describe('approval floor', () => {
	const cases: [label: string, yes: number, no: number, floor: number, clears: boolean][] = [
		['exactly 0.5 clears the default floor', 2, 2, 0.5, true],
		['just under 0.5 does not', 1, 3, 0.5, false],
		['2 of 3 clears', 2, 1, 0.5, true],
		['1 of 3 does not', 1, 2, 0.5, false],
		['unanimous yes clears any floor', 4, 0, 1, true],
		['a raised floor rejects a merely tolerable movie', 3, 2, 0.7, false],
		['a raised floor accepts an enthusiastic one', 4, 1, 0.7, true],
		['no votes never clears', 0, 0, 0.5, false]
	];
	for (const [label, yes, no, floor, clears] of cases) {
		it(label, () => {
			const voters = members(Math.max(4, yes + no));
			const tally = computeTallies([movie('m')], voters, standing('m', yes, no, voters), config({ approvalFloor: floor }))[0];
			expect(tally.clearsApprovalFloor).toBe(clears);
		});
	}
});

describe('finalist selection', () => {
	it('ranks eligible movies by attendee yes-votes and promotes the top N', () => {
		const voters = V.slice(0, 5);
		const movies = [
			movie('m1'),
			movie('m2'),
			movie('m3'),
			movie('m4'),
			movie('m5'),
			movie('m6')
		];
		const votes = [
			...standing('m1', 5, 0, voters),
			...standing('m2', 4, 1, voters),
			...standing('m3', 3, 2, voters),
			...standing('m4', 3, 1, voters),
			...standing('m5', 4, 0, voters),
			...standing('m6', 5, 0, voters)
		];
		const result = computePhase1(phase1({ movies, standingVotes: votes, config: config({ nFinalists: 3 }) }));
		expect(result.outcome).toBe('runoff');
		expect(result.finalistIds.length).toBe(3);
		// m1 and m6 have 5 yes, m2 and m5 have 4.
		expect(result.finalistIds.slice(0, 2).sort()).toEqual(['m1', 'm6']);
		expect(result.candidates.map((c) => c.yesVotes)).toEqual([5, 5, 4, 4, 3, 3]);
	});

	it('excludes movies that fail the approval floor from the candidate set', () => {
		// m_loud has the most yes-votes but only 40% approval: it must not take a
		// finalist slot.
		const voters = V.slice(0, 10);
		const movies = [movie('loud'), movie('good1'), movie('good2')];
		const votes = [
			...standing('loud', 4, 6, voters),
			...standing('good1', 3, 3, voters),
			...standing('good2', 3, 3, voters)
		];
		const result = computePhase1(phase1({ attendeeIds: voters, movies, standingVotes: votes }));
		expect(result.eligible.map((e) => e.movieId).sort()).toEqual(['good1', 'good2', 'loud']);
		expect(result.candidates.map((c) => c.movieId).sort()).toEqual(['good1', 'good2']);
		expect(result.finalistIds).not.toContain('loud');
	});

	it('caps the finalist set at N_FINALISTS', () => {
		const voters = V.slice(0, 5);
		const movies = Array.from({ length: 9 }, (_, i) => movie(`m${i}`));
		const votes = movies.flatMap((m) => standing(m.id, 4, 1, voters));
		const result = computePhase1(phase1({ movies, standingVotes: votes }));
		expect(result.candidates.length).toBe(9);
		expect(result.finalistIds.length).toBe(5);
	});

	it('outcome = outright_winner when exactly one movie clears the approval floor', () => {
		const voters = V.slice(0, 5);
		const movies = [movie('winner'), movie('meh'), movie('unseen')];
		const votes = [
			...standing('winner', 4, 1, voters),
			...standing('meh', 1, 4, voters), // eligible, fails approval floor
			...standing('unseen', 2, 0, voters) // fails coverage
		];
		const result = computePhase1(phase1({ movies, standingVotes: votes }));
		expect(result.outcome).toBe('outright_winner');
		expect(result.outrightWinnerId).toBe('winner');
		expect(result.finalistIds).toEqual(['winner']);
	});

	it('outcome = no_clear_favourite when nothing clears the approval floor', () => {
		const voters = V.slice(0, 5);
		const movies = [movie('m1'), movie('m2')];
		const votes = [...standing('m1', 1, 4, voters), ...standing('m2', 2, 3, voters)];
		const result = computePhase1(phase1({ movies, standingVotes: votes }));
		expect(result.outcome).toBe('no_clear_favourite');
		expect(result.finalistIds).toEqual([]);
		expect(result.outrightWinnerId).toBeNull();
	});

	it('outcome = no_clear_favourite when nothing is even eligible', () => {
		const voters = V.slice(0, 5);
		const movies = [movie('fresh1'), movie('fresh2')];
		const votes = [...standing('fresh1', 2, 0, voters), ...standing('fresh2', 1, 0, voters)];
		const result = computePhase1(phase1({ movies, standingVotes: votes }));
		expect(result.eligible).toEqual([]);
		expect(result.outcome).toBe('no_clear_favourite');
	});

	it('reports one tally per input movie, in input order', () => {
		const voters = V.slice(0, 5);
		const movies = [movie('z'), movie('a'), movie('m')];
		const result = computePhase1(phase1({ movies, standingVotes: standing('a', 5, 0, voters) }));
		expect(result.tallies.map((t) => t.movieId)).toEqual(['z', 'a', 'm']);
		expect(result.attendeeCount).toBe(5);
	});
});

describe('finalist boundary ties (reuse of the runoff chain)', () => {
	const voters = V.slice(0, 5);

	/** Two movies tied on yes-votes competing for the single remaining slot. */
	function boundary(
		a: MovieInput,
		b: MovieInput,
		votes: StandingVoteInput[],
		fairness: FairnessInput[] = V.map((m, i) => fair(m, 1000 + i)),
		seed = 12345
	) {
		return computePhase1(
			phase1({
				movies: [a, b],
				standingVotes: votes,
				fairness,
				seed,
				config: config({ nFinalists: 1 })
			})
		);
	}

	it('rule 1: higher approval wins the last slot', () => {
		const result = boundary(
			movie('lowApproval', { suggestedBy: 'v1' }),
			movie('highApproval', { suggestedBy: 'v1' }),
			[...standing('lowApproval', 3, 2, voters), ...standing('highApproval', 3, 0, voters)]
		);
		expect(result.finalistIds).toEqual(['highApproval']);
		expect(result.boundaryTiebreak).toEqual({
			rule: 'approval',
			contested: ['highApproval', 'lowApproval']
		});
	});

	it('rule 2: rotation fairness — the attendee who has waited longest', () => {
		const result = boundary(
			movie('anasPick', { suggestedBy: 'v1' }),
			movie('bensPick', { suggestedBy: 'v2' }),
			[...standing('anasPick', 3, 2, voters), ...standing('bensPick', 3, 2, voters)],
			[fair('v1', 1000), fair('v2', 2000), ...V.slice(2).map((m, i) => fair(m, 3000 + i))]
		);
		expect(result.finalistIds).toEqual(['anasPick']);
		expect(result.boundaryTiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 2: a recent winner loses to someone who has never won', () => {
		const result = boundary(
			movie('recentWinnersPick', { suggestedBy: 'v1' }),
			movie('neverWonsPick', { suggestedBy: 'v2' }),
			[...standing('recentWinnersPick', 3, 2, voters), ...standing('neverWonsPick', 3, 2, voters)],
			// v1 joined first but won recently; v2 joined later and never won.
			[fair('v1', 1000, 9000), fair('v2', 2000, null), ...V.slice(2).map((m) => fair(m, 3000))]
		);
		expect(result.finalistIds).toEqual(['neverWonsPick']);
		expect(result.boundaryTiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 2: a brand-new member does not jump the queue', () => {
		const result = boundary(
			movie('veteransPick', { suggestedBy: 'v1' }),
			movie('newcomersPick', { suggestedBy: 'v2' }),
			[...standing('veteransPick', 3, 2, voters), ...standing('newcomersPick', 3, 2, voters)],
			// Never-won members are measured from their join date, not treated as
			// infinitely overdue.
			[fair('v1', 1000, null), fair('v2', 99_000, null), ...V.slice(2).map((m) => fair(m, 3000))]
		);
		expect(result.finalistIds).toEqual(['veteransPick']);
	});

	it('rule 2 is restricted to attendees', () => {
		// v9 is not attending and joined at the dawn of time; their suggestion
		// gets no fairness credit at all.
		const result = boundary(
			movie('absentMembersPick', { suggestedBy: 'v9' }),
			movie('attendeesPick', { suggestedBy: 'v2' }),
			[...standing('absentMembersPick', 3, 2, voters), ...standing('attendeesPick', 3, 2, voters)],
			[fair('v9', 1), fair('v2', 50_000), ...V.slice(0, 5).map((m) => fair(m, 50_000))]
		);
		expect(result.finalistIds).toEqual(['attendeesPick']);
		expect(result.boundaryTiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 3: shortest runtime, once fairness is tied', () => {
		const result = boundary(
			movie('long', { suggestedBy: 'v1', runtimeMin: 180 }),
			movie('short', { suggestedBy: 'v1', runtimeMin: 92 }),
			[...standing('long', 3, 2, voters), ...standing('short', 3, 2, voters)]
		);
		expect(result.finalistIds).toEqual(['short']);
		expect(result.boundaryTiebreak?.rule).toBe('shortest_runtime');
	});

	it('rule 3: an unknown runtime ranks last rather than first', () => {
		const result = boundary(
			movie('unknownRuntime', { suggestedBy: 'v1', runtimeMin: null }),
			movie('threeHours', { suggestedBy: 'v1', runtimeMin: 200 }),
			[...standing('unknownRuntime', 3, 2, voters), ...standing('threeHours', 3, 2, voters)]
		);
		expect(result.finalistIds).toEqual(['threeHours']);
	});

	it('rule 4: seeded random, when everything else is identical', () => {
		const build = (seed: number) =>
			boundary(
				movie('twinA', { suggestedBy: 'v1', runtimeMin: 100 }),
				movie('twinB', { suggestedBy: 'v1', runtimeMin: 100 }),
				[...standing('twinA', 3, 2, voters), ...standing('twinB', 3, 2, voters)],
				undefined,
				seed
			);

		const first = build(7);
		expect(first.boundaryTiebreak?.rule).toBe('seeded_random');
		expect(first.boundaryTiebreak?.contested.sort()).toEqual(['twinA', 'twinB']);
		// Reproducible from the stored seed...
		expect(build(7).finalistIds).toEqual(first.finalistIds);
		// ...and genuinely random across seeds.
		const winners = new Set(
			Array.from({ length: 60 }, (_, seed) => build(seed).finalistIds[0])
		);
		expect(winners).toEqual(new Set(['twinA', 'twinB']));
	});

	it('reports no boundary tiebreak when yes-votes already separate the cut', () => {
		const result = boundary(
			movie('clear', { suggestedBy: 'v1' }),
			movie('less', { suggestedBy: 'v1' }),
			[...standing('clear', 5, 0, voters), ...standing('less', 3, 2, voters)]
		);
		expect(result.finalistIds).toEqual(['clear']);
		expect(result.boundaryTiebreak).toBeNull();
	});

	it('reports no boundary tiebreak when the boundary is not contested', () => {
		const result = computePhase1(
			phase1({
				movies: [movie('m1'), movie('m2')],
				standingVotes: [...standing('m1', 3, 2, voters), ...standing('m2', 3, 2, voters)],
				config: config({ nFinalists: 5 })
			})
		);
		expect(result.finalistIds.length).toBe(2);
		expect(result.boundaryTiebreak).toBeNull();
	});
});

describe('determinism', () => {
	const voters = V.slice(0, 5);
	const movies = [
		movie('a', { suggestedBy: 'v1', runtimeMin: 100 }),
		movie('b', { suggestedBy: 'v2', runtimeMin: 100 }),
		movie('c', { suggestedBy: 'v3', runtimeMin: 100 }),
		movie('d', { suggestedBy: 'v1', runtimeMin: 100 }),
		movie('e', { suggestedBy: 'v2', runtimeMin: 100 }),
		movie('f', { suggestedBy: 'v3', runtimeMin: 100 })
	];
	const votes = movies.flatMap((m) => standing(m.id, 3, 2, voters));
	const fairness = V.map((m) => fair(m, 1000)); // everything tied → seeded random decides

	it('never depends on insertion order', () => {
		const base = computePhase1(phase1({ movies, standingVotes: votes, fairness, seed: 4242 }));
		for (const shift of [1, 2, 3, 4, 5]) {
			const shuffled = computePhase1(
				phase1({
					movies: rotate(movies, shift),
					standingVotes: rotate(votes, shift * 3),
					fairness,
					seed: 4242
				})
			);
			expect(shuffled.finalistIds).toEqual(base.finalistIds);
		}
		const backwards = computePhase1(
			phase1({ movies: reversed(movies), standingVotes: reversed(votes), fairness, seed: 4242 })
		);
		expect(backwards.finalistIds).toEqual(base.finalistIds);
	});

	it('is stable across repeated evaluation', () => {
		const runs = Array.from({ length: 5 }, () =>
			computePhase1(phase1({ movies, standingVotes: votes, fairness, seed: 99 })).finalistIds.join()
		);
		expect(new Set(runs).size).toBe(1);
	});
});

describe('effort budget: per-round work is constant in pool size', () => {
	// voting-spec: "If any per-round step scales with the size of the pool,
	// something has been built wrong. This is a testable invariant."
	const voters = V.slice(0, 5);
	const poolSizes = [5, 20, 100, 500];

	it('the number of pairwise taps depends only on N_FINALISTS', () => {
		const counts = poolSizes.map((size) => {
			const movies = Array.from({ length: size }, (_, i) =>
				movie(`m${String(i).padStart(4, '0')}`, { suggestedBy: `v${(i % 5) + 1}`, runtimeMin: 90 + (i % 40) })
			);
			const votes = movies.flatMap((m) => standing(m.id, 3, 2, voters));
			const result = computePhase1(phase1({ movies, standingVotes: votes }));
			expect(result.finalistIds.length).toBe(5);
			return generateMatchups(result.finalistIds).length;
		});
		expect(counts).toEqual([10, 10, 10, 10]);
	});
});
