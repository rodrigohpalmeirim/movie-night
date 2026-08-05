import { describe, expect, it } from 'vitest';
import { computeRunoff, computeVeto } from './runoff.js';
import { generateMatchups } from './pairwise.js';
import { config, fair, matrixVotes, members, movie, reversed, rotate, standing, veto, type MatrixRow } from './testing.js';
import type { MovieInput, RunoffInput, StandingVoteInput } from './types.js';

const ATTENDEES = members(6); // v1..v6
const ALL = members(9); // v1..v9 — v7..v9 exist but are not attending

/** `{ mA: [yes, no] }` → standing votes among the attendees. */
function approvals(spec: Record<string, [number, number]>): StandingVoteInput[] {
	return Object.entries(spec).flatMap(([movieId, [yes, no]]) => standing(movieId, yes, no, ATTENDEES));
}

function runoff(overrides: Partial<RunoffInput> = {}): RunoffInput {
	return {
		finalistIds: [],
		attendeeIds: ATTENDEES,
		movies: [],
		standingVotes: [],
		vetoes: [],
		pairVotes: [],
		config: config(),
		fairness: ALL.map((m, i) => fair(m, 1000 + i)),
		seed: 20240730,
		...overrides
	};
}

/* ------------------------------------------------------------------ */
/* Veto                                                               */
/* ------------------------------------------------------------------ */

