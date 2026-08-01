/**
 * Group settings — any member can edit (app-spec: "Group settings (any member can
 * edit)"). Knob changes take effect at the next finalist computation; they never
 * retro-affect a live RUNOFF, which reads `rounds.config_snapshot`.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { MEMBER_COOKIE_OPTIONS, memberCookieName } from '$lib/server/context.js';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import { KNOB_RANGES, regenerateInviteToken, renameMember, updateSettings } from '$lib/server/services/groups.js';
import { buildSettingsView } from '$lib/server/services/views.js';
import type { Actions, PageServerLoad } from './$types';

function reject(failure: Failure) {
	return formFail(statusOf(failure), { code: failure.code, message: failure.message });
}

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	return {
		settings: buildSettingsView({ db: actor.db, group: actor.group, me: actor.member }),
		knobRanges: KNOB_RANGES
	};
};

export const actions: Actions = {
	/** Group name and/or any of the five knobs. */
	save: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const config: Record<string, unknown> = {};
		for (const knob of Object.keys(KNOB_RANGES)) {
			const raw = data.get(knob);
			if (raw !== null) config[knob] = raw;
		}
		const result = updateSettings(actor.db, {
			groupId: actor.group.id,
			name: formValue(data, 'name'),
			config: Object.keys(config).length > 0 ? config : undefined
		});
		return result.ok ? { saved: true } : reject(result);
	},

	/** Kills the old URL; existing device sessions survive. */
	regenerateLink: async (event) => {
		const actor = requireActor(event);
		const result = regenerateInviteToken(actor.db, actor.group.id);
		if (!result.ok) return reject(result);
		// The current URL contains the dead token, so send the browser to the new one.
		redirect(303, `/g/${result.value.inviteToken}/settings`);
	},

	/**
	 * app-spec: "'Not you?' in the settings screen clears the cookie and returns to
	 * the picker." The member row itself is untouched — members are never deleted.
	 */
	forget: async (event) => {
		const actor = requireActor(event);
		event.cookies.delete(memberCookieName(actor.group.id), { path: MEMBER_COOKIE_OPTIONS.path });
		redirect(303, `/g/${actor.group.inviteToken}/picker`);
	},

	/** "rename self; members are never deleted — history references them." */
	renameSelf: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const result = renameMember(actor.db, {
			groupId: actor.group.id,
			memberId: actor.member.id,
			name: formValue(data, 'display_name')
		});
		return result.ok ? { displayName: result.value.displayName } : reject(result);
	}
};
