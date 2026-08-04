/**
 * Swipe-card gesture math and timings.
 *
 * app-spec: "Gestures — small custom pointer-event handler ... Buttons remain the
 * accessible/desktop path; swipe is enhancement." So this module is deliberately
 * *not* a gesture engine: it owns no DOM, no listeners and no state beyond one
 * tiny velocity tracker. The swipe screen keeps its handful of pointer handlers
 * and calls in here for the numbers, which keeps the feel tunable in one place
 * and the decision logic testable as pure functions.
 *
 * Everything here is framework-agnostic (no runes), because none of it needs to
 * be reactive — it is arithmetic over a pointer position.
 */

export type SwipeChoice = 'yes' | 'no';

/**
 * What a release resolved to. `star` is not a third answer — it is the yes the
 * up-gesture makes, posted as `{ value: 'yes', starred: true }`. Keeping it a
 * separate word here is what lets one value carry the exit direction, the seal
 * that gets pressed and the flag that gets posted.
 */
export type SwipeAction = SwipeChoice | 'star';

/** Which way a gesture has committed to travelling. `x` votes, `y` stars. */
export type DragAxis = 'x' | 'y';

/* ── distances ──────────────────────────────────────────────────────── */

/** Card width assumed before the stack has been measured (`max-w-72` = 288px). */
export const FALLBACK_CARD_WIDTH = 288;

/**
 * A slow drag commits at 40% of the card's width — far enough that a lazy thumb
 * wobble never votes, near enough that the commit lands inside a comfortable
 * thumb arc on a phone (~115px on a 288px card).
 */
export const COMMIT_FRACTION = 0.4;

/** Floor for very narrow viewports, so 40% never becomes a hair-trigger. */
export const MIN_COMMIT_DISTANCE = 56;

/** Ignore the first few pixels for the hint overlays: taps must not flash them. */
export const HINT_DEAD_ZONE = 10;

/**
 * Travel that turns a press into a drag. Below it the gesture is still a tap, so
 * the ⓘ corner, the trailer link and the buttons keep working; at it the card
 * turns face up (the seal belongs on the poster) and the click that follows the
 * release is swallowed. Smaller than `HINT_DEAD_ZONE`, so the card is already
 * the right way round by the time any ink shows.
 */
export const TAP_SLOP = 6;

/* ── axes ───────────────────────────────────────────────────────────── */

/**
 * How much steeper than wide a drag has to be to be read as a LIFT rather than
 * a swipe. 1.2 puts the dividing line at about 50° from the table edge, which
 * deliberately favours the horizontal: right and left are what this screen is
 * for, they are what the thumb does dozens of times a session, and a thumb arc
 * is never perfectly flat — so a 45° drag is still a vote, and only a gesture
 * that is clearly going up is a star.
 *
 * There is no second slop for the axis: it is chosen at `TAP_SLOP`, the same
 * few pixels that turn a press into a drag. One threshold, so the card turns
 * face up and picks its direction on the same frame, and the axis it picks then
 * holds for the rest of the gesture — a card that changed its mind halfway
 * would jump sideways under the finger.
 */
export const VERTICAL_BIAS = 1.2;

/* ── velocity ───────────────────────────────────────────────────────── */

/**
 * Flick threshold in px/ms (550px/s). A deliberate flick clears this easily; a
 * hand drifting across the card does not.
 */
export const FLICK_VELOCITY = 0.55;

/** A flick still has to travel a little, or a fast tap would vote. */
export const FLICK_MIN_FRACTION = 0.08;
export const MIN_FLICK_DISTANCE = 16;

/**
 * If the pointer has been still for this long at release, the gesture is a slow
 * drag, not a flick — otherwise a fast move followed by a pause (thumb parked,
 * thinking) would commit on lift.
 */
export const VELOCITY_STALE_MS = 90;

/* ── rotation ───────────────────────────────────────────────────────── */

/** Degrees per card-width of horizontal travel, clamped by `MAX_ROTATION_DEG`. */
export const ROTATION_PER_WIDTH_DEG = 22;
export const MAX_ROTATION_DEG = 12;

/** Tilt of a card that has left the stack; slightly past the drag clamp. */
export const EXIT_ROTATION_DEG = 16;

/* ── timings (ms) ───────────────────────────────────────────────────── */

/** Release without a commit: back to centre with a hint of overshoot. */
export const SPRING_MS = 300;
export const SPRING_EASE = 'cubic-bezier(0.18, 0.89, 0.32, 1.15)';

/** The card underneath rising into the top slot after a commit. */
export const PROMOTE_MS = 220;
export const PROMOTE_EASE = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/** Committed card leaving the screen. Short: it must not delay the next swipe. */
export const EXIT_MS = 260;
export const EXIT_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/* ── functions ──────────────────────────────────────────────────────── */

export function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

/** Measured width, or the Tailwind max-width before the first layout pass. */
export function cardWidthOr(width: number): number {
	return width > 0 ? width : FALLBACK_CARD_WIDTH;
}

/**
 * Travel at which a slow drag counts, and the SAME number on both axes: a star
 * is asked for exactly as deliberately as a vote, and the card gives the same
 * feedback for the same distance whichever way it is pushed.
 *
 * It is measured off the card's WIDTH on both axes, because the width is what is
 * measured — and it happens to be the more forgiving reading upward, where 40%
 * of the width is only ~27% of a 2:3 card's height. A thumb has less room to
 * push up than to sweep across, so the shorter journey belongs to the star.
 */