describe('veto', () => {
	const finalists = ['mA', 'mB', 'mC', 'mD', 'mE'];

	it('disqualifies a finalist at VETO_THRESHOLD = 1', () => {
		const result = computeVeto(finalists, [veto('v1', 'mC')], ATTENDEES, config());
		expect(result.counts).toEqual({ mA: 0, mB: 0, mC: 1, mD: 0, mE: 0 });
		expect(result.disqualifiedIds).toEqual(['mC']);
		expect(result.survivingIds).toEqual(['mA', 'mB', 'mD', 'mE']);
		expect(result.vetoesIgnored).toBe(false);
	});

	it('respects a raised VETO_THRESHOLD', () => {
		const cfg = config({ vetoThreshold: 2 });
		const one = computeVeto(finalists, [veto('v1', 'mC')], ATTENDEES, cfg);
		expect(one.disqualifiedIds).toEqual([]);
		const two = computeVeto(finalists, [veto('v1', 'mC'), veto('v2', 'mC')], ATTENDEES, cfg);
		expect(two.disqualifiedIds).toEqual(['mC']);
	});

	it('clamps a nonsensical threshold of 0 to 1', () => {
		const result = computeVeto(finalists, [], ATTENDEES, config({ vetoThreshold: 0 }));
		expect(result.disqualifiedIds).toEqual([]);
	});

	it('records an explicit "no veto" pass and counts nothing', () => {
		const result = computeVeto(finalists, [veto('v1', null), veto('v2', null)], ATTENDEES, config());
		expect(result.passes).toEqual(['v1', 'v2']);
		expect(result.disqualifiedIds).toEqual([]);
	});

	it('ignores vetoes from non-attendees', () => {
		const result = computeVeto(finalists, [veto('v9', 'mA')], ATTENDEES, config());
		expect(result.counts.mA).toBe(0);
		expect(result.disqualifiedIds).toEqual([]);
	});

	it('ignores a veto on something that is not a finalist', () => {
		const result = computeVeto(finalists, [veto('v1', 'notAFinalist')], ATTENDEES, config());
		expect(result.disqualifiedIds).toEqual([]);
		expect(Object.keys(result.counts).sort()).toEqual([...finalists].sort());
	});

	it('counts one veto per member even if handed several', () => {
		const result = computeVeto(
			finalists,
			[veto('v1', 'mA'), veto('v1', 'mB')], // changed their mind
			ATTENDEES,
			config()
		);
		expect(result.counts).toMatchObject({ mA: 0, mB: 1 });
	});

	it('ignores vetoes for ranking when they would leave fewer than two finalists', () => {
		// voting-spec exception: "Never reach a state with no options."
		const result = computeVeto(
			['mA', 'mB', 'mC'],
			[veto('v1', 'mA'), veto('v2', 'mB')],
			ATTENDEES,
			config()
		);
		expect(result.vetoesIgnored).toBe(true);
		expect(result.survivingIds).toEqual(['mA', 'mB', 'mC']);
		// ...but still surfaces them for the UI.
		expect(result.disqualifiedIds).toEqual(['mA', 'mB']);
	});

	it('ignores vetoes when every finalist is vetoed', () => {
		const result = computeVeto(
			['mA', 'mB', 'mC'],
			[veto('v1', 'mA'), veto('v2', 'mB'), veto('v3', 'mC')],
			ATTENDEES,
			config()
		);
		expect(result.vetoesIgnored).toBe(true);
		expect(result.survivingIds).toEqual(['mA', 'mB', 'mC']);
		expect(result.disqualifiedIds).toEqual(['mA', 'mB', 'mC']);
	});

	it('reports the standing-vote flips the veto step owes', () => {
		// voting-spec: "Vetoing sets the voter's standing vote on that movie to
		// 'no', so the two layers can never contradict each other."
		const result = computeVeto(
			finalists,
			[veto('v2', 'mA'), veto('v1', 'mB'), veto('v3', null), veto('v9', 'mC'), veto('v4', 'notAFinalist')],
			ATTENDEES,
			config()
		);
		expect(result.effectiveVetoes).toEqual([
			{ memberId: 'v1', movieId: 'mB' },
			{ memberId: 'v2', movieId: 'mA' }
		]);
	});

	it('still owes the standing-vote flip when vetoes are ignored for ranking', () => {
		const result = computeVeto(
			['mA', 'mB'],
			[veto('v1', 'mA'), veto('v2', 'mB')],
			ATTENDEES,
			config()
		);
		expect(result.vetoesIgnored).toBe(true);
		// The exception suppresses disqualification, not the voter's position.
		expect(result.effectiveVetoes).toEqual([
			{ memberId: 'v1', movieId: 'mA' },
			{ memberId: 'v2', movieId: 'mB' }
		]);
	});

	it('owes no flip for a veto that does not count', () => {
		const result = computeVeto(finalists, [veto('v9', 'mA'), veto('v1', null)], ATTENDEES, config());
		expect(result.effectiveVetoes).toEqual([]);
	});

	it('does NOT claim vetoes were ignored when nobody vetoed anything', () => {
		// The predicate used to be `survivors.length < 2` alone, which is true for
		// every outright-winner and no-clear-favourite round — where no veto exists
		// at all — so the UI announced that vetoes had been set aside when none had
		// been cast.
		for (const finalists of [[], ['mA'], ['mA', 'mB']]) {
			const result = computeVeto(finalists, [], ATTENDEES, config());
			expect(result.vetoesIgnored, `finalists=${finalists.length}`).toBe(false);
			expect(result.disqualifiedIds).toEqual([]);
		}
		// A recorded pass is still not a veto.
		expect(computeVeto(['mA'], [veto('v1', null)], ATTENDEES, config()).vetoesIgnored).toBe(false);
		// An ignored veto from a non-attendee is not a veto either.
		expect(computeVeto(['mA'], [veto('v9', 'mA')], ATTENDEES, config()).vetoesIgnored).toBe(false);
		// ...but a real one that leaves fewer than two finalists is.
		expect(computeVeto(['mA', 'mB'], [veto('v1', 'mA')], ATTENDEES, config()).vetoesIgnored).toBe(
			true
		);
	});

	it('keeps exactly two survivors without triggering the exception', () => {
		const result = computeVeto(['mA', 'mB', 'mC'], [veto('v1', 'mC')], ATTENDEES, config());
		expect(result.vetoesIgnored).toBe(false);
		expect(result.survivingIds).toEqual(['mA', 'mB']);
	});
});

