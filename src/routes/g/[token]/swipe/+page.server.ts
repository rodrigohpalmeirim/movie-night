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
import { openRoundTheme } from '$lib/server/services/tags.js';
import { buildPoolView } from '$lib/server/services/views.js';
import { themedFirst } from '$lib/tags.js';
import { getTmdb } from '$lib/server/tmdb.js';
import { fail as formFail } from '@sveltejs/kit';
import { formBoolean, formValue } from '$lib/server/http.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

/**
 * THE GESTURE COACH'S ONE SHOWING, per device: a cookie saying this browser has
 * already been shown how the deck is played, and dismissed it.
 *
 * Nothing on a card advertises that it turns over or that it can be pushed up,
 * so the screen says so once — all four gestures at once, over a dimmed deck —
 * and then gets out of the way for good. Once per DEVICE, not per session: the
 * gestures are the same tomorrow, and a lesson replayed on every visit is a
 * screen you have to clear before you can use it. The `?` beside the card count
 * brings it back for anyone who wants it again.
 *
 * It has to be decided HERE, because the overlay is in the server's HTML — that
 * is what lets the first paint be the right one. A client-only memory
 * (localStorage) is known one frame too late either way: the server would print
 * the overlay always or never, and the client would then have to take it away,
 * or put it up, in view of the reader.
 *
 * Written when the coach is DISMISSED, not when it is shown (see the `coachSeen`
 * action), so a tab closed before anyone read it has not spent it. A year, like
 * the member cookie (`MEMBER_COOKIE_OPTIONS`), with the same `httpOnly` and
 * `sameSite: 'lax'` — the client never needs to read it, the load does. The path
 * is the site, because there is one such cookie for the visitor and not one per
 * group: the deck is played the same way in all of them.
 *
 * A new name, not the old `swipe_intro_seen`: that one was a SESSION cookie
 * meaning "the first card has turned itself over this session", and reading it
 * as "this device has been coached" would skip the lesson for exactly the people
 * who were last here before it existed.
 */
const COACH_COOKIE = 'swipe_coach_seen';
const COACH_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: 60 * 60 * 24 * 365
} as const;

export const load: PageServerLoad = async (event) => {
	const actor = requireActor(event);
	const pool = buildPoolView({ db: actor.db, group: actor.group, me: actor.member });
	const stack = pool.movies.filter((movie) => movie.status === 'pool' && movie.myVote === null);
	/**
	 * Oldest first: the backlog drains in the order it arrived — except that during
	 * a themed OPEN round the theme's films come up first (still oldest first among
	 * themselves). Those are the only cards tonight's finalists can come from, so a
	 * member who swipes five cards before the night starts has swiped the five that
	 * count. Nothing is hidden: the rest of the deck follows, as standing as ever.
	 */
	const theme = openRoundTheme(actor.db, actor.group.id);
	const ordered = themedFirst(stack.slice().reverse(), theme?.key);

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

	// Only with a card on the table: an empty deck has nothing to swipe, so the
	// lesson would be about nothing — and since it is only spent on dismissal, it
	// is still owed the next time there is a card to play it over.
	const coach = ordered.length > 0 && event.cookies.get(COACH_COOKIE) === undefined;

	return {
		token: event.params.token,
		stack: mergeDetails(ordered, filled),
		poolSize: pool.movies.filter((movie) => movie.status === 'pool').length,
		/** Tonight's theme while the round is OPEN, so the deck can say why it is ordered so. */
		theme,
		/** Has this device yet to be shown the gestures? See `COACH_COOKIE`. */
		coach
	};
};

export const actions: Actions = {
	/**
	 * The gesture coach was dismissed: spend its one showing (see `COACH_COOKIE`).
	 *
	 * Every way out of the overlay posts here — the "Got it" button, a tap
	 * anywhere, Escape — so the cookie is written in one place, by the server that
	 * reads it, with the options it is read under. Enhanced, the overlay is already
	 * gone before this is answered and nothing waits on the reply; without
	 * JavaScript the button is a plain submit, and the page this renders is the
	 * deck without the overlay, which is the only way out of it there is.
	 *
	 * No member is required: the cookie is the device's, not anyone's in this
	 * group, and it says nothing but "seen".
	 */
	coachSeen: async (event) => {
		event.cookies.set(COACH_COOKIE, '1', COACH_COOKIE_OPTIONS);
		return { coachSeen: true };
	},

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
