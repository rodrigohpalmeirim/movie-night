/**
 * The re-watch cooldown's ladder: the rungs the settings slider stops on, and
 * the arithmetic that turns a rung into the number of days the knob stores.
 *
 * The knob itself is a span of days (0–3650) with `null` for never, which is the
 * wrong shape for a groove — one day per pixel is a value nobody could set on
 * purpose, and `null` has no place on a numeric scale at all. So the rail moves
 * along a curated list instead: a dozen waits a group would actually agree to,
 * climbing from "no cooldown" to "forever", which is the honest direction because
 * never IS the longest wait (voting-spec: "Optionally allow a watched movie back
 * after a cooldown (default: never, configurable)"). The default therefore sits
 * at the far end of the rail rather than somewhere in its middle.
 *
 * The RAIL POSTS AN INDEX and the server maps it back to days through this same
 * list, which is why the list lives here in `$lib` and not beside the other knob
 * ranges in `$lib/server`: one array, imported by the page that draws the rail
 * and by the action that saves it, so the two can never disagree about what
 * rung 6 means. It is pure by design — no DOM, no runes, no SvelteKit — which is
 * what lets `cooldown.test.ts` run in the bare Vitest project.
 *
 * The ladder is deliberately NARROWER than the knob's validated range: it tops
 * out at three years where `KNOB_RANGES.rewatch_cooldown` allows ten. Anything
 * stored outside the rungs (a value typed into the old free-entry field, or set
 * by another client) still reads and validates fine; the rail merely shows the
 * nearest rung, and saving this form writes that rung. Snapping is display AND
 * write, and it is the only place a stored cooldown is ever rounded.
 */

export interface CooldownStop {
	/** Days to wait, or `null` for "never" — the knob's own two shapes. */
	days: number | null;
	/** What the number beside the label prints. */
	label: string;
}

export const COOLDOWN_LADDER: readonly CooldownStop[] = [
	{ days: 0, label: 'No cooldown' },
	{ days: 7, label: '1 week' },
	{ days: 14, label: '2 weeks' },
	{ days: 30, label: '1 month' },
	{ days: 60, label: '2 months' },
	{ days: 90, label: '3 months' },
	{ days: 180, label: '6 months' },
	{ days: 365, label: '1 year' },
	{ days: 548, label: '18 months' },
	{ days: 730, label: '2 years' },
	{ days: 1095, label: '3 years' },
	{ days: null, label: 'Forever' }
];

/**
 * The field the rail posts under. Not `rewatch_cooldown`, because it does not
 * carry days — a form field that lies about its units is how a rung index ends
 * up stored as a day count.
 */
export const COOLDOWN_FIELD = 'rewatch_cooldown_step';

/** The rightmost rung, and the knob's default: a watched film never returns. */
export const COOLDOWN_NEVER_INDEX = COOLDOWN_LADDER.length - 1;

/**
 * A posted rung → the stop it names, or `null` if it names none. Accepts the
 * string a form sends as readily as a number, and refuses everything else
 * outright: an unparseable rung is a bug or a forged post, not a value to
 * helpfully clamp into range.
 */
export function cooldownStop(index: unknown): CooldownStop | null {
	// An empty field is not rung zero, whatever `Number('')` says. "No cooldown" is a
	// deliberate answer and it has to be posted deliberately.
	if (typeof index === 'string' && index.trim() === '') return null;
	const parsed = typeof index === 'string' ? Number(index) : index;
	if (typeof parsed !== 'number' || !Number.isInteger(parsed)) return null;
	return COOLDOWN_LADDER[parsed] ?? null;
}

/**
 * A stored cooldown → the rung to park the thumb on. `null` is the "never" rung
 * exactly; any other number snaps to the nearest rung by day count, ties going
 * to the longer wait. A stored value above the top rung snaps to three years and
 * NOT to never: "never" is not a large number, it is a different answer.
 */
export function cooldownIndex(days: number | null | undefined): number {
	if (days === null || days === undefined) return COOLDOWN_NEVER_INDEX;
	let best = 0;
	for (let i = 0; i < COOLDOWN_LADDER.length; i++) {
		const rung = COOLDOWN_LADDER[i].days;
		if (rung === null) continue;
		const bestDays = COOLDOWN_LADDER[best].days as number;
		if (Math.abs(rung - days) <= Math.abs(bestDays - days)) best = i;
	}
	return best;
}

/** What the rung at this position prints; out-of-range reads as never. */
export function cooldownLabel(index: number): string {
	return (COOLDOWN_LADDER[index] ?? COOLDOWN_LADDER[COOLDOWN_NEVER_INDEX]).label;
}