/* ------------------------------------------------------------------ */
/* Condorcet path                                                     */
/* ------------------------------------------------------------------ */

describe('runoff: Condorcet winner', () => {
	const movies = [movie('mA'), movie('mB'), movie('mC')];
	const finalistIds = ['mA', 'mB', 'mC'];

	it('wins with no tiebreak rule recorded', () => {
		const rows: MatrixRow[] = [
			['mA', 'mB', 4, 2, 0],
			['mA', 'mC', 5, 1, 0],
			['mB', 'mC', 4, 1, 1]
		];
		const result = computeRunoff(
			runoff({ finalistIds, movies, pairVotes: matrixVotes(rows, ATTENDEES) })
		);
		expect(result.condorcetWinnerId).toBe('mA');
		expect(result.winnerId).toBe('mA');
		expect(result.tiebreak).toBeNull();
		expect(result.matrix.length).toBe(3);
	});

	it('excludes a vetoed movie even when it would have won the round robin', () => {
		const rows: MatrixRow[] = [
			['mA', 'mB', 6, 0, 0],
			['mA', 'mC', 6, 0, 0],
			['mB', 'mC', 4, 2, 0]
		];
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies,
				pairVotes: matrixVotes(rows, ATTENDEES),
				vetoes: [veto('v1', 'mA')]
			})
		);
		expect(result.veto.disqualifiedIds).toEqual(['mA']);
		expect(result.winnerId).toBe('mB');
		// The disqualified movie is not even in the round robin.
		expect(result.matrix.length).toBe(1);
	});

	it('a lone survivor wins without a tiebreak', () => {
		const result = computeRunoff(runoff({ finalistIds: ['mA'], movies }));
		expect(result.winnerId).toBe('mA');
		expect(result.tiebreak).toBeNull();
		expect(result.matrix).toEqual([]);
	});

	it('returns no winner when there are no finalists at all', () => {
		const result = computeRunoff(runoff({ finalistIds: [], movies }));
		expect(result.winnerId).toBeNull();
		expect(result.tiebreak).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* Cycle tiebreak chain                                               */
/* ------------------------------------------------------------------ */

/** A -> B -> C -> A. Copeland is 1 for all three, so rule 1 cannot decide. */
const THREE_WAY_CYCLE: MatrixRow[] = [
	['mA', 'mB', 4, 2, 0],
	['mB', 'mC', 4, 2, 0],
	['mA', 'mC', 2, 4, 0]
];

describe('runoff: cycle tiebreak chain', () => {
	const finalistIds = ['mA', 'mB', 'mC'];

	it('detects the cycle rather than crashing', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: finalistIds.map((id) => movie(id)),
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.condorcetWinnerId).toBeNull();
		expect(result.copeland).toEqual({ mA: 1, mB: 1, mC: 1 });
		expect(result.winnerId).not.toBeNull();
	});

	it('rule 1 — Copeland: most pairwise victories wins', () => {
		// A beats B and C, ties D; C beats B; B beats D; C ties D.
		// Copeland: A 2, B 1, C 1, D 0 — and A is not a Condorcet winner.
		const ids = ['mA', 'mB', 'mC', 'mD'];
		const rows: MatrixRow[] = [
			['mA', 'mB', 4, 2, 0],
			['mA', 'mC', 4, 2, 0],
			['mA', 'mD', 3, 3, 0],
			['mB', 'mC', 2, 4, 0],
			['mB', 'mD', 4, 2, 0],
			['mC', 'mD', 3, 3, 0]
		];
		const result = computeRunoff(
			runoff({
				finalistIds: ids,
				movies: ids.map((id) => movie(id)),
				pairVotes: matrixVotes(rows, ATTENDEES),
				// Give a *worse* approval to the Copeland leader to prove rule 1 runs first.
				standingVotes: approvals({ mA: [3, 3], mB: [6, 0], mC: [6, 0], mD: [6, 0] })
			})
		);
		expect(result.condorcetWinnerId).toBeNull();
		expect(result.copeland).toEqual({ mA: 2, mB: 1, mC: 1, mD: 0 });
		expect(result.winnerId).toBe('mA');
		expect(result.tiebreak?.rule).toBe('copeland');
		expect(result.tiebreak?.contested.sort()).toEqual(ids);
	});

	it('rule 2 — approval: the higher-approved finalist wins a Copeland tie', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: finalistIds.map((id) => movie(id)),
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [3, 3], mB: [6, 0], mC: [4, 2] })
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('approval');
		expect(result.tiebreak?.contested.slice().sort()).toEqual(['mA', 'mB', 'mC']);
	});

	it('rule 2 uses the approval ratio, not the raw yes-count', () => {
		// mA: 3 of 3 voters who saw it = 1.0. mC: 4 of 6 = 0.667.
		// A raw yes-count comparison would pick mC.
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: finalistIds.map((id) => movie(id)),
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [3, 0], mB: [1, 5], mC: [4, 2] })
			})
		);
		expect(result.tallies.find((t) => t.movieId === 'mA')?.approval).toBe(1);
		expect(result.winnerId).toBe('mA');
		expect(result.tiebreak?.rule).toBe('approval');
	});

	it('rule 3 — stars: the more-starred finalist wins a Copeland-and-approval tie', () => {
		// Every approval identical, so rule 2 separates nothing and the star rung is
		// the first thing that can. Runtime would have picked mA under the old
		// chain, where Phase 2 never looked at a star.
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1', runtimeMin: 95 }),
					movie('mB', { suggestedBy: 'v1', runtimeMin: 150 }),
					movie('mC', { suggestedBy: 'v1', runtimeMin: 120 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: [
					...standing('mA', 4, 2, ATTENDEES, 0),
					...standing('mB', 4, 2, ATTENDEES, 2),
					...standing('mC', 4, 2, ATTENDEES, 1)
				]
			})
		);
		expect(result.copeland).toEqual({ mA: 1, mB: 1, mC: 1 });
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('stars');
		expect(result.tiebreak?.contested.slice().sort()).toEqual(['mA', 'mB', 'mC']);
	});

	it('rule 4 — rotation fairness: the attendee who has waited longest', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				// mB's suggester joined first and has never won.
				movies: [
					movie('mA', { suggestedBy: 'v3' }),
					movie('mB', { suggestedBy: 'v1' }),
					movie('mC', { suggestedBy: 'v2' })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] }),
				fairness: [fair('v1', 1000), fair('v2', 2000), fair('v3', 3000), ...ALL.slice(3).map((m) => fair(m, 4000))]
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 4 measures a past winner from their last win, never-won members from their join date', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1' }), // joined first, but won recently
					movie('mB', { suggestedBy: 'v2' }), // joined later, never won
					movie('mC', { suggestedBy: 'v3' }) // joined last, never won
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] }),
				fairness: [
					fair('v1', 1000, 9000),
					fair('v2', 2000, null),
					fair('v3', 3000, null),
					...ALL.slice(3).map((m) => fair(m, 4000))
				]
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 4 gives a brand-new member no head start', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1' }), // joined long ago, never won
					movie('mB', { suggestedBy: 'v2' }), // joined this afternoon
					movie('mC', { suggestedBy: 'v3' })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] }),
				fairness: [
					fair('v1', 1000, null),
					fair('v2', 999_000, null),
					fair('v3', 500_000, null),
					...ALL.slice(3).map((m) => fair(m, 999_000))
				]
			})
		);
		expect(result.winnerId).toBe('mA');
	});

	it('rule 4 is restricted to attendees', () => {
		// v9 joined at the dawn of time and has never won, but is not coming
		// tonight: no "owed a win" credit for nights they skipped.
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v9' }),
					movie('mB', { suggestedBy: 'v2' }),
					movie('mC', { suggestedBy: 'v3' })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] }),
				fairness: [...ALL.map((m) => fair(m, 9000)), fair('v9', 1), fair('v2', 5000)]
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('rotation_fairness');
	});

	it('rule 4 falls through when no suggester has a claim', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v9', runtimeMin: 150 }),
					movie('mB', { suggestedBy: 'v8', runtimeMin: 95 }),
					movie('mC', { suggestedBy: 'v7', runtimeMin: 120 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('shortest_runtime');
	});

	it('rule 5 — shortest runtime', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1', runtimeMin: 150 }),
					movie('mB', { suggestedBy: 'v1', runtimeMin: 95 }),
					movie('mC', { suggestedBy: 'v1', runtimeMin: 120 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('shortest_runtime');
		expect(result.tiebreak?.contested.slice().sort()).toEqual(['mA', 'mB', 'mC']);
	});

	it('rule 5 ranks an unknown runtime last', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1', runtimeMin: null }),
					movie('mB', { suggestedBy: 'v1', runtimeMin: null }),
					movie('mC', { suggestedBy: 'v1', runtimeMin: 220 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.winnerId).toBe('mC');
		expect(result.tiebreak?.rule).toBe('shortest_runtime');
	});

	it('rule 6 — seeded random, reproducible and recorded', () => {
		const identical: MovieInput[] = finalistIds.map((id) => movie(id, { suggestedBy: 'v1', runtimeMin: 100 }));
		const build = (seed: number) =>
			computeRunoff(
				runoff({
					finalistIds,
					movies: identical,
					pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
					standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] }),
					seed
				})
			);

		const first = build(31337);
		expect(first.tiebreak?.rule).toBe('seeded_random');
		expect(first.tiebreak?.contested.sort()).toEqual(['mA', 'mB', 'mC']);
		// Same seed → same winner, forever.
		expect(build(31337).winnerId).toBe(first.winnerId);
		// Across seeds every finalist can win.
		const winners = new Set(Array.from({ length: 120 }, (_, seed) => build(seed).winnerId));
		expect(winners).toEqual(new Set(['mA', 'mB', 'mC']));
	});

	it('falls all the way to seeded random when nobody voted at all', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: finalistIds.map((id) => movie(id, { suggestedBy: 'v1', runtimeMin: 100 })),
				pairVotes: [],
				standingVotes: approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.copeland).toEqual({ mA: 0, mB: 0, mC: 0 });
		expect(result.tiebreak?.rule).toBe('seeded_random');
		expect(finalistIds).toContain(result.winnerId!);
	});

	it('does not depend on input order', () => {
		const movies = [
			movie('mA', { suggestedBy: 'v1', runtimeMin: 100 }),
			movie('mB', { suggestedBy: 'v2', runtimeMin: 100 }),
			movie('mC', { suggestedBy: 'v3', runtimeMin: 100 })
		];
		const pairVotes = matrixVotes(THREE_WAY_CYCLE, ATTENDEES);
		const standingVotes = approvals({ mA: [4, 2], mB: [4, 2], mC: [4, 2] });
		const fairness = ALL.map((m) => fair(m, 1000)); // all tied → seeded random
		const base = computeRunoff(runoff({ finalistIds, movies, pairVotes, standingVotes, fairness }));

		for (const shift of [1, 2]) {
			const shuffled = computeRunoff(
				runoff({
					finalistIds: rotate(finalistIds, shift),
					movies: rotate(movies, shift),
					pairVotes: rotate(pairVotes, shift * 2),
					standingVotes: rotate(standingVotes, shift * 3),
					fairness
				})
			);
			expect(shuffled.winnerId).toBe(base.winnerId);
			expect(shuffled.tiebreak?.rule).toBe(base.tiebreak?.rule);
		}
		const backwards = computeRunoff(
			runoff({
				finalistIds: reversed(finalistIds),
				movies: reversed(movies),
				pairVotes: reversed(pairVotes),
				standingVotes: reversed(standingVotes),
				fairness
			})
		);
		expect(backwards.winnerId).toBe(base.winnerId);
	});
});

