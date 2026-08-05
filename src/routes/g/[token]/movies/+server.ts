/**
 * `POST movies { tmdb_id }` — suggest. Runtime is fetched server-side at save
 * time because it feeds tiebreak rule 5.
 *
 * The response's `kind` tells the client which of the spec's four duplicate
 * behaviours happened: created / exists (navigate to it) / restored / rewatch.
 */

import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { fail } from '$lib/server/result.js';
import { suggestLimiter } from '$lib/server/ratelimit.js';
import { suggestMovie } from '$lib/server/services/movies.js';
import { getTmdb } from '$lib/server/tmdb.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const actor = requireActor(event);
	// Each suggestion spends a TMDB detail call, so it gets its own bucket.
	if (!suggestLimiter.check(event.getClientAddress()).allowed) {
		return jsonResult(fail('rate_limited', 'Too many suggestions — slow down a moment'));
	}
	const body = await readJsonBody(event);
	const result = await suggestMovie({
		db: actor.db,
		groupId: actor.group.id,
		config: actor.config,
		actorId: actor.member.id,
		tmdbId: body.tmdb_id,
		tmdb: getTmdb(),
		now: actor.now
	});
	return jsonResult(result);
};
