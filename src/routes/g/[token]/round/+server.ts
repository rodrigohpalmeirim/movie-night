/**
 * `GET round` — "current round, my RSVP, my pending work".
 *
 * Aggregates appear only inside `round.reveal`, which `buildRoundView` populates
 * for `decided` / `watched` rounds and nothing else.
 */

import { json } from '@sveltejs/kit';
import { requireActor } from '$lib/server/http.js';
import { getCurrentRound } from '$lib/server/services/rounds.js';
import { buildRoundView, unsubmittedAttendees } from '$lib/server/services/views.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	const actor = requireActor(event);
	const round = getCurrentRound(actor.db, actor.group.id);
	return json({
		ok: true,
		round: buildRoundView({
			db: actor.db,
			group: actor.group,
			config: actor.config,
			me: actor.member,
			round
		}),
		unsubmittedAttendeeIds:
			round && round.state === 'runoff' ? unsubmittedAttendees(actor.db, round) : []
	});
};
