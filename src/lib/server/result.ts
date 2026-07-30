/**
 * Service result type. Services never throw for expected outcomes and never
 * import from SvelteKit; routes translate `code` into an HTTP status.
 */

export type ErrorCode =
	| 'unknown_group'
	| 'unknown_member'
	| 'unknown_movie'
	| 'unknown_round'
	| 'name_taken'
	| 'invalid_input'
	| 'active_round_exists'
	/** A conditional UPDATE matched nothing: someone else advanced first. */
	| 'state_changed'
	| 'illegal_transition'
	| 'not_enough_attendees'
	| 'wrong_phase'
	| 'not_attending'
	| 'no_winner_to_watch'
	| 'rewatch_cooldown'
	| 'rate_limited'
	| 'tmdb_unavailable';

export const HTTP_STATUS: Record<ErrorCode, number> = {
	unknown_group: 404,
	unknown_member: 404,
	unknown_movie: 404,
	unknown_round: 404,
	name_taken: 409,
	invalid_input: 400,
	active_round_exists: 409,
	// 409, not 500: two friends tapping "Reveal" at once is normal, and the
	// loser's request is a successful no-op from the group's point of view.
	state_changed: 409,
	illegal_transition: 409,
	not_enough_attendees: 422,
	wrong_phase: 409,
	not_attending: 403,
	no_winner_to_watch: 409,
	rewatch_cooldown: 409,
	rate_limited: 429,
	tmdb_unavailable: 503
};

export interface Failure {
	ok: false;
	code: ErrorCode;
	message: string;
}

export interface Success<T> {
	ok: true;
	value: T;
}

export type Result<T> = Success<T> | Failure;

export function ok<T>(value: T): Success<T> {
	return { ok: true, value };
}

export function fail(code: ErrorCode, message: string): Failure {
	return { ok: false, code, message };
}

export function statusOf(failure: Failure): number {
	return HTTP_STATUS[failure.code];
}

/** Narrowing helper for tests and routes. */
export function unwrap<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
	return result.value;
}
