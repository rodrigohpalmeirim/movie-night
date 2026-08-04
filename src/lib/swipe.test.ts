/**
 * The swipe card's arithmetic, tested as arithmetic.
 *
 * `swipe.ts` owns no DOM, no listeners and no reactive state, which is exactly
 * what makes the release policy checkable here: every question the screen asks
 * of a gesture — is this a tap, which axis is it on, did it commit, and to what —
 * is a pure function of a pointer offset, a velocity and the card's width.
 */

import { describe, expect, it } from 'vitest';
import {
	FALLBACK_CARD_WIDTH,
	FLICK_VELOCITY,
	MAX_ROTATION_DEG,
	MIN_COMMIT_DISTANCE,
	TAP_SLOP,
	VELOCITY_STALE_MS,
	VERTICAL_BIAS,
	cardWidthOr,
	clamp,
	commitDistance,
	commitProgress,
	createVelocityTracker,
	decideAxis,
	decideRelease,
	rotationFor,
	stampOpacity,
	type DragAxis,
	type Release
} from './swipe.js';

/** A measured card, so the tests read in real pixels: 40% of 288 is 115.2. */
const WIDTH = 288;
const COMMIT = commitDistance(WIDTH);

function release(axis: DragAxis | null, over: Partial<Release> = {}): Release {
	return { dx: 0, dy: 0, vx: 0, vy: 0, width: WIDTH, axis, ...over };
}

/** A gesture the screen has locked to the horizontal: a vote. */
const swipe = (over: Partial<Release>) => decideRelease(release('x', over));
/** A gesture the screen has locked to the vertical: a star, or nothing. */
const lift = (over: Partial<Release>) => decideRelease(release('y', over));

/* ------------------------------------------------------------------ */
/* Axis dominance                                                      */
/* ------------------------------------------------------------------ */

describe('decideAxis', () => {
	it('has no answer while the gesture is still a tap', () => {
		expect(decideAxis(0, 0)).toBeNull();
		expect(decideAxis(TAP_SLOP - 1, 0)).toBeNull();
		expect(decideAxis(4, -4)).toBeNull();
	});

	it('answers from the same few pixels that end a tap', () => {
		expect(decideAxis(TAP_SLOP, 0)).toBe('x');
		expect(decideAxis(0, -TAP_SLOP)).toBe('y');
	});

	it('reads a flat drag as a vote', () => {
		expect(decideAxis(40, 0)).toBe('x');
		expect(decideAxis(-40, 6)).toBe('x');
	});

	it('reads a drag straight up as a lift', () => {
		expect(decideAxis(0, -40)).toBe('y');
		expect(decideAxis(5, -40)).toBe('y');
	});

	it('gives a 45° diagonal to the horizontal', () => {
		// A thumb arc is never flat, and this screen is mostly yes and no.
		expect(decideAxis(30, -30)).toBe('x');
		expect(decideAxis(-30, -30)).toBe('x');
	});

	it('turns vertical only once the drag is steeper than the bias', () => {
		const dx = 30;
		expect(decideAxis(dx, -(dx * VERTICAL_BIAS - 1))).toBe('x');
		expect(decideAxis(dx, -dx * VERTICAL_BIAS)).toBe('y');
	});

	it('locks the vertical axis downward too, so the card can follow and spring back', () => {
		expect(decideAxis(0, 40)).toBe('y');
	});
});

/* ------------------------------------------------------------------ */
/* Release — sideways                                                  */
/* ------------------------------------------------------------------ */

describe('decideRelease, sideways', () => {
	it('commits past 40% of the card', () => {
		expect(swipe({ dx: COMMIT })).toBe('yes');
		expect(swipe({ dx: -COMMIT })).toBe('no');
		expect(swipe({ dx: COMMIT + 200 })).toBe('yes');
	});

	it('springs back short of it', () => {
		expect(swipe({ dx: COMMIT - 1 })).toBeNull();
		expect(swipe({ dx: -COMMIT + 1 })).toBeNull();
	});

	it('commits a flick that has not travelled the distance', () => {
		expect(swipe({ dx: 40, vx: FLICK_VELOCITY })).toBe('yes');
		expect(swipe({ dx: -40, vx: -FLICK_VELOCITY })).toBe('no');
	});

	it('refuses a flick that disagrees with its own travel', () => {
		// Dragged right, yanked back left on release: cancel, never "no".
		expect(swipe({ dx: 40, vx: -1.2 })).toBeNull();
		expect(swipe({ dx: -40, vx: 1.2 })).toBeNull();
	});

	it('refuses a fast gesture that went nowhere', () => {
		expect(swipe({ dx: 8, vx: 2 })).toBeNull();
	});

	it('keeps a floor under narrow cards', () => {
		expect(commitDistance(40)).toBe(MIN_COMMIT_DISTANCE);
		expect(decideRelease(release('x', { dx: 50, width: 40 }))).toBeNull();
		expect(decideRelease(release('x', { dx: MIN_COMMIT_DISTANCE, width: 40 }))).toBe('yes');
	});
});

