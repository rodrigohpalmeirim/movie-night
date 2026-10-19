/**
 * The pool's remembered scroll position, tested as policy.
 *
 * `scroll-memory.ts` owns no DOM and no SvelteKit, so every question the layout
 * asks — which screens remember, when an arrival restores, what a recalled
 * position is — is a pure function of a route id, a navigation type and a number.
 */

import { describe, expect, it } from 'vitest';
import {
	MOVIE_ROUTE,
	POOL_ROUTE,
	createScrollMemory,
	memoryKey,
	shouldRestore,
	type NavType
} from './scroll-memory.js';

describe('memoryKey', () => {
	it('files the pool under its path, so each group has its own entry', () => {
		expect(memoryKey(POOL_ROUTE, '/g/abc/pool')).toBe('/g/abc/pool');
		expect(memoryKey(POOL_ROUTE, '/g/xyz/pool')).toBe('/g/xyz/pool');
	});

	it('keeps nothing for any other screen', () => {
		expect(memoryKey(MOVIE_ROUTE, '/g/abc/movies/1')).toBeNull();
		expect(memoryKey('/g/[token]/settings', '/g/abc/settings')).toBeNull();
		expect(memoryKey(null, '/')).toBeNull();
	});
});

describe('shouldRestore', () => {
	const restore = (type: NavType, from: string | null, to: string | null) =>
		shouldRestore({ type, fromRouteId: from, toRouteId: to });

	it('restores the pool on browser back', () => {
		expect(restore('popstate', MOVIE_ROUTE, POOL_ROUTE)).toBe(true);
	});

	it("restores the pool from a film's back-to-the-pool link", () => {
		expect(restore('link', MOVIE_ROUTE, POOL_ROUTE)).toBe(true);
	});

	it('starts the pool at the top when reached from a tab or anywhere else', () => {
		expect(restore('link', '/g/[token]/settings', POOL_ROUTE)).toBe(false);
		expect(restore('link', null, POOL_ROUTE)).toBe(false);
		expect(restore('enter', null, POOL_ROUTE)).toBe(false);
	});

	it('never restores a screen that keeps no position', () => {
		expect(restore('popstate', POOL_ROUTE, MOVIE_ROUTE)).toBe(false);
		expect(restore('popstate', MOVIE_ROUTE, '/g/[token]/settings')).toBe(false);
	});
});

describe('createScrollMemory', () => {
	it('recalls what was remembered, per key', () => {
		const memory = createScrollMemory();
		memory.remember('/g/a/pool', 420);
		memory.remember('/g/b/pool', 90);
		expect(memory.recall('/g/a/pool')).toBe(420);
		expect(memory.recall('/g/b/pool')).toBe(90);
	});

	it('recalls null for a key it has never seen', () => {
		expect(createScrollMemory().recall('/g/a/pool')).toBeNull();
	});

	it('overwrites with the latest position', () => {
		const memory = createScrollMemory();
		memory.remember('k', 100);
		memory.remember('k', 250);
		expect(memory.recall('k')).toBe(250);
	});

	it('treats a return to the top as no position at all', () => {
		const memory = createScrollMemory();
		memory.remember('k', 300);
		memory.remember('k', 0);
		expect(memory.recall('k')).toBeNull();
	});

	it('forgets on request', () => {
		const memory = createScrollMemory();
		memory.remember('k', 300);
		memory.forget('k');
		expect(memory.recall('k')).toBeNull();
	});
});
