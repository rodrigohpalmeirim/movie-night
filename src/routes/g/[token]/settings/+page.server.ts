/**
 * Group settings — any member can edit (app-spec: "Group settings (any member can
 * edit)"). Knob changes take effect at the next finalist computation; they never
 * retro-affect a live RUNOFF, which reads `rounds.config_snapshot`.
 */

import { fail as formFail, redirect } from '@sveltejs/kit';
import { COOLDOWN_FIELD, cooldownStop } from '$lib/cooldown.js';
import { MEMBER_COOKIE_OPTIONS, memberCookieName } from '$lib/server/context.js';
import { formValue, requireActor } from '$lib/server/http.js';
import { statusOf, type Failure } from '$lib/server/result.js';
import {
	CONFIG_KNOBS,
	KNOB_RANGES,
	regenerateInviteToken,
	removeMember,
	renameMember,
	restoreMember,
	updateSettings
} from '$lib/server/services/groups.js';
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
	/** Group name and/or any of the six knobs. */
	save: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const config: Record<string, unknown> = {};
		// A field the form did not post is a knob left alone (`updateSettings` merges
		// onto the stored blob), which is what lets the veto switch submit this form
		// on its own without the numbers having to travel with it.
		for (const knob of CONFIG_KNOBS) {
			const raw = data.get(knob);
			if (raw !== null) config[knob] = raw;
		}
		// The one knob whose control does not post its own units. A range input cannot
		// say "never" and 0–3650 days is not a span you can drag, so the re-watch
		// cooldown is a rail that walks a ladder of sensible waits and posts the RUNG;
		// days are what the ladder says that rung means. Translated here rather than in
		// `validateConfigPatch`, because the ladder is a fact about this form's
		// transport, not about what a group config may hold — and it is translated
		// after the loop above, so a rung wins over a raw day count if both arrive.
		const rung = data.get(COOLDOWN_FIELD);
		if (rung !== null) {
			const stop = cooldownStop(rung);
			if (!stop) {
				return formFail(400, {
					code: 'invalid_input',
					message: 'Re-watch cooldown must be one of the marked steps'
				});
			}
			config.rewatch_cooldown = stop.days;
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
	 *
	 * Cleared means BLANKED, not deleted: the cookie is rewritten empty, same name,
	 * same path, same Max-Age. Deleting it would take the group off this device's
	 * landing switchboard altogether, and since the member cookies are the only
	 * record `/` has of where a device belongs, a hand-off that wandered off the
	 * picker without claiming a name would leave the invite link as the sole way
	 * back. This button promises to switch person, not to forget the group. The empty
	 * value is the marker `resolveDeviceGroups` prints as a memberless row into the
	 * picker, and it resolves as unclaimed everywhere else because `findMember` reads
	 * no id from it.
	 */
	forget: async (event) => {
		const actor = requireActor(event);
		event.cookies.set(memberCookieName(actor.group.id), '', MEMBER_COOKIE_OPTIONS);
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
	},

	/**
	 * app-spec: "Any member can remove any member ... **including themselves**."
	 * Guarded exactly like `renameSelf` and every other member action — by
	 * `requireActor`, i.e. a claimed identity in this group, and nothing more. There
	 * are no roles to check.
	 *
	 * Removing yourself also clears this device's cookie and returns to the picker:
	 * `resolveContext` would already resolve a removed member as unclaimed, so
	 * leaving the cookie would mean every later request quietly redirected there
	 * anyway. Doing it here makes it deliberate rather than a side effect. Deleted
	 * outright, unlike the blank marker `forget` above leaves: that one says "somebody
	 * else is about to pick a name here", while this one is a member walking out of
	 * the group, and a cookie pointing at a removed member is stale to the landing
	 * page in any case.
	 */
	removeMember: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const memberId = formValue(data, 'member_id');
		if (!memberId) return formFail(400, { code: 'invalid_input', message: 'member_id is required' });
		const result = removeMember({
			db: actor.db,
			groupId: actor.group.id,
			memberId,
			now: actor.now
		});
		if (!result.ok) return reject(result);
		if (memberId === actor.member.id) {
			event.cookies.delete(memberCookieName(actor.group.id), { path: MEMBER_COOKIE_OPTIONS.path });
			redirect(303, `/g/${actor.group.inviteToken}/picker`);
		}
		return { removed: result.value.displayName };
	},

	/**
	 * The way back, open to anyone — including for a member who removed themselves
	 * and has since been let back in by someone else. Every standing vote, star and
	 * suggestion they ever recorded counts again, because none of it was deleted.
	 */
	restoreMember: async (event) => {
		const actor = requireActor(event);
		const data = await event.request.formData();
		const memberId = formValue(data, 'member_id');
		if (!memberId) return formFail(400, { code: 'invalid_input', message: 'member_id is required' });
		const result = restoreMember({ db: actor.db, groupId: actor.group.id, memberId });
		return result.ok ? { restored: result.value.displayName } : reject(result);
	}
};
