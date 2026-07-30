/**
 * `POST movies/search { query }` — proxied TMDB search.
 *
 * The API key never leaves the server. Rate limited as an unauthenticated-ish
 * surface (anyone with the invite link can call it), and a 503 with a clear
 * message when `TMDB_API_KEY` is missing rather than a confusing 500.
 */

import { json } from '@sveltejs/kit';
import { jsonResult, readJsonBody, requireActor } from '$lib/server/http.js';
import { fail } from '$lib/server/result.js';
import { tmdbSearchLimiter } from '$lib/server/ratelimit.js';
import { getTmdb, TmdbUnavailableError } from '$lib/server/tmdb.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireActor(event);
	if (!tmdbSearchLimiter.check(event.getClientAddress()).allowed) {
		return jsonResult(fail('rate_limited', 'Too many searches — slow down a moment'));
	}

	const body = await readJsonBody(event);
	const query = typeof body.query === 'string' ? body.query : '';
	try {
		return json({ ok: true, results: await getTmdb().search(query) });
	} catch (error) {
		if (error instanceof TmdbUnavailableError) {
			return jsonResult(fail('tmdb_unavailable', 'Movie search is unavailable right now'));
		}
		throw error;
	}
};
