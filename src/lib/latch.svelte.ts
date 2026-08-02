/**
 * Optimistic latching for the app's state controls (RSVP, standing votes, the
 * veto's pre-fill).
 *
 * A latched button is "a held press" reporting SERVER state, which is right
 * with JavaScript off — but with JavaScript on it means the gap between letting
 * go and the action's response is drawn from the old state: the button springs
 * back up, then latches a beat later. On a slow connection that reads as the
 * tap not having taken. So: draw the target state the instant the form is
 * submitted, and hold it until the action settles — by which point `update()`
 * has re-run `load` and the server data says the same thing, so the latch never
 * lets go of anything.
 *
 * Same spirit as the pairs screen's `justCast` map, generalised. What falls out
 * of holding the value here rather than poking at the DOM:
 *
 * - A live refresh cannot clobber a pending latch. `invalidateAll` (someone
 *   else's action, over SSE) swaps `data` underneath, but the pending value is
 *   what renders, so the flip simply does not show until the latch clears.
 * - Rapid taps: each submission takes the next token *for its key*, and only
 *   the newest settle clears the latch, so a slow earlier response landing
 *   after a later tap can never unlatch it. Every path clears (the `finally`),
 *   so a failed or errored action reverts to true server state rather than
 *   sticking latched.
 * - Keys keep control groups apart: the roster posts one form per member, and
 *   marking Ana must not clear a pending latch on Ben.
 */

import type { SubmitFunction } from '@sveltejs/kit';

export function createLatch<T>(
	/** The state this submission is asking for, read off the submitted form. */
	read: (data: FormData) => T,
	/** Which control group it belongs to. One group unless told otherwise. */
	keyOf: (data: FormData) => string = () => ''
) {
	/** Targets of in-flight submissions, by key. */
	const pending = $state<Record<string, T>>({});
	/** Monotonic per key, so an out-of-order settle knows it is stale. */
	const tokens: Record<string, number> = {};

	return {
		/** What to draw: the in-flight target if there is one, else the server's. */
		value(server: T, key = ''): T {
			return key in pending ? pending[key] : server;
		},
		/** Is this group mid-flight? (For anything that re-syncs from `load`.) */
		isPending(key = ''): boolean {
			return key in pending;
		},
		/** Hand straight to `use:enhance`. */
		submit: ((input) => {
			const key = keyOf(input.formData);
			const token = (tokens[key] = (tokens[key] ?? 0) + 1);
			pending[key] = read(input.formData);

			return async ({ update }) => {
				try {
					// Default `invalidateAll`, so by the time this resolves the load
					// data already carries the new state — clearing leaves no gap.
					await update({ reset: false });
				} finally {
					if (tokens[key] === token) delete pending[key];
				}
			};
		}) satisfies SubmitFunction
	};
}
