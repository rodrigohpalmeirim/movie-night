/**
 * Landing page — "Create a group; nothing else."
 *
 * This form action *is* the API shape's `POST /create-group`: a SvelteKit form
 * action rather than a JSON endpoint, so group creation works with no JavaScript
 * at all (app-spec: "progressive enhancement means voting works without JS").
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { MEMBER_COOKIE_OPTIONS, memberCookieName } from '$lib/server/context.js';
import { formValue } from '$lib/server/http.js';
import { createGroupLimiter } from '$lib/server/ratelimit.js';
import { createGroup } from '$lib/server/services/groups.js';
import { statusOf } from '$lib/server/result.js';
import type { Actions } from './$types';

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
