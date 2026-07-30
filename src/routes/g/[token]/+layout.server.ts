/**
 * Group shell data for every screen under `/g/[token]`.
 *
 * `hooks.server.ts` has already 404'd unknown tokens, so `locals.group` is known
 * good. It has NOT necessarily resolved a member: this layout also wraps the
 * member picker, which is reachable without a claimed identity, so the member
 * context is nullable here and only the pages themselves require an actor.
 */

import { error } from '@sveltejs/kit';
import { devModeEnabled } from '$lib/server/devmode.js';
import { buildGroupContextView, unswipedMovieIds } from '$lib/server/services/views.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const { db, group, member } = event.locals;
	if (!group) error(404, 'No such group');
	return {
		groupName: group.name,
		inviteToken: group.inviteToken,
		/**
		 * DEV_MODE only, and read on the server: `false` in production means the
		 * dev member switcher's markup is never rendered at all. The member names
		 * the bar needs are already in `group.members`.
		 */
		devMode: devModeEnabled(),
		group: member ? buildGroupContextView(db, group, member) : null,
		/** Size of my own swipe stack — drives the Pool tab badge. My data only. */
		swipeCount: member ? unswipedMovieIds(db, group.id, member.id).length : 0
	};
};
