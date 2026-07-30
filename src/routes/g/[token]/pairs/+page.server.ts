/**
 * Pairwise screen: one pair per screen, in this member's own shuffled order.
 *
 * The order comes from the server (`me.pairOrder`, seeded from the round seed and
 * the member id) so it is stable across reloads and devices without storing it.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { castPairVote, getCurrentRound } from '$lib/server/services/rounds.js';
import { buildRoundView } from '$lib/server/services/views.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	const round = getCurrentRound(actor.db, actor.group.id);
	if (!round || round.state !== 'runoff') redirect(303, `/g/${event.params.token}`);
	return {
		token: event.params.token,
		round: buildRoundView({
			db: actor.db,
			group: actor.group,
			config: actor.config,
			me: actor.member,
			round
		})!
	};
};

export const actions: Actions = {
	/** `winner` empty = the explicit "no preference", which is information too. */
	pick: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });
		const winner = formValue(data, 'winner');
		const result = castPairVote({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: actor.member.id,
			a: formValue(data, 'a'),
			b: formValue(data, 'b'),
			winner: winner === undefined || winner === '' ? null : winner,
			now: actor.now
		});
		return result.ok ? { a: result.value.a, b: result.value.b } : reject(result);
	}
};
