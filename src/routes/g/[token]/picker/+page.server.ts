/**
 * Member picker — "Claim a name or add yourself."
 *
 * Reachable without a member cookie (see `MEMBERLESS_ROUTE_IDS`), so it reads
 * `locals.group` directly instead of `requireActor`.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { MEMBER_COOKIE_OPTIONS, memberCookieName } from '$lib/server/context.js';
import { formValue, requireGroup } from '$lib/server/http.js';
import { statusOf } from '$lib/server/result.js';
import { claimMember, listMembers } from '$lib/server/services/groups.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const { db, group } = requireGroup(event);
	return {
		groupName: group.name,
		members: listMembers(db, group.id).map((member) => ({
			id: member.id,
			displayName: member.displayName
		})),
		/** Set when this device already has a claimed identity ("Not you?"). */
		currentMemberId: event.locals.member?.id ?? null
	};
};

export const actions: Actions = {
	/** Tap an existing name, or type a new one. No credential either way. */
	claim: async (event) => {
		const { db, group } = requireGroup(event);
		const data = await event.request.formData();
		const result = claimMember(db, {
			groupId: group.id,
			memberId: formValue(data, 'member_id'),
			name: formValue(data, 'name')
		});
		if (!result.ok) return formFail(statusOf(result), { code: result.code, message: result.message });

		event.cookies.set(memberCookieName(group.id), result.value.id, MEMBER_COOKIE_OPTIONS);
		redirect(303, `/g/${group.inviteToken}`);
	},

	/**
	 * Settings' "Not you?", posted from this side. Blanks the cookie rather than
	 * deleting it, exactly as the settings action does and for the same reason: an
	 * empty value keeps the group on this device's landing switchboard — pointing at
	 * this picker — so walking away before claiming a name does not cost the device
	 * its way back. See the settings `forget` action for the whole argument.
	 */
	forget: async (event) => {
		const { group } = requireGroup(event);
		event.cookies.set(memberCookieName(group.id), '', MEMBER_COOKIE_OPTIONS);
		redirect(303, `/g/${group.inviteToken}/picker`);
	}
};
