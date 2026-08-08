/**
 * The settings form's unsaved edits, and where they wait out a tab hop.
 *
 * Settings is one long form with one Save button at the bottom of it, and the tab
 * bar is one tap away the whole time. A client-side navigation tears the page
 * down — every rune the page owned goes with it — so a new group name typed, a
 * rail nudged, then a glance at the pool and back used to land on a form that had
 * quietly forgotten. This module is where those edits sit in the meantime, and
 * the tab bar reads it to print the dot that says so.
 *
 * MODULE STATE IS EXACTLY THE RIGHT LIFETIME. It survives every client-side
 * navigation in the session and dies with the document, so an edit outlives a tab
 * hop and never outlives a reload: nothing is written to storage, and no draft can
 * come back days later to overwrite settings somebody else has changed since.
 *
 * Deliberately NOT `export const snapshot`: SvelteKit restores a snapshot on
 * history traversal only, and a tab-bar link is a forward navigation to the same
 * route — the one journey that has to work.
 *
 * All of this is enhancement, like the rest of the app. With scripting off the
 * form posts natively and none of it runs; nothing here is on the path that saves.
 */

/**
 * What the save form holds, in the units its CONTROLS speak. The cooldown is its
 * rung on the ladder (see `$lib/cooldown.ts`) rather than a number of days,
 * because a draft is a draft of what the rails read, not of what the row stores.
 */
export interface SettingsValues {
	name: string;
	/** Each rail's current reading, by knob name — the cooldown's by rung. */
	knobs: Record<string, number>;
	vetoesEnabled: boolean;
}

/**
 * Everything here is filed under the group's invite token, which is the name the
 * URL knows a group by and the one both the form and the tab bar hold.
 */
interface Filed {
	token: string;
	values: SettingsValues;
}

/** Edits made and not yet saved, or none. */
let draft = $state<Filed | null>(null);
/** What the server last said the same settings are — what a draft is dirty AGAINST. */
let stored = $state<Filed | null>(null);

/**
 * Do two readings of the form say the same thing? Shallow by nature: three
 * scalars and a flat record of numbers is the whole shape, and the knob keys come
 * from the same `knobRanges` on both sides — the union walk is only so a knob
 * appearing or vanishing between loads counts as a difference rather than being
 * silently ignored.
 */
function same(a: SettingsValues, b: SettingsValues): boolean {
	if (a.name !== b.name || a.vetoesEnabled !== b.vetoesEnabled) return false;
	for (const knob of new Set([...Object.keys(a.knobs), ...Object.keys(b.knobs)])) {
		if (a.knobs[knob] !== b.knobs[knob]) return false;
	}
	return true;
}

export const settingsDraft = {
	/**
	 * What the server says, every time it says it. The settings page reports this
	 * on load and on every re-load — a save of its own, or an SSE ping somebody
	 * else caused — so the dot is always measured against what is stored RIGHT NOW.
	 * If another member saves the very change you had typed, the difference is gone
	 * and so is the dot: an indicator that lies is worse than no indicator.
	 */
	observe(token: string, values: SettingsValues) {
		stored = { token, values };
		// A draft belongs to the table it was typed at. Regenerating the invite link,
		// or walking to another group through "Other groups", makes the token a
		// different one and the edits do not follow it.
		if (draft && draft.token !== token) draft = null;
	},

	/** Unsaved edits to seed this group's form from, if there are any. */
	read(token: string): SettingsValues | null {
		return draft && draft.token === token ? draft.values : null;
	},

	/**
	 * The form as it now stands. Written by the controls themselves rather than
	 * mirrored by an effect, so the draft is only ever touched by a member's own
	 * edit — a live refresh arriving mid-typing moves nothing.
	 */
	write(token: string, values: SettingsValues) {
		draft = { token, values };
	},

	/**
	 * The edits have landed: they are not a draft any more. Called when the save
	 * action reports success, which also settles the case where the server stored
	 * something slightly other than what was posted (a trimmed name, a cooldown
	 * snapped to its rung) — that is the server's answer, not unsaved work.
	 *
	 * A refused save clears nothing: the edits are still only on this screen.
	 */
	clear() {
		draft = null;
	},

	/**
	 * Does this group have unsaved edits? The tab bar's dot, and nothing else.
	 * Takes the token it is asking about, because the module outlives the group
	 * shell: a draft left at one table must not light a dot at the next.
	 */
	isDirty(token: string): boolean {
		if (!draft || !stored) return false;
		if (draft.token !== token || stored.token !== token) return false;
		return !same(draft.values, stored.values);
	}
};
