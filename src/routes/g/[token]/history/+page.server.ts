/** History tab: past nights, newest first, expandable to the full revealed tally. */

import { requireActor } from '$lib/server/http.js';
import { buildHistoryView } from '$lib/server/services/views.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const actor = requireActor(event);
	return {
		token: event.params.token,
		entries: buildHistoryView({ db: actor.db, group: actor.group })
	};
};