export function commitDistance(width: number): number {
	return Math.max(MIN_COMMIT_DISTANCE, cardWidthOr(width) * COMMIT_FRACTION);
}

/**
 * 0 → 1 as the drag approaches its commit distance. Direction-blind, and axis-
 * blind with it: pass the travel of whichever axis the gesture locked to.
 */
export function commitProgress(dx: number, width: number): number {
	const target = commitDistance(width);
	const travelled = Math.abs(dx) - HINT_DEAD_ZONE;
	return clamp(travelled / Math.max(1, target - HINT_DEAD_ZONE), 0, 1);
}

/** Signed tilt, proportional to horizontal offset and clamped. */
export function rotationFor(dx: number, width: number): number {
	const turns = dx / cardWidthOr(width);
	return clamp(turns * ROTATION_PER_WIDTH_DEG, -MAX_ROTATION_DEG, MAX_ROTATION_DEG);
}

/**
 * Stamp opacity for a given commit progress. Gain > 1 so YES/NOPE is fully
 * opaque a little *before* the commit point: the stamp is a promise, and the
 * card should look decided while there is still time to drag back.
 */
export function stampOpacity(progress: number): number {
	return clamp(progress * 1.4, 0, 1);
}

/**
 * WHICH AXIS A GESTURE IS ON, decided once and from the whole travel so far.
 *
 * Below `TAP_SLOP` there is no answer yet — the gesture is still a tap, and the
 * card has not moved. Past it the steeper of the two wins, with the horizontal
 * given the benefit of the doubt (see `VERTICAL_BIAS`).
 *
 * `y` is symmetric on purpose: a drag DOWNWARD locks the vertical axis too, so
 * the card follows the finger down and springs back with nothing committed. The
 * alternative — a card that ignores a downward drag entirely — reads as a dead
 * touch rather than as a card that is pinned to the table.
 */
export function decideAxis(dx: number, dy: number): DragAxis | null {
	if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_SLOP) return null;
	return Math.abs(dy) >= Math.abs(dx) * VERTICAL_BIAS ? 'y' : 'x';
}

export interface Release {
	/** Offset from where the pointer went down, px, on the locked axis's terms. */
	dx: number;
	dy: number;
	/** Velocity at release, px/ms (already staleness-corrected). */
	vx: number;
	vy: number;
	/** Measured card width, px; 0 if not measured yet. */
	width: number;
	/** The axis the gesture locked to, or null if it never left the tap. */
	axis: DragAxis | null;
}

/**
 * The whole release policy: a fast flick commits below the distance threshold, a
 * slow drag commits past 40% of the card, anything else springs back.
 *
 * A flick must agree with the direction it travelled, so a drag right that is
 * yanked back left on release cancels rather than voting "no".
 *
 * The vertical axis is the same policy with one direction fewer: UP is a star,
 * and down is nothing at all. Both halves of an upward flick have to point
 * upward, exactly as a sideways flick has to agree with its own drag — so a card
 * pushed up and dropped back down on release keeps its answer to itself.
 */
export function decideRelease({ dx, dy, vx, vy, width, axis }: Release): SwipeAction | null {
	if (axis === null) return null;
	const minFlick = Math.max(MIN_FLICK_DISTANCE, cardWidthOr(width) * FLICK_MIN_FRACTION);

	if (axis === 'y') {
		const up = -dy;
		if (up >= commitDistance(width)) return 'star';
		return -vy >= FLICK_VELOCITY && up >= minFlick ? 'star' : null;
	}

	if (Math.abs(dx) >= commitDistance(width)) return dx > 0 ? 'yes' : 'no';
	const flicked = Math.abs(vx) >= FLICK_VELOCITY && Math.abs(dx) >= minFlick;
	if (flicked && Math.sign(vx) === Math.sign(dx)) return vx > 0 ? 'yes' : 'no';

	return null;
}

export interface VelocityTracker {
	/** Start a gesture at a position/timestamp. */
	reset(x: number, t: number): void;
	/** Feed a pointer position on this tracker's own axis. */
	sample(x: number, t: number): void;
	/** px/ms at time `t`; 0 once the pointer has been still for a moment. */
	velocity(t: number): number;
}

/**
 * Recency-weighted velocity along ONE axis. A flick is decided by its last few
 * milliseconds, so the newest sample dominates, but a single jittery frame
 * cannot fabricate a flick on its own.
 *
 * One tracker per axis, and the screen keeps two: the axes are read together at
 * release (an upward flick has to be upward in both position and speed), and a
 * single tracker fed both coordinates would only ever know the diagonal.
 */
export function createVelocityTracker(): VelocityTracker {
	let vx = 0;
	let lastX = 0;
	let lastT = 0;

	return {
		reset(x, t) {
			vx = 0;
			lastX = x;
			lastT = t;
		},
		sample(x, t) {
			const dt = t - lastT;
			if (dt <= 0) return;
			const instant = (x - lastX) / dt;
			// A long gap means the previous reading describes a different motion.
			vx = dt > VELOCITY_STALE_MS ? instant : vx * 0.35 + instant * 0.65;
			lastX = x;
			lastT = t;
		},
		velocity(t) {
			return t - lastT > VELOCITY_STALE_MS ? 0 : vx;
		}
	};
}
