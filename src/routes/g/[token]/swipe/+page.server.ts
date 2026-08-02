/**
 * Swipe screen data: my top-up stack.
 *
 * voting-spec: "New members swipe the existing pool once during onboarding.
 * Existing members receive only a short top-up stack when movies are added." The
 * stack is therefore *my* unswiped pool movies — never the whole pool again.
 */

import { requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { backfillDetails, mergeDetails } from '$lib/server/services/details.js';
import { setStandingVote } from '$lib/server/services/movies.js';
import { buildPoolView } from '$lib/server/services/views.js';
import { getTmdb } from '$lib/server/tmdb.js';
import { fail as formFail } from '@sveltejs/kit';
import { formValue } from '$lib/server/http.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = async (event) => {
	const actor = requireActor(event);
	const pool = buildPoolView({ db: actor.db, group: actor.group, me: actor.member });
	const stack = pool.movies.filter((movie) => movie.status === 'pool' && movie.myVote === null);
	/** Oldest first: the backlog drains in the order it arrived. */
	const ordered = stack.slice().reverse();

	// The card back prints the extras, so a deck read is one of the reads that
	// backfills them — in deck order, so the card in the hand is filled before
	// the one three down, and within a budget, so a fat top-up stack cannot turn
	// one page load into twenty TMDB calls.
	const filled = await backfillDetails({
		db: actor.db,
		tmdb: getTmdb(),
		movieIds: ordered.map((movie) => movie.id),
		now: actor.now
	});

	return {
		token: event.params.token,
		stack: mergeDetails(ordered, filled),
		poolSize: pool.movies.filter((movie) => movie.status === 'pool').length
	};
};

export const actions: Actions = {
	/** One swipe. Idempotent upsert, so re-answering just overwrites. */
	vote: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const movieId = formValue(data, 'movie_id');
		if (!movieId) return formFail(400, { code: 'invalid_input', message: 'movie_id is required' });
		const result = setStandingVote({
			db: actor.db,
			groupId: actor.group.id,
			memberId: actor.member.id,
			movieId,
			value: formValue(data, 'value'),
			now: actor.now
		});
		return result.ok ? { movieId, value: result.value.value } : reject(result);
	}
};
