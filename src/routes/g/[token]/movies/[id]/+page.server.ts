/**
 * Movie detail: revise the standing vote at any time, tag or untag the film, or
 * remove it — and see where the group stands on it, as counts.
 */

import { error, fail as formFail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { members, movies, standingVotes } from '$lib/server/db/index.js';
import { formBoolean, formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { backfillDetails } from '$lib/server/services/details.js';
import { removeMovie, setStandingVote } from '$lib/server/services/movies.js';
import {
	addMovieTag,
	groupTagSummaries,
	loadMovieTags,
	removeMovieTag
} from '$lib/server/services/tags.js';
import { loadVoteCounts } from '$lib/server/services/views.js';
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

	const mine = actor.db
		.select({ value: standingVotes.value, starred: standingVotes.starred })
		.from(standingVotes)
		.where(and(eq(standingVotes.movieId, row.movie.id), eq(standingVotes.memberId, actor.member.id)))
		.get();

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
			details: filled.get(row.movie.id) ?? row.movie.details ?? null,
			tags: loadMovieTags(actor.db, actor.group.id).get(row.movie.id) ?? []
		},
		/**
		 * What the tag picker offers: the presets, always, and every tag the group
		 * already uses — so the second film tagged "Sci-fi" is one tap, spelled the
		 * way the first one was.
		 */
		tagSuggestions: groupTagSummaries(actor.db, actor.group.id),
		/** The only vote attributed to anyone: the viewer's own — and their own star on it. */
		myVote: mine?.value ?? null,
		myStarred: mine?.starred === true,
		/**
		 * The group's standing counts on this film, over its CURRENT members:
		 * four numbers, no names (voting-spec: counts are public, voters are not).
		 * Null until the viewer has answered (yes, starred or no), so a first
		 * answer given here is their own — enforced here, not by the screen. A vote
		 * from this page re-runs this load (the form's invalidation), which is
		 * what brings them in.
		 */
		voteCounts: mine
			? loadVoteCounts(actor.db, actor.group.id, [row.movie.id]).get(row.movie.id)!
			: null
	};
};

export const actions: Actions = {
	/**
	 * Standing votes are "editable at any time"; no phase gate. The same action
	 * carries the star: `starred` absent = a plain vote that preserves the existing
	 * star, `true`/`false` = star / unstar (see `setStandingVote`).
	 */
	vote: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const result = setStandingVote({
			db: actor.db,
			groupId: actor.group.id,
			memberId: actor.member.id,
			movieId: event.params.id,
			value: formValue(data, 'value'),
			starred: formBoolean(data, 'starred'),
			now: actor.now
		});
		return result.ok
			? { myVote: result.value.value, myStarred: result.value.starred }
			: reject(result);
	},

	/**
	 * Any member may tag any film — the same trust as removing one. Normalised by
	 * the service, so "halloween " lands as the group's "Halloween", and tagging a
	 * film with a tag it already carries is a no-op.
	 */
	tag: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const result = addMovieTag({
			db: actor.db,
			groupId: actor.group.id,
			movieId: event.params.id,
			label: formValue(data, 'label') ?? '',
			actorId: actor.member.id,
			now: actor.now
		});
		return result.ok ? { tagged: result.value.label } : reject(result);
	},

	/** And untag it. Idempotent, so two members tapping the same chip is fine. */
	untag: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const result = removeMovieTag({
			db: actor.db,
			groupId: actor.group.id,
			movieId: event.params.id,
			tag: formValue(data, 'tag') ?? ''
		});
		return result.ok ? { untagged: true } : reject(result);
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