/* ------------------------------------------------------------------ */
/* Release — up                                                        */
/* ------------------------------------------------------------------ */

describe('decideRelease, up', () => {
	it('stars past the same distance a vote costs', () => {
		expect(lift({ dy: -COMMIT })).toBe('star');
		expect(lift({ dy: -COMMIT - 300 })).toBe('star');
	});

	it('springs back short of it', () => {
		expect(lift({ dy: -COMMIT + 1 })).toBeNull();
		expect(lift({ dy: -40 })).toBeNull();
	});

	it('stars an upward flick that has not travelled the distance', () => {
		expect(lift({ dy: -40, vy: -FLICK_VELOCITY })).toBe('star');
	});

	it('refuses a flick that is dropped back down on release', () => {
		expect(lift({ dy: -40, vy: 1.2 })).toBeNull();
	});

	it('refuses a fast lift that went nowhere', () => {
		expect(lift({ dy: -8, vy: -2 })).toBeNull();
	});

	it('never commits anything downward, however far or fast', () => {
		expect(lift({ dy: COMMIT + 300 })).toBeNull();
		expect(lift({ dy: 40, vy: 2 })).toBeNull();
		expect(lift({ dy: COMMIT, vy: FLICK_VELOCITY })).toBeNull();
	});

	it('ignores sideways travel once the axis is the vertical', () => {
		// dragX is held at 0 for the length of a lift; a stale dx cannot vote.
		expect(lift({ dx: COMMIT + 200, dy: -10 })).toBeNull();
	});
});

describe('decideRelease with no axis', () => {
	it('is a tap, whatever the numbers say', () => {
		expect(decideRelease(release(null, { dx: COMMIT + 200, vx: 3 }))).toBeNull();
		expect(decideRelease(release(null, { dy: -COMMIT - 200, vy: -3 }))).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* Hints, tilt and the card's width                                    */
/* ------------------------------------------------------------------ */

describe('progress and ink', () => {
	it('shows nothing for the first few pixels, so a tap never flashes a seal', () => {
		expect(commitProgress(0, WIDTH)).toBe(0);
		expect(commitProgress(9, WIDTH)).toBe(0);
		expect(commitProgress(-9, WIDTH)).toBe(0);
	});

	it('reaches 1 at the commit point and stays there', () => {
		expect(commitProgress(COMMIT, WIDTH)).toBe(1);
		expect(commitProgress(-COMMIT - 500, WIDTH)).toBe(1);
	});

	it('reads the same travel the same way on either axis', () => {
		// The vertical drag is passed as its own signed offset; the function is
		// blind to which axis the number came from.
		expect(commitProgress(-70, WIDTH)).toBe(commitProgress(70, WIDTH));
	});

	it('inks the seal fully a little before the commit', () => {
		expect(stampOpacity(0)).toBe(0);
		expect(stampOpacity(0.72)).toBe(1);
		expect(stampOpacity(1)).toBe(1);
	});

	it('clamps the tilt', () => {
		expect(rotationFor(WIDTH, WIDTH)).toBe(MAX_ROTATION_DEG);
		expect(rotationFor(-WIDTH, WIDTH)).toBe(-MAX_ROTATION_DEG);
		// A lift holds dragX at 0, so a starred card never tilts.
		expect(rotationFor(0, WIDTH)).toBe(0);
	});

	it('falls back to the stylesheet width until the stack is measured', () => {
		expect(cardWidthOr(0)).toBe(FALLBACK_CARD_WIDTH);
		expect(cardWidthOr(320)).toBe(320);
		expect(commitDistance(0)).toBe(commitDistance(FALLBACK_CARD_WIDTH));
		expect(clamp(5, 0, 1)).toBe(1);
	});
});

/* ------------------------------------------------------------------ */
/* Velocity                                                            */
/* ------------------------------------------------------------------ */

describe('velocity tracker', () => {
	it('weights the newest sample most', () => {
		const v = createVelocityTracker();
		v.reset(0, 0);
		v.sample(10, 10);
		expect(v.velocity(10)).toBeCloseTo(0.65, 5);
		v.sample(20, 20);
		expect(v.velocity(20)).toBeCloseTo(0.8775, 4);
	});

	it('reports nothing once the pointer has been still for a moment', () => {
		const v = createVelocityTracker();
		v.reset(0, 0);
		v.sample(100, 50);
		expect(v.velocity(50)).toBeGreaterThan(FLICK_VELOCITY);
		expect(v.velocity(50 + VELOCITY_STALE_MS + 1)).toBe(0);
	});

	it('drops a reading that describes a different motion', () => {
		const v = createVelocityTracker();
		v.reset(0, 0);
		v.sample(100, 100);
		v.sample(101, 200);
		expect(v.velocity(200)).toBeCloseTo(0.01, 5);
	});

	it('is axis-neutral — one tracker per axis, fed that axis alone', () => {
		const up = createVelocityTracker();
		up.reset(400, 0);
		up.sample(300, 100);
		// Upward is negative, which is what an upward flick has to agree with.
		expect(up.velocity(100)).toBeCloseTo(-1, 5);
	});
});
