/**
 * `POST round/veto { movie_id | null }` — phase-gated to RUNOFF, one row per
 * (round, member) via the primary key, `null` = explicit "no veto".
 */

import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { castVeto } from '$lib/server/services/rounds.js';
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
		castVeto({
			db: actor.db,
			groupId: actor.group.id,
			roundId,
			memberId: actor.member.id,
			movieId: body.movie_id ?? null,
			now: actor.now
		})
	);
};
