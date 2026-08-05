/**
 * Phase 2 — veto, round robin, and the cycle tiebreak chain.
 */

import { computeTallies, attendeeSet, fairnessMap } from './phase1.js';
import { computeCopeland, computeHeadToHead, findCondorcetWinner } from './pairwise.js';
import { CYCLE_CHAIN, buildRankRow, describeDecision, rank } from './tiebreak.js';
import type {
	MemberId,
	MovieId,
	RunoffInput,
	RunoffResult,
	TallyConfig,
	VetoInput,
	VetoResult
} from './types.js';

/**
 * voting-spec, Veto:
 *   "A finalist with vetoes >= VETO_THRESHOLD is disqualified for this round."
 *   "Exception: if vetoes leave fewer than two finalists, ignore them for
 *    ranking but surface them prominently in the UI. Never reach a state with
 *    no options."
 *
 * Only attendees' vetoes count, at most one per member (DB-enforced by
 * unique (round_id, member_id); de-duplicated here too so a malformed input
 * cannot double-count). `movieId: null` is a recorded pass, not a missing vote.
 */
export function computeVeto(
	finalistIds: readonly MovieId[],
	vetoes: readonly VetoInput[],
	attendeeIds: readonly MemberId[],
	config: TallyConfig
): VetoResult {
	const attendees = attendeeSet(attendeeIds);
	const finalists = new Set(finalistIds);

	const counts: Record<MovieId, number> = {};
	for (const id of finalistIds) counts[id] = 0;

	const latest = new Map<MemberId, VetoInput>();
	for (const veto of vetoes) latest.set(veto.memberId, veto);

	const passes: MemberId[] = [];
	const effectiveVetoes: Array<{ memberId: MemberId; movieId: MovieId }> = [];
	for (const veto of latest.values()) {
		if (!attendees.has(veto.memberId)) continue;
		if (veto.movieId === null) {
			passes.push(veto.memberId);
			continue;
		}
		if (!finalists.has(veto.movieId)) continue; // veto on a non-finalist: inert
		counts[veto.movieId]++;
		effectiveVetoes.push({ memberId: veto.memberId, movieId: veto.movieId });
	}
	passes.sort();
	effectiveVetoes.sort((a, b) =>
		a.memberId === b.memberId ? a.movieId.localeCompare(b.movieId) : a.memberId.localeCompare(b.memberId)
	);

	const threshold = Math.max(1, Math.floor(config.vetoThreshold));
	const disqualifiedIds = finalistIds.filter((id) => counts[id] >= threshold);
	const survivors = finalistIds.filter((id) => counts[id] < threshold);
	// The exception only fires when vetoes are what left fewer than two finalists.
	// Without the first clause this was true for every outright-winner and
	// no-clear-favourite round — where nobody vetoed anything at all — so the UI
	// would announce that vetoes had been set aside when none had been cast.
	const vetoesIgnored = disqualifiedIds.length > 0 && survivors.length < 2;

	return {
		counts,
		passes,
		effectiveVetoes,
		disqualifiedIds,
		survivingIds: vetoesIgnored ? [...finalistIds] : survivors,
		vetoesIgnored
	};
}

/**
 * The whole of Phase 2.
 *
 * `attendeeIds` is the *current* attendee set (app-spec: "All tallies are
 * computed on read against the current attendee set"), while `finalistIds` and
 * `standingVotes` are what was frozen at OPEN → RUNOFF and are never recomputed
 * here.
 *
 * SETTLED by the amended spec: `standingVotes` MUST be the snapshot taken when
 * finalists were computed, not live rows — "This flip is forward-looking only:
 * the round's tallies are computed from a snapshot of standing votes taken when
 * finalists were computed, so a veto can never mutate the tallies of the round
 * it was cast in." The server persists that snapshot on the round
 * (`rounds.standing_snapshot`) and passes it here; `config` likewise comes from
 * `rounds.config_snapshot` so a knob edited mid-runoff cannot retro-affect it.
 *
 * Winner resolution:
 *   1. A Condorcet winner (beats every surviving finalist) wins with
 *      `tiebreak === null`.
 *   2. Otherwise the cycle chain decides: Copeland → approval → stars →
 *      rotation fairness → shortest runtime → seeded random, and the rule that
 *      separated the top two is reported.
 *
 * The star rung is the newest link and the one that reads oddly next to the old
 * "stars are a Phase 1 thing" habit: it sits below approval, so a star decides a
 * runoff only when the live pairwise vote and standing approval have both tied,
 * and it can never lift a finalist over a better-approved one. Its count is
 * attendee-scoped like every other tally here, so no absent member's star
 * reaches it.
 */
export function computeRunoff(input: RunoffInput): RunoffResult {
	const { finalistIds, attendeeIds, movies, standingVotes, vetoes, pairVotes, config, fairness, seed } = input;

	const attendees = attendeeSet(attendeeIds);
	const fair = fairnessMap(fairness);
	const movieById = new Map(movies.map((movie) => [movie.id, movie]));

	const tallies = computeTallies(movies, attendeeIds, standingVotes, config);
	const tallyById = new Map(tallies.map((tally) => [tally.movieId, tally]));

	const veto = computeVeto(finalistIds, vetoes, attendeeIds, config);
	const survivingIds = veto.survivingIds;

	const matrix = computeHeadToHead(survivingIds, pairVotes, attendeeIds);
	const copeland = computeCopeland(survivingIds, matrix);
	const condorcetWinnerId = findCondorcetWinner(survivingIds, matrix);

	if (survivingIds.length === 0) {
		return { tallies, veto, matrix, copeland, condorcetWinnerId, winnerId: null, tiebreak: null };
	}

	if (condorcetWinnerId !== null) {
		return { tallies, veto, matrix, copeland, condorcetWinnerId, winnerId: condorcetWinnerId, tiebreak: null };
	}

	const rows = rank(
		CYCLE_CHAIN,
		survivingIds.map((id) => {
			const movie = movieById.get(id);
			if (!movie) throw new Error(`computeRunoff: finalist ${id} missing from movies`);
			const tally = tallyById.get(id)!;
			return buildRankRow(
				movie,
				{
					yesVotes: tally.yesVotes,
					// Rule 3 reads this. `tally` comes from `computeTallies` over the
					// frozen snapshot and the *current* attendee set, so the count is
					// already attendee-scoped and star-for-star what the reveal prints.
					starVotes: tally.starVotes,
					approval: tally.approval,
					copeland: copeland[id] ?? 0
				},
				{ attendees, fairness: fair, seed }
			);
		})
	);

	return {
		tallies,
		veto,
		matrix,
		copeland,
		condorcetWinnerId,
		winnerId: rows[0].movieId,
		tiebreak: describeDecision(CYCLE_CHAIN, rows, 1)
	};
}
