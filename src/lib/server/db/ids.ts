/**
 * Id and token generation. Kept separate from the schema so it can be used by
 * seed scripts and tests without pulling in a database connection.
 */

/** URL-safe base64 of `bytes` random bytes, no padding. */
function randomToken(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	let binary = '';
	for (const byte of buffer) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Primary keys. Random, opaque, and safe to expose in URLs. */
export function newId(): string {
	return randomToken(16);
}

/**
 * Group invite token: 24 random bytes = 192 bits, comfortably above the
 * app-spec's ≥128-bit requirement. Knowing the token *is* the authentication,
 * so it must be unguessable.
 */
export function newInviteToken(): string {
	return randomToken(24);
}

/**
 * Round seed: a uint32, the domain of the mulberry32 PRNG used for the last
 * link of the tiebreak chain. Persisted at round creation so any tiebreak is
 * reproducible and auditable.
 */
export function newRandomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0];
}
