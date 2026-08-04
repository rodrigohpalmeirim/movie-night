/**
 * `POST movies/[id]/vote { value?, starred? }` — standing-vote upsert, stars
 * included.
 *
 * One endpoint for both, because a star is an upgraded yes rather than a second
 * answer (see `setStandingVote` for the exact resolution of the two optional
 * fields): `{ value: 'yes' }` swipes right and keeps any star, `{ starred: true }`
 * stars and therefore votes yes, `{ starred: false }` falls back to a plain yes.
 *
 * Not phase-gated: standing votes are the permanent layer and "editable at any
 * time". A vote cast during RUNOFF cannot disturb that round, whose tallies come
 * from its frozen snapshot.
 */

import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { setStandingVote } from '$lib/server/services/movies.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const actor = requireActor(event);
	const body = await readJsonBody(event);
	const result = setStandingVote({
		db: actor.db,
		groupId: actor.group.id,
		memberId: actor.member.id,
		movieId: event.params.id,
		value: body.value,
		starred: body.starred,
		now: actor.now
	});
	if (!result.ok) return jsonResult(result);
	return jsonResult({
		ok: true,
		value: {
			movieId: event.params.id,
			myVote: result.value.value,
			myStarred: result.value.starred
		}
	});
};
