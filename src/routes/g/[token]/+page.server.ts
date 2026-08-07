/**
 * The round screen (home tab) plus every lifecycle transition.
 *
 * app-spec: "Every transition is a single labeled button on the round screen
 * ('Pick finalists', 'Reveal the winner', …) with a confirm step,
 * since transitions are one-way." Form actions, so they work without JS.
 */

import { fail as formFail } from '@sveltejs/kit';
import { formBoolean, formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import {
	abandonRound,
	advanceRound,
	createRound,
	getCurrentRound,
	markWatched,
	setRsvp
} from '$lib/server/services/rounds.js';
import { buildLobbyView, buildRoundView, unsubmittedAttendees } from '$lib/server/services/views.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	const round = getCurrentRound(actor.db, actor.group.id);
	const view = buildRoundView({
		db: actor.db,
		group: actor.group,
		config: actor.config,
		me: actor.member,
		round
	});
	return {
		token: event.params.token,
		round: view,
		/**
		 * The lobby's two numbers, and only for the screens that print them: no
		 * round at all, a cancelled one, or a watched one — all three land on the
		 * same empty slot and leave a member with the same "what now". A finished
		 * night is filed in History the moment it is marked watched, so the home tab
		 * is between nights again. Every other state has its own work to show and
		 * pays nothing for this.
		 */
		lobby:
			!view || view.state === 'abandoned' || view.state === 'watched'
				? buildLobbyView({ db: actor.db, group: actor.group, me: actor.member })
				: null,
		// Powers "2 attendees haven't voted — reveal anyway?" — a participation
		// warning, never a tally, and it never blocks the transition.
		unsubmittedAttendeeIds: round && round.state === 'runoff' ? unsubmittedAttendees(actor.db, round) : []
	};
};

export const actions: Actions = {
	/**
	 * Any member can start the night — from the lobby, which is the one screen that
	 * posts here. The service is the looser of the two on purpose (it refuses only an
	 * *active* round, so a decided one does not lock the group out of ever dealing
	 * again); which screens ask is the app's rule, and it is one screen.
	 */
	createRound: async (event) => {
		const actor = requireActor(event);
		const result = createRound({
			db: actor.db,
			groupId: actor.group.id,
			actorId: actor.member.id,
			now: actor.now
		});
		return result.ok ? { roundId: result.value.id } : reject(result);
	},

	/**
	 * OPEN → RUNOFF (or straight to DECIDED for an outright winner / no clear
	 * favourite), and RUNOFF → DECIDED. A losing concurrent tap comes back as
	 * `state_changed`, which the UI can treat as "already done".
	 */
	advance: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });

		const result = advanceRound({
			db: actor.db,
			groupId: actor.group.id,
			config: actor.config,
			roundId,
			now: actor.now
		});
		if (!result.ok) return reject(result);
		return { state: result.value.round.state, transition: result.value.plan.kind };
	},

	/**
	 * "Abandon this round" in the open and runoff menus, and "We didn't watch it" (or,
	 * with nothing picked, "Clear the night away") at the bottom of the reveal: one
	 * transition, asked wherever a night can fall through.
	 */
	abandon: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });
		const result = abandonRound({ db: actor.db, groupId: actor.group.id, roundId });
		return result.ok ? { state: result.value.state } : reject(result);
	},

	/** "We watched it 🎬" — the only place fairness counters move. */
	watched: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });
		const result = markWatched({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			now: actor.now
		});
		return result.ok ? { state: result.value.state } : reject(result);
	},

	/** Self or proxy: "any member can RSVP anyone". */
	rsvp: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const roundId = formValue(data, 'round_id');
		if (!roundId) return formFail(400, { code: 'invalid_input', message: 'round_id is required' });
		const result = setRsvp({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: formValue(data, 'member_id') ?? actor.member.id,
			attending: formBoolean(data, 'attending') ?? false,
			actorId: actor.member.id,
			now: actor.now
		});
		return result.ok ? { attending: result.value.attending } : reject(result);
	}
};
