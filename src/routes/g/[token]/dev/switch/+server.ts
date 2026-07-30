/**
 * `POST dev/switch { member_id, return_to }` — DEV-ONLY member switching.
 *
 * One browser, five members: tapping a name in the dev bar re-points this
 * device's member cookie at that member, so a single tab can play a whole round.
 *
 * It is not a new identity mechanism. It reuses exactly what the member picker
 * does — `claimMember` to resolve the name inside this group, then the same
 * server-set `member_<group_id>` cookie with the same options — which is what
 * makes "switch" indistinguishable, downstream, from "this device claimed that
 * name in the picker".
 *
 * When DEV_MODE is not `1` this route does not exist: it 404s before reading the
 * body, before touching the database, and before touching the cookie. The dev
 * bar that posts here is likewise not rendered, so in production this file is
 * dead weight rather than a back door — but the 404 is the guard that matters,
 * because it holds even if someone crafts the POST by hand.
 *
 * Typed with SvelteKit's plain `RequestEvent` instead of the generated
 * `./$types` so the file compiles without `svelte-kit sync` having run.
 */

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { MEMBER_COOKIE_OPTIONS, memberCookieName } from '$lib/server/context.js';
import { devModeEnabled } from '$lib/server/devmode.js';
import { formValue } from '$lib/server/http.js';
import { statusOf } from '$lib/server/result.js';
import { claimMember } from '$lib/server/services/groups.js';

/**
 * Keeps the redirect inside this group's URL space. A dev-only endpoint is still
 * an endpoint, and `return_to` arrives from a form field.
 */
function safeReturnTo(raw: string | undefined, inviteToken: string): string {
	const home = `/g/${inviteToken}`;
	if (!raw || !raw.startsWith(`${home}/`)) return home;
	// No protocol-relative or scheme-bearing targets, and nothing that would
	// escape the group.
	if (raw.includes('//') || raw.includes('..')) return home;
	return raw;
}

export async function POST(event: RequestEvent): Promise<Response> {
	if (!devModeEnabled()) error(404, 'Not found');

	const group = event.locals.group;
	if (!group) error(404, 'No such group');

	const data = await event.request.formData();
	const claimed = claimMember(event.locals.db, {
		groupId: group.id,
		memberId: formValue(data, 'member_id')
	});
	if (!claimed.ok) error(statusOf(claimed), claimed.message);

	event.cookies.set(memberCookieName(group.id), claimed.value.id, MEMBER_COOKIE_OPTIONS);
	redirect(303, safeReturnTo(formValue(data, 'return_to'), group.inviteToken));
}
