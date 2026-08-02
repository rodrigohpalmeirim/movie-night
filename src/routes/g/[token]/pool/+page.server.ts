/**
 * Pool tab: "Browsable pool + own standing votes + suggest (TMDB search) +
 * unswiped stack entry".
 *
 * Aggregate counts are never shown here at any phase — standing votes outlive
 * rounds, so there is no point at which they become public.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { backfillDetails, mergeDetails } from '$lib/server/services/details.js';
import { suggestMovie } from '$lib/server/services/movies.js';
import { buildPoolView } from '$lib/server/services/views.js';
import { suggestLimiter, tmdbSearchLimiter } from '$lib/server/ratelimit.js';
import { getTmdb, TmdbUnavailableError } from '$lib/server/tmdb.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = async (event) => {
	const actor = requireActor(event);
	const pool = buildPoolView({ db: actor.db, group: actor.group, me: actor.member });

	// Browsing the pool warms the same cache the deck and the detail screen read
	// from, a few films at a time, so a group that predates the extras fills in
	// as it is used rather than in one batch.
	const filled = await backfillDetails({
		db: actor.db,
		tmdb: getTmdb(),
		movieIds: pool.movies.map((movie) => movie.id),
		now: actor.now
	});

	return {
		token: event.params.token,
		pool: { ...pool, movies: mergeDetails(pool.movies, filled) },
		/** So the UI can explain a 503 before the member types anything. */
		searchAvailable: getTmdb().configured
	};
};

export const actions: Actions = {
	/**
	 * No-JavaScript search path. With JS the sheet debounces straight to
	 * `POST movies/search`, which returns the same shape.
	 */
	search: async (event) => {
		requireActor(event);
		if (!tmdbSearchLimiter.check(event.getClientAddress()).allowed) {
			return formFail(429, { code: 'rate_limited', message: 'Too many searches — slow down a moment' });
		}
		const data = await event.request.formData();
		const query = formValue(data, 'query') ?? '';
		try {
			return { query, results: await getTmdb().search(query) };
		} catch (error) {
			if (error instanceof TmdbUnavailableError) {
				return formFail(503, { code: 'tmdb_unavailable', message: 'Movie search is unavailable right now' });
			}
			throw error;
		}
	},

	/** Duplicates are not errors: the outcome kind tells the UI what happened. */
	suggest: async (event) => {
		const actor = requireActor(event);
		// Each suggestion spends a TMDB detail call.
		if (!suggestLimiter.check(event.getClientAddress()).allowed) {
			return formFail(429, { code: 'rate_limited', message: 'Too many suggestions — slow down a moment' });
		}
		const data = await event.request.formData();
		const result = await suggestMovie({
			db: actor.db,
			groupId: actor.group.id,
			config: actor.config,
			actorId: actor.member.id,
			tmdbId: formValue(data, 'tmdb_id'),
			tmdb: getTmdb(),
			now: actor.now
		});
		if (!result.ok) return reject(result);
		// "Suggesting an existing pool movie just navigates to it."
		if (result.value.kind === 'exists') {
			redirect(303, `/g/${event.params.token}/movies/${result.value.movie.id}`);
		}
		return { added: result.value.kind, title: result.value.movie.title };
	}
};
