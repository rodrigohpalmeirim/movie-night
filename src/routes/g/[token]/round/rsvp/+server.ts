/** `POST round/rsvp { member_id, attending }` — self or proxy; records who set it. */

import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { setRsvp } from '$lib/server/services/rounds.js';
import { fail } from '$lib/server/result.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const actor = requireActor(event);
	const body = await readJsonBody(event);
	const roundId = body.round_id;
	if (typeof roundId !== 'string') {
		return jsonResult(fail('invalid_input', 'round_id is required'));
	}
	return jsonResult(
		setRsvp({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: typeof body.member_id === 'string' ? body.member_id : actor.member.id,
			attending: body.attending,
			actorId: actor.member.id,
			now: actor.now
		})
	);
};
