/**
 * Swipe screen data: my top-up stack.
 *
 * voting-spec: "New members swipe the existing pool once during onboarding.
 * Existing members receive only a short top-up stack when movies are added." The
 * stack is therefore *my* unswiped pool movies — never the whole pool again.
 */

import { requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { setStandingVote } from '$lib/server/services/movies.js';
import { buildPoolView } from '$lib/server/services/views.js';
import { fail as formFail } from '@sveltejs/kit';
import { formValue } from '$lib/server/http.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	const pool = buildPoolView({ db: actor.db, group: actor.group, me: actor.member });
	const stack = pool.movies.filter((movie) => movie.status === 'pool' && movie.myVote === null);
	return {
		token: event.params.token,
		/** Oldest first: the backlog drains in the order it arrived. */
		stack: stack.slice().reverse(),
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