/* ------------------------------------------------------------------ */
/* Stars: a runoff rung, but the one below approval                   */
/* ------------------------------------------------------------------ */

describe('runoff: stars are rule 3, below approval', () => {
	// voting-spec, Tally rule 3: "more `star_votes` among attendees wins. Below
	// approval and not above it: a star may separate finalists that both the
	// pairwise vote and standing approval have tied, and never promotes a film
	// past a better-approved one."
	const finalistIds = ['mA', 'mB', 'mC'];

	/** Every Phase 1 number tied except the stars, so rule 3 is the first live rung. */
	function stars(spec: Record<string, number>) {
		return Object.entries(spec).flatMap(([movieId, count]) => standing(movieId, 4, 2, ATTENDEES, count));
	}

	it('a star never beats a better approval, at any star distribution', () => {
		// mC is unstarred and best-approved (6 of 6); mA and mB carry every star
		// there is. Approval is rule 2, so it decides before the stars are read.
		for (const spec of [
			{ mA: 4, mB: 0 },
			{ mA: 0, mB: 4 },
			{ mA: 1, mB: 2 }
		]) {
			const result = computeRunoff(
				runoff({
					finalistIds,
					movies: finalistIds.map((id) => movie(id, { suggestedBy: 'v1', runtimeMin: 100 })),
					pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
					standingVotes: [
						...standing('mA', 4, 2, ATTENDEES, spec.mA),
						...standing('mB', 4, 2, ATTENDEES, spec.mB),
						...standing('mC', 6, 0, ATTENDEES, 0)
					]
				})
			);
			expect(result.winnerId, JSON.stringify(spec)).toBe('mC');
			expect(result.tiebreak?.rule).toBe('approval');
		}
	});

	it('stars separate only what approval has already tied', () => {
		// Rule 2 narrows to the two 100%-approved films and drops the most-starred
		// film of the night; rule 3 then picks between the survivors. So the winner
		// is not the film with the most stars — it is the better-approved film that
		// happens to hold one.
		const ids = ['mA', 'mB', 'mC'];
		const result = computeRunoff(
			runoff({
				finalistIds: ids,
				movies: ids.map((id) => movie(id, { suggestedBy: 'v1', runtimeMin: 100 })),
				// Nobody compared anything: Copeland is 0 across the board, so rule 1
				// separates nothing and there is no Condorcet winner.
				pairVotes: [],
				standingVotes: [
					...standing('mA', 6, 0, ATTENDEES, 0),
					...standing('mB', 6, 0, ATTENDEES, 1),
					...standing('mC', 4, 2, ATTENDEES, 4)
				]
			})
		);
		expect(result.copeland).toEqual({ mA: 0, mB: 0, mC: 0 });
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('stars');
		// mC held four stars and never made it past rule 2.
		expect(result.tiebreak?.contested.slice().sort()).toEqual(['mA', 'mB']);
	});

	it('an absent member’s star cannot decide a runoff', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1', runtimeMin: 95 }),
					movie('mB', { suggestedBy: 'v1', runtimeMin: 150 }),
					movie('mC', { suggestedBy: 'v1', runtimeMin: 120 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: [
					...stars({ mA: 0, mB: 1, mC: 0 }),
					// v7 and v8 are not attending: two starred yeses on mA that count for
					// nothing, exactly as their yeses do.
					...standing('mA', 2, 0, ['v7', 'v8'], 2)
				]
			})
		);
		expect(result.tallies.find((t) => t.movieId === 'mA')?.starVotes).toBe(0);
		expect(result.winnerId).toBe('mB');
		expect(result.tiebreak?.rule).toBe('stars');
	});

	it('an equal star count separates nothing and falls through', () => {
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: [
					movie('mA', { suggestedBy: 'v1', runtimeMin: 180 }),
					movie('mB', { suggestedBy: 'v1', runtimeMin: 150 }),
					movie('mC', { suggestedBy: 'v1', runtimeMin: 95 })
				],
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: stars({ mA: 2, mB: 2, mC: 2 })
			})
		);
		expect(result.winnerId).toBe('mC');
		expect(result.tiebreak?.rule).toBe('shortest_runtime');
	});

	it('still counts stars in the recomputed tallies, for the reveal', () => {
		// The runoff reports Phase 1 numbers for the reveal screen; `starVotes` is
		// among them. Reporting is not deciding.
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies: finalistIds.map((id) => movie(id, { suggestedBy: 'v1' })),
				pairVotes: matrixVotes(THREE_WAY_CYCLE, ATTENDEES),
				standingVotes: stars({ mA: 3, mB: 1, mC: 0 })
			})
		);
		expect(result.tallies.map((t) => t.starVotes)).toEqual([3, 1, 0]);
	});
});

