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

import { and, eq, isNull } from 'drizzle-orm';
import type { Db, Group, Member } from './db/index.js';
import { groups, members } from './db/index.js';
import { withConfigDefaults, type GroupConfig } from './db/config.js';

const MEMBER_COOKIE_PREFIX = 'member_';

/**
 * Cookie name is keyed by **group id**, not by invite token, which is what makes
 * "regenerate invite link" non-destructive: app-spec, "Existing device sessions
 * survive regeneration; only the link changes."
 */
export function memberCookieName(groupId: string): string {
	return `${MEMBER_COOKIE_PREFIX}${groupId}`;
}

/**
 * The inverse: the group id a cookie name carries, or `undefined` if this cookie
 * is not a member cookie at all. The landing page reads the whole jar, which also
 * holds unrelated site cookies (`swipe_intro_seen`), so the prefix is the filter.
 */
export function groupIdFromCookieName(name: string): string | undefined {
	if (!name.startsWith(MEMBER_COOKIE_PREFIX)) return undefined;
	const groupId = name.slice(MEMBER_COOKIE_PREFIX.length);
	return groupId.length > 0 ? groupId : undefined;
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

/**
 * The member this device's cookie names, or `undefined` if there is no usable one.
 *
 * "Usable" excludes a **removed** member: they are not part of the group's present,
 * so their cookie resolves to nothing and the guard falls through to the picker
 * (see `resolveContext`). This is a filter on a SELECT rather than a check that can
 * throw, which is what guarantees it degrades to "unclaimed" and never to a 500.
 */
export function findMember(db: Db, groupId: string, memberId: string | undefined): Member | undefined {
	if (!memberId) return undefined;
	return db
		.select()
		.from(members)
		.where(and(eq(members.groupId, groupId), eq(members.id, memberId), isNull(members.removedAt)))
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

	// A cookie naming a member who no longer resolves falls back to the picker
	// rather than erroring. Three ways that happens, all one behaviour:
	// a hand-edited or cross-group cookie, a stale id, or — the real case — a member
	// who has been REMOVED from the group. app-spec: "A device whose cookie points at
	// a removed member resolves as *unclaimed* and lands on the picker — the same
	// fallback as a stale cookie, never an error. Removing yourself therefore drops
	// you back to the picker on the spot. Restoring the member makes that cookie work
	// again, since nothing was deleted." The cookie is deliberately NOT deleted here:
	// resolution is a pure read, and a restore should bring the device back with it.
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

/** One group this device is signed into, as the landing page prints it. */
export interface DeviceGroup {
	groupName: string;
	inviteToken: string;
	memberName: string;
}

/**
 * Every group this device holds a usable member cookie for — the landing page's
 * switchboard, and the thing that decides whether `/` redirects.
 *
 * Pure in the cookie jar it is handed, so the route stays a reader: it reports the
 * cookie names that resolved to nothing and lets the caller do the deleting.
 * Unusable here means gone for good from this device's point of view — no group
 * row, or no live member — because unlike `resolveContext` there is no group in
 * the URL to fall back to a picker for, so a cookie that names nothing is only
 * noise in a list of the groups you can walk into.
 *
 * Sorted by group name so the switchboard's order is the app's and not the
 * browser's; the token breaks ties, since two groups may share a name.
 */
export function resolveDeviceGroups(input: {
	db: Db;
	cookies: { name: string; value: string }[];
}): { groups: DeviceGroup[]; staleCookieNames: string[] } {
	const live: DeviceGroup[] = [];
	const staleCookieNames: string[] = [];

	for (const cookie of input.cookies) {
		const groupId = groupIdFromCookieName(cookie.name);
		if (groupId === undefined) continue;

		const group = input.db.select().from(groups).where(eq(groups.id, groupId)).get();
		const member = group ? findMember(input.db, group.id, cookie.value) : undefined;
		if (!group || !member) {
			staleCookieNames.push(cookie.name);
			continue;
		}

		live.push({
			groupName: group.name,
			inviteToken: group.inviteToken,
			memberName: member.displayName
		});
	}

	live.sort(
		(a, b) => a.groupName.localeCompare(b.groupName) || a.inviteToken.localeCompare(b.inviteToken)
	);
	return { groups: live, staleCookieNames };
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
