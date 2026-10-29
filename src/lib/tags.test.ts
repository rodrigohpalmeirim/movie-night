/**
 * The tag arithmetic both halves of the app lean on: the services decide what
 * "the same tag" is with it, and the database's CHECK has to agree with its fold
 * byte for byte. So the fold is tested as SQLite's `lower()` would see it —
 * ASCII only — and the swipe deck's themed ordering as the stable partition it
 * promises to be.
 */

import { describe, expect, it } from 'vitest';
import {
	cleanTagLabel,
	MAX_TAG_LENGTH,
	PRESET_TAGS,
	presetTag,
	tagKey,
	themedFilmCount,
	themedFirst,
	themePalette
} from './tags.js';

describe('tag normalisation', () => {
	it('trims and collapses whitespace for the label, keeping its casing', () => {
		expect(cleanTagLabel('  Comfort \t  watch\n')).toBe('Comfort watch');
		expect(cleanTagLabel('Sci-Fi')).toBe('Sci-Fi');
	});

	it('refuses nothing, too much, and anything that is not text', () => {
		expect(cleanTagLabel('   ')).toBeNull();
		expect(cleanTagLabel('x'.repeat(MAX_TAG_LENGTH))).toHaveLength(MAX_TAG_LENGTH);
		expect(cleanTagLabel('x'.repeat(MAX_TAG_LENGTH + 1))).toBeNull();
		expect(cleanTagLabel(undefined)).toBeNull();
		expect(cleanTagLabel(7)).toBeNull();
	});

	it('folds case for the key, so every spelling is one tag', () => {
		const spellings = ['halloween', 'Halloween', ' HALLOWEEN ', 'HalLoWeen'];
		expect(new Set(spellings.map(tagKey))).toEqual(new Set(['halloween']));
		expect(tagKey('  Ana’s   Birthday ')).toBe('ana’s birthday');
	});

	it('folds ASCII only — exactly what SQLite’s lower() does, so the CHECK agrees', () => {
		// `lower('É')` is 'É' in SQLite; a Unicode fold here would write a key the
		// database's "key is folded" CHECK computes differently.
		expect(tagKey('ÉTÉ')).toBe('ÉtÉ');
		expect(tagKey('Noël')).toBe('noël');
	});
});

describe('presets', () => {
	it('are Halloween and Christmas, already folded', () => {
		expect(PRESET_TAGS.map((preset) => preset.label)).toEqual(['Halloween', 'Christmas']);
		for (const preset of PRESET_TAGS) expect(tagKey(preset.label)).toBe(preset.key);
		expect(presetTag('christmas')?.label).toBe('Christmas');
		expect(presetTag('sci-fi')).toBeUndefined();
	});

	it('are the only themes with a palette', () => {
		expect(themePalette('halloween')).toBe('halloween');
		expect(themePalette('christmas')).toBe('christmas');
		expect(themePalette('sci-fi')).toBeNull();
		expect(themePalette(null)).toBeNull();
	});
});

describe('themed films first', () => {
	const card = (id: string, ...keys: string[]) => ({ id, tags: keys.map((key) => ({ key, label: key })) });
	const deck = [card('a'), card('b', 'halloween'), card('c', 'sci-fi'), card('d', 'halloween', 'sci-fi')];

	it('moves the theme’s cards to the top and keeps each half in dealt order', () => {
		expect(themedFirst(deck, 'halloween').map((c) => c.id)).toEqual(['b', 'd', 'a', 'c']);
	});

	it('leaves an unthemed deck exactly as dealt, and never mutates it', () => {
		expect(themedFirst(deck, null).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(themedFirst(deck, 'christmas').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(deck.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('counts in words', () => {
		expect(themedFilmCount(6, 'Halloween')).toBe('6 Halloween films');
		expect(themedFilmCount(1, 'Sci-fi')).toBe('1 Sci-fi film');
	});
});