/* ------------------------------------------------------------------ */
/* Attendance interaction                                             */
/* ------------------------------------------------------------------ */

describe('runoff: tallies follow the current attendee set', () => {
	const finalistIds = ['mA', 'mB', 'mC'];
	const movies = finalistIds.map((id) => movie(id, { suggestedBy: 'v1', runtimeMin: 100 }));

	it('an RSVP-out stops counting in the pairwise tally', () => {
		const rows: MatrixRow[] = [
			['mA', 'mB', 1, 0, 0], // v1 prefers mA
			['mA', 'mC', 1, 0, 0],
			['mB', 'mC', 1, 0, 0]
		];
		const pairVotes = matrixVotes(rows, ['v1']);
		const withV1 = computeRunoff(runoff({ finalistIds, movies, pairVotes, attendeeIds: ['v1', 'v2', 'v3'] }));
		expect(withV1.winnerId).toBe('mA');
		expect(withV1.condorcetWinnerId).toBe('mA');

		const withoutV1 = computeRunoff(runoff({ finalistIds, movies, pairVotes, attendeeIds: ['v2', 'v3'] }));
		expect(withoutV1.condorcetWinnerId).toBeNull();
		expect(withoutV1.matrix.every((m) => m.aWins === 0 && m.bWins === 0)).toBe(true);
	});

	it('a late RSVP-in has their standing approvals counted', () => {
		const pairVotes = matrixVotes(THREE_WAY_CYCLE, ATTENDEES);
		const standingVotes = [...standing('mA', 1, 0, ['v6']), ...approvals({ mB: [3, 3], mC: [3, 3] })];
		const result = computeRunoff(runoff({ finalistIds, movies, pairVotes, standingVotes }));
		expect(result.tallies.find((t) => t.movieId === 'mA')?.approval).toBe(1);
		expect(result.winnerId).toBe('mA');
	});

	it('the finalist set is never recomputed from attendance', () => {
		// Even a finalist nobody now approves of stays in the round robin.
		const rows: MatrixRow[] = [
			['mA', 'mB', 0, 6, 0],
			['mA', 'mC', 0, 6, 0],
			['mB', 'mC', 4, 2, 0]
		];
		const result = computeRunoff(
			runoff({
				finalistIds,
				movies,
				pairVotes: matrixVotes(rows, ATTENDEES),
				standingVotes: approvals({ mA: [0, 6], mB: [4, 2], mC: [4, 2] })
			})
		);
		expect(result.matrix.length).toBe(3);
		expect(result.winnerId).toBe('mB');
	});
});

describe('runoff: effort budget', () => {
	it('the number of pairs asked never exceeds 10', () => {
		for (const n of [2, 3, 4, 5]) {
			const ids = Array.from({ length: n }, (_, i) => `m${i}`);
			expect(generateMatchups(ids).length).toBeLessThanOrEqual(10);
		}
	});
});
