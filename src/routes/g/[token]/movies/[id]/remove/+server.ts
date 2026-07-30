/** `POST movies/[id]/remove` — any member, one confirm tap; standing votes are kept. */

import { jsonResult, requireActor } from '$lib/server/http.js';
import { removeMovie } from '$lib/server/services/movies.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
	const actor = requireActor(event);
	const result = removeMovie({
		db: actor.db,
		groupId: actor.group.id,
		movieId: event.params.id,
		actorId: actor.member.id,
		now: actor.now
	});
	if (!result.ok) return jsonResult(result);
	return jsonResult({ ok: true, value: { movieId: result.value.id, status: result.value.status } });
};
