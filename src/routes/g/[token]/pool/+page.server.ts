/**
 * Pool tab: "Browsable pool + own standing votes + suggest (TMDB search) +
 * unswiped stack entry", sortable.
 *
 * Each film I have answered carries the group's standing counts (numbers only —
 * voting-spec: counts are public, voters are not), because the "Group ranking"
 * sort needs them; a film I have not answered carries none, and sorts below.
 * The list does not print them; a film's own page does.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { backfillDetails, mergeDetails } from '$lib/server/services/details.js';
import { suggestMovie } from '$lib/server/services/movies.js';
import { openRoundTheme } from '$lib/server/services/tags.js';
import { buildPoolBrowseView } from '$lib/server/services/views.js';
import { DEFAULT_POOL_SORT, parsePoolSort } from '$lib/pool-sort.js';
import { suggestLimiter, tmdbSearchLimiter } from '$lib/server/ratelimit.js';
import { getTmdb, TmdbUnavailableError } from '$lib/server/tmdb.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

/**
 * The sort lives in the URL (`?sort=title`), so it survives a reload and the
 * back button, and every sort is a plain link that works with scripting off.
 * It is also remembered in this cookie, so arriving WITHOUT one — the tab bar,
 * a film's "Back to the pool" link, the redirect after removing a film — finds
 * the list the way it was left, which is also what keeps the restored scroll
 * position pointing at the same rows. One preference per device, not per group.
 */
const SORT_COOKIE = 'pool_sort';
const SORT_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: 60 * 60 * 24 * 365
} as const;

export const load: PageServerLoad = async (event) => {
	const actor = requireActor(event);
	const pool = buildPoolBrowseView({ db: actor.db, group: actor.group, me: actor.member });

	const asked = parsePoolSort(event.url.searchParams.get('sort'));
	if (asked && asked !== event.cookies.get(SORT_COOKIE)) {
		event.cookies.set(SORT_COOKIE, asked, SORT_COOKIE_OPTIONS);
	}
	const sort = asked ?? parsePoolSort(event.cookies.get(SORT_COOKIE)) ?? DEFAULT_POOL_SORT;

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
		sort,
		/** So the UI can explain a 503 before the member types anything. */
		searchAvailable: getTmdb().configured,
		/**
		 * Tonight's theme while the round is OPEN: a film suggested now is tagged
		 * with it on the way in, and the suggest pad says so before anyone taps.
		 */
		openTheme: openRoundTheme(actor.db, actor.group.id)
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
		return {
			added: result.value.kind,
			title: result.value.movie.title,
			themedAs: result.value.themedAs?.label ?? null
		};
	}
};
