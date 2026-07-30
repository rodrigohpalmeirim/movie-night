/** `POST round/pair { a, b, winner | null }` — phase-gated; `winner: null` = no preference. */

import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { castPairVote } from '$lib/server/services/rounds.js';
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
		castPairVote({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: actor.member.id,
			a: body.a,
			b: body.b,
			winner: body.winner ?? null,
			now: actor.now
		})
	);
};
