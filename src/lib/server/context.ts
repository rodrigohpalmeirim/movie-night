/**
 * Request context: resolve a group from the invite token in the URL and a member
 * from the per-group cookie.
 *
 * app-spec: "Knowing the token *is* the authentication. All group data lives
 * behind it. There is no other credential." And: the member cookie "must be set
 * server-side (HTTP `Set-Cookie`, long `Max-Age`), never via `document.cookie` or
 * `localStorage` — Safari's tracking prevention caps script-written storage at
 * ~7 days".
 *
 * The resolution itself is a pure function of (db, token, cookie value) so
 * `hooks.server.ts` stays a three-line adapter and the guard is testable without
 * a server.
 */

import { and, eq } from 'drizzle-orm';
import type { Db, Group, Member } from './db/index.js';
import { groups, members } from './db/index.js';
import { withConfigDefaults, type GroupConfig } from './db/config.js';

/**
 * Cookie name is keyed by **group id**, not by invite token, which is what makes
 * "regenerate invite link" non-destructive: app-spec, "Existing device sessions
 * survive regeneration; only the link changes."
 */
export function memberCookieName(groupId: string): string {
	return `member_${groupId}`;
}

/** One year. Long enough that a monthly movie night never re-picks a name. */
export const MEMBER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const MEMBER_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: MEMBER_COOKIE_MAX_AGE
} as const;

export function findGroupByToken(db: Db, token: string): Group | undefined {
	if (typeof token !== 'string' || token.length === 0) return undefined;
	return db.select().from(groups).where(eq(groups.inviteToken, token)).get();
}

export function findMember(db: Db, groupId: string, memberId: string | undefined): Member | undefined {
	if (!memberId) return undefined;
	return db
		.select()
		.from(members)
		.where(and(eq(members.groupId, groupId), eq(members.id, memberId)))
		.get();
}

export type GroupResolution =
	/** Unknown token → 404. The token is the only credential; a bad one is a bad URL. */
	| { kind: 'unknown_group' }
	/** Valid token, no usable member cookie → member picker. */
	| { kind: 'need_member'; group: Group; config: GroupConfig }
	| { kind: 'ok'; group: Group; config: GroupConfig; member: Member };

export function resolveContext(input: {
	db: Db;
	token: string;
	memberIdFromCookie: string | undefined;
}): GroupResolution {
	const group = findGroupByToken(input.db, input.token);
	if (!group) return { kind: 'unknown_group' };
	const config = withConfigDefaults(group.config);

	// A cookie naming a member who no longer resolves (wrong group, stale id)
	// falls back to the picker rather than erroring: members are never deleted, so
	// this only happens for a hand-edited or cross-group cookie.
	const member = findMember(input.db, group.id, input.memberIdFromCookie);
	if (!member) return { kind: 'need_member', group, config };

	return { kind: 'ok', group, config, member };
}

/**
 * Two-step resolution, because the cookie *name* depends on the group id, which
 * only the token lookup can supply. `getCookie` is a plain function so the whole
 * guard is testable without a request object.
 */
export function resolveFromCookies(input: {
	db: Db;
	token: string;
	getCookie: (name: string) => string | undefined;
}): GroupResolution {
	const group = findGroupByToken(input.db, input.token);
	if (!group) return { kind: 'unknown_group' };
	return resolveContext({
		db: input.db,
		token: input.token,
		memberIdFromCookie: input.getCookie(memberCookieName(group.id))
	});
}

/** Everything a service needs to act on behalf of a member. */
export interface ActorContext {
	db: Db;
	group: Group;
	config: GroupConfig;
	member: Member;
	now: Date;
}

export function actorContext(
	resolution: Extract<GroupResolution, { kind: 'ok' }>,
	db: Db,
	now = new Date()
): ActorContext {
	return { db, group: resolution.group, config: resolution.config, member: resolution.member, now };
}

/**
 * Routes under `/g/[token]` that a member may reach *without* a claimed
 * identity — the picker itself and the endpoint that claims a name. Everything
 * else redirects to the picker.
 */
export const MEMBERLESS_ROUTE_IDS = new Set(['/g/[token]/picker', '/g/[token]/claim-member']);

export function requiresMember(routeId: string | null): boolean {
	if (routeId === null) return false;
	if (!routeId.startsWith('/g/[token]')) return false;
	return !MEMBERLESS_ROUTE_IDS.has(routeId);
}
