/**
 * Landing page — "Create a group; nothing else", plus the switchboard that says
 * which table this device already has a seat at.
 *
 * The load is the app's front door. There is one installed app ("Movie Night",
 * `start_url` `/`), so this is where every launch arrives and this is what decides
 * where it goes: the member cookies are the answer, and the group's own manifest
 * only smuggles a hint for the one case where there are none (see the `?g`
 * paragraph below).
 *
 * This form action *is* the API shape's `POST /create-group`: a SvelteKit form
 * action rather than a JSON endpoint, so group creation works with no JavaScript
 * at all (app-spec: "progressive enhancement means voting works without JS").
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import {
	findGroupByToken,
	MEMBER_COOKIE_OPTIONS,
	memberCookieName,
	resolveDeviceGroups
} from '$lib/server/context.js';
import { formValue } from '$lib/server/http.js';
import { createGroupLimiter } from '$lib/server/ratelimit.js';
import { createGroup } from '$lib/server/services/groups.js';
import { statusOf } from '$lib/server/result.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	// The whole jar, because the cookie name carries the group id and this page has
	// no token to look one up with.
	const { groups, staleCookieNames } = resolveDeviceGroups({
		db: event.locals.db,
		cookies: event.cookies.getAll()
	});
	// Prune as we read. Same path the cookie was written with, or the delete names a
	// different cookie than the one being served and nothing is cleared.
	for (const name of staleCookieNames) {
		event.cookies.delete(name, { path: MEMBER_COOKIE_OPTIONS.path });
	}

	// Redirects are for plain page loads only. A rejected create-group re-renders
	// this page through the action, and a member of one group who fumbles the form
	// must see why rather than be swept into their group.
	const isPageLoad = event.request.method === 'GET';
	// The escape hatch: `?all` is the one URL that always renders. Without it a
	// device with exactly one group could never reach the create form again, since
	// `/` would bounce it home every time.
	const wantsAll = event.url.searchParams.has('all');

	if (isPageLoad && !wantsAll) {
		// Cookies are the truth. One group is not a choice, so it is not a screen.
		if (groups.length === 1) redirect(303, `/g/${groups[0].inviteToken}`);

		// No cookies at all, and a group named in `?g`: this is a freshly installed
		// iOS PWA, which starts with an EMPTY cookie jar — it does not inherit
		// Safari's. The group's manifest puts its token in the `start_url` precisely
		// so this first launch can find its way home; the group's picker then asks
		// who is holding the phone and writes the cookie for every launch after.
		if (groups.length === 0) {
			const hinted = event.url.searchParams.get('g');
			const group = hinted ? findGroupByToken(event.locals.db, hinted) : undefined;
			// An unknown or absent hint is simply the landing page.
			if (group) redirect(303, `/g/${group.inviteToken}`);
		}
	}

	// Two or more groups (or `?all`): the page prints them and lets the reader pick.
	return { groups };
};

export const actions: Actions = {
	createGroup: async (event) => {
		// Light rate limiting on an unauthenticated surface.
		const verdict = createGroupLimiter.check(event.getClientAddress());
		if (!verdict.allowed) {
			return formFail(429, {
				code: 'rate_limited',
				message: 'Too many groups from this address — try again later'
			});
		}

		const data = await event.request.formData();
		const result = createGroup(event.locals.db, {
			name: formValue(data, 'name'),
			memberName: formValue(data, 'member_name')
		});
		if (!result.ok) {
			return formFail(statusOf(result), { code: result.code, message: result.message });
		}

		const { group, member } = result.value;
		// Server-side Set-Cookie with a long Max-Age: never document.cookie, which
		// Safari caps at ~7 days and would log iPhone members out weekly.
		event.cookies.set(memberCookieName(group.id), member.id, MEMBER_COOKIE_OPTIONS);
		redirect(303, `/g/${group.inviteToken}`);
	}
};
