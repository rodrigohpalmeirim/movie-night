/**
 * The ladder is a CONTRACT between two files that never see each other: the
 * settings rail posts an index, the save action turns that index into days. So
 * the mapping is tested as arithmetic, in both directions, including the two
 * cases the old free-entry field left behind — a stored value between rungs, and
 * one above the top rung.
 */

import { describe, expect, it } from 'vitest';
import {
	COOLDOWN_FIELD,
	COOLDOWN_LADDER,
	COOLDOWN_NEVER_INDEX,
	cooldownIndex,
	cooldownLabel,
	cooldownStop
} from './cooldown.js';

describe('the re-watch cooldown ladder', () => {
	it('climbs: every rung is a longer wait than the last, and never is the top', () => {
		const finite = COOLDOWN_LADDER.slice(0, -1).map((stop) => stop.days as number);
		expect(finite.every((days, i) => i === 0 || days > finite[i - 1])).toBe(true);
		expect(COOLDOWN_LADDER[COOLDOWN_NEVER_INDEX].days).toBeNull();
		expect(COOLDOWN_LADDER[COOLDOWN_NEVER_INDEX].label).toBe('Forever');
		// Every rung the rail can reach is inside the knob's validated range.
		expect(finite.every((days) => days >= 0 && days <= 3650)).toBe(true);
	});

	it('posts as its own field, not as the day count it is not', () => {
		expect(COOLDOWN_FIELD).toBe('rewatch_cooldown_step');
	});

	it('maps a posted index to days, string or number alike', () => {
		expect(cooldownStop('0')?.days).toBe(0);
		expect(cooldownStop(6)?.days).toBe(180);
		expect(cooldownStop('6')?.label).toBe('6 months');
		expect(cooldownStop(COOLDOWN_NEVER_INDEX)?.days).toBeNull();
	});

	it('refuses a rung that is not one', () => {
		for (const bad of [-1, COOLDOWN_LADDER.length, 1.5, 'six', '', null, undefined, {}, NaN]) {
			expect(cooldownStop(bad)).toBeNull();
		}
	});

	it('round-trips every rung', () => {
		COOLDOWN_LADDER.forEach((stop, index) => {
			expect(cooldownIndex(stop.days)).toBe(index);
			expect(cooldownStop(index)).toEqual(stop);
			expect(cooldownLabel(index)).toBe(stop.label);
		});
	});

	it('snaps a stored value from between rungs to the nearest one', () => {
		expect(cooldownLabel(cooldownIndex(5))).toBe('1 week');
		expect(cooldownLabel(cooldownIndex(23))).toBe('1 month');
		expect(cooldownLabel(cooldownIndex(100))).toBe('3 months');
		expect(cooldownLabel(cooldownIndex(400))).toBe('1 year');
		// A tie goes to the longer wait: 45 days is 15 either side of 1 and 2 months.
		expect(cooldownLabel(cooldownIndex(45))).toBe('2 months');
	});

	it('snaps a wait longer than the ladder to its top rung, never to "never"', () => {
		expect(cooldownLabel(cooldownIndex(3650))).toBe('3 years');
		expect(cooldownIndex(3650)).not.toBe(COOLDOWN_NEVER_INDEX);
		// Only the absent value is never.
		expect(cooldownIndex(null)).toBe(COOLDOWN_NEVER_INDEX);
		expect(cooldownIndex(undefined)).toBe(COOLDOWN_NEVER_INDEX);
	});
});
