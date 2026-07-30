import { describe, expect, it } from 'vitest';
import { fnv1a32, memberSeed, mulberry32, seededKey, seededShuffle } from './prng.js';

describe('mulberry32', () => {
	it('produces floats in [0, 1)', () => {
		const rand = mulberry32(12345);
		for (let i = 0; i < 1000; i++) {
			const value = rand();
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	it('is reproducible from the seed', () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		expect([a(), a(), a(), a(), a()]).toEqual([b(), b(), b(), b(), b()]);
	});

	it('diverges for different seeds', () => {
		expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
	});

	it('matches the reference implementation for seed 0', () => {
		// Snapshot of the canonical mulberry32 output; guards against a future
		// "optimisation" silently changing every historical round's tiebreak.
		const rand = mulberry32(0);
		expect([rand(), rand(), rand()].map((v) => Number(v.toFixed(10)))).toEqual([
			0.2664292087, 0.0003297457, 0.2232720274
		]);
	});
});

describe('fnv1a32', () => {
	it('is stable and unsigned', () => {
		expect(fnv1a32('')).toBe(0x811c9dc5);
		const hash = fnv1a32('movie-abc');
		expect(hash).toBe(fnv1a32('movie-abc'));
		expect(hash).toBeGreaterThanOrEqual(0);
		expect(hash).toBeLessThan(2 ** 32);
	});

	it('separates similar ids', () => {
		expect(fnv1a32('m1')).not.toBe(fnv1a32('m2'));
	});
});

describe('seededKey', () => {
	it('is deterministic per (seed, id)', () => {
		expect(seededKey(7, 'm1')).toBe(seededKey(7, 'm1'));
	});

	it('does not depend on the order ids are visited in', () => {
		// The key is a pure function of (seed, id), not a draw from a shared
		// stream — otherwise DB row order would decide tiebreaks.
		const forward = ['m1', 'm2', 'm3'].map((id) => seededKey(99, id));
		const backward = ['m3', 'm2', 'm1'].map((id) => seededKey(99, id)).reverse();
		expect(forward).toEqual(backward);
	});

	it('changes when the round seed changes', () => {
		const differing = [1, 2, 3, 4, 5].filter((seed) => seededKey(seed, 'm1') !== seededKey(0, 'm1'));
		expect(differing.length).toBeGreaterThan(0);
	});

	it('stays in [0, 1)', () => {
		for (let seed = 0; seed < 50; seed++) {
			for (const id of ['a', 'bb', 'ccc']) {
				const key = seededKey(seed, id);
				expect(key).toBeGreaterThanOrEqual(0);
				expect(key).toBeLessThan(1);
			}
		}
	});
});

describe('seededShuffle', () => {
	it('is a permutation', () => {
		const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const out = seededShuffle(input, 123);
		expect(out.slice().sort((a, b) => a - b)).toEqual(input);
	});

	it('does not mutate its input', () => {
		const input = [1, 2, 3];
		seededShuffle(input, 5);
		expect(input).toEqual([1, 2, 3]);
	});

	it('is reproducible per seed and differs across seeds', () => {
		const input = ['a', 'b', 'c', 'd', 'e', 'f'];
		expect(seededShuffle(input, 8)).toEqual(seededShuffle(input, 8));
		const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => seededShuffle(input, s).join(''));
		expect(new Set(seeds).size).toBeGreaterThan(1);
	});

	it('gives different voters different orders via memberSeed', () => {
		const pairs = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
		const orders = ['ana', 'ben', 'cal', 'dee'].map((m) => seededShuffle(pairs, memberSeed(4242, m)).join(''));
		expect(new Set(orders).size).toBeGreaterThan(1);
		// ...but each voter's order is stable across reloads.
		expect(seededShuffle(pairs, memberSeed(4242, 'ana'))).toEqual(
			seededShuffle(pairs, memberSeed(4242, 'ana'))
		);
	});
});
