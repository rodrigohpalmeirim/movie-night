/**
 * Veto screen: "One screen, five rows, one optional tap. Skippable."
 *
 * The submit is explicit even when nothing is chosen, because "done, vetoed
 * nothing" must be recorded rather than inferred from silence.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { castVeto, getCurrentRound, roundVetoesEnabled } from '$lib/server/services/rounds.js';
import { buildRoundView } from '$lib/server/services/views.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	const round = getCurrentRound(actor.db, actor.group.id);
	// Nothing to veto outside RUNOFF; send them back to the round screen.
	if (!round || round.state !== 'runoff') redirect(303, `/g/${event.params.token}`);
	// This round has no veto step (see `roundVetoesEnabled`), so this screen is not a
	// screen tonight. Straight on to the pairs, which is where the round screen's own
	// CTA points — a bookmark, a stale tab or someone else's link lands on the next
	// real step instead of a dead end.
	if (!roundVetoesEnabled(round)) redirect(303, `/g/${event.params.token}/pairs`);
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
	submit: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });
		const raw = formValue(data, 'movie_id');
		const result = castVeto({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: actor.member.id,
			// An empty value is the explicit "no veto", not a missing field.
			movieId: raw === undefined || raw === '' ? null : raw,
			now: actor.now
		});
		if (!result.ok) return reject(result);
		redirect(303, `/g/${event.params.token}/pairs`);
	}
};
