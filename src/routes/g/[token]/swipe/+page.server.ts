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
import { formBoolean, formValue } from '$lib/server/http.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

/**
 * THE INTRO REVEAL'S ONE TICKET, spent by the first swipe screen of a browser
 * session and not refunded until the browser is closed.
 *
 * The reveal deals the first card back up and turns it over on arrival, which is
 * how anyone discovers the card has a back at all. Discovered once is enough:
 * replaying it on every visit to this screen is a card that will not sit still.
 *
 * It has to be decided HERE, because the flipped card is in the server's HTML —
 * that is what stops hydration arguing about which way up the first card is. A
 * client-only memory (sessionStorage) is known one frame too late either way: the
 * server would deal the back either always or never, and the client would then
 * have to correct it in view of the reader.
 *
 * No `maxAge` and no `expires`, which is the whole trick: a session cookie lasts
 * exactly as long as the browser session the reveal is scoped to. `httpOnly` and
 * `sameSite: 'lax'` match the member cookie (see `MEMBER_COOKIE_OPTIONS`); the
 * path is the site, because there is one such cookie for the visitor and not one
 * per group — the back of a card is the same discovery in all of them.
 */
const INTRO_COOKIE = 'swipe_intro_seen';
const INTRO_COOKIE_OPTIONS = { path: '/', httpOnly: true, sameSite: 'lax' } as const;

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

	// Spend the reveal's ticket, and only if there is a card to reveal: an empty
	// stack has no back to show, so it must not burn the one chance the session
	// has of showing one. A reader who prefers reduced motion spends it too — they
	// get the card face up instantly (the page clears the flip on the first
	// effect), and what they would never want is that not-quite-a-reveal again on
	// the next visit.
	const intro = ordered.length > 0 && event.cookies.get(INTRO_COOKIE) === undefined;
	if (intro) event.cookies.set(INTRO_COOKIE, '1', INTRO_COOKIE_OPTIONS);

	return {
		token: event.params.token,
		stack: mergeDetails(ordered, filled),
		poolSize: pool.movies.filter((movie) => movie.status === 'pool').length,
		/** Is this the session's first swipe screen? See `INTRO_COOKIE`. */
		intro
	};
};

export const actions: Actions = {
	/**
	 * One swipe, or one star. Idempotent upsert, so re-answering just overwrites.
	 *
	 * The swipe screen STATES `starred` on every swipe, true or false, and it is the
	 * one surface that does. Elsewhere an omitted flag is the useful reading — a bare
	 * `yes` is an edit to an existing answer and keeps whatever star it had (see
	 * `setStandingVote`) — but here the card in the hand is the whole truth: what
	 * leaves the screen is exactly the seal that was stamped on it, so a right-swipe
	 * after undoing a star lands the plain yes the reader just saw. The flag stays
	 * optional in the action, because the no-JavaScript form posts no star at all.
	 */
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
			starred: formBoolean(data, 'starred'),
			now: actor.now
		});
		return result.ok
			? { movieId, value: result.value.value, starred: result.value.starred }
			: reject(result);
	}
};
