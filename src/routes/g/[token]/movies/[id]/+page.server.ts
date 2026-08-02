/** Movie detail: revise the standing vote at any time, or remove the film. */

import { error, fail as formFail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { members, movies, standingVotes } from '$lib/server/db/index.js';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { backfillDetails } from '$lib/server/services/details.js';
import { removeMovie, setStandingVote } from '$lib/server/services/movies.js';
import { getTmdb } from '$lib/server/tmdb.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = async (event) => {
	const actor = requireActor(event);
	const row = actor.db
		.select({ movie: movies, suggesterName: members.displayName })
		.from(movies)
		.leftJoin(members, eq(members.id, movies.suggestedBy))
		.where(and(eq(movies.id, event.params.id), eq(movies.groupId, actor.group.id)))
		.get();
	if (!row) error(404, 'No such film in this group');

	const myVote =
		actor.db
			.select({ value: standingVotes.value })
			.from(standingVotes)
			.where(
				and(eq(standingVotes.movieId, row.movie.id), eq(standingVotes.memberId, actor.member.id))
			)
			.get()?.value ?? null;

	// This screen is the one that prints all of it, so it is the read most worth
	// backfilling: one film, one call, cached for everyone after.
	const filled = await backfillDetails({
		db: actor.db,
		tmdb: getTmdb(),
		movieIds: [row.movie.id],
		now: actor.now
	});

	return {
		token: event.params.token,
		movie: {
			id: row.movie.id,
			title: row.movie.title,
			year: row.movie.year,
			runtimeMin: row.movie.runtimeMin,
			posterPath: row.movie.posterPath,
			status: row.movie.status,
			addedAt: row.movie.addedAt.toISOString(),
			watchedAt: row.movie.watchedAt?.toISOString() ?? null,
			suggestedBy: row.suggesterName,
			details: filled.get(row.movie.id) ?? row.movie.details ?? null
		},
		/** Only ever the viewer's own vote. */
		myVote
	};
};

export const actions: Actions = {
	/** Standing votes are "editable at any time"; no phase gate. */
	vote: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const result = setStandingVote({
			db: actor.db,
			groupId: actor.group.id,
			memberId: actor.member.id,
			movieId: event.params.id,
			value: formValue(data, 'value'),
			now: actor.now
		});
		return result.ok ? { myVote: result.value.value } : reject(result);
	},

	/** Any member, one confirm tap. Standing votes survive for a later restore. */
	remove: async (event) => {
		const actor = requireActor(event);
		const result = removeMovie({
			db: actor.db,
			groupId: actor.group.id,
			movieId: event.params.id,
			actorId: actor.member.id,
			now: actor.now
		});
		if (!result.ok) return reject(result);
		redirect(303, `/g/${event.params.token}/pool`);
	}
};
