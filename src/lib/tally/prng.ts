/**
 * Seeded randomness for the last link of the tiebreak chain.
 *
 * voting-spec: "Seeded random, recorded on the round so the result is
 * reproducible and auditable" / "Persist random_seed per round at creation so
 * any tiebreak is reproducible if someone disputes the result."
 *
 * Algorithm: **mulberry32** — a 32-bit PRNG by Tommy Ettinger (public domain).
 * Chosen because it is ~6 lines, has no state beyond one uint32, passes
 * gjrand's basic suite, and is trivially portable, so an auditor can reproduce
 * a result by hand from the stored seed. Cryptographic strength is explicitly
 * not required: the seed is public after the reveal.
 */

/** Returns a generator producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return function next(): number {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a, 32-bit. Turns an id string into a stable uint32. */
export function fnv1a32(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash >>> 0;
}

/**
 * A deterministic pseudo-random sort key in [0, 1) for one id under one seed.
 *
 * Deriving the key from `(seed, id)` rather than from successive draws of a
 * single generator matters: the key must not depend on the order in which
 * candidates happen to arrive from the database, or the "deterministic, never
 * by insertion order" requirement would be violated.
 */
export function seededKey(seed: number, id: string): number {
	return mulberry32((seed ^ fnv1a32(id)) >>> 0)();
}

/**
 * Deterministic Fisher-Yates shuffle. Used for the per-voter pairwise order
 * (app-spec: "the pairwise screens, one pair at a time, in per-user shuffled
 * order"); seeding it per (round, member) keeps a voter's order stable across
 * reloads without storing it.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
	const out = items.slice();
	const rand = mulberry32(seed >>> 0);
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Combines a round seed with a member id so each voter gets a distinct order. */
export function memberSeed(seed: number, memberId: string): number {
	return (seed ^ fnv1a32(memberId)) >>> 0;
}
