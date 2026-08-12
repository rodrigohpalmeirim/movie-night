/**
 * Entry guards: invite-token resolution, the member cookie flow, and the
 * route-level member requirement that `hooks.server.ts` applies.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	MEMBER_COOKIE_MAX_AGE,
	MEMBER_COOKIE_OPTIONS,
	memberCookieName,
	requiresMember,
	resolveContext,
	resolveFromCookies
} from './context.js';
import {
	claimMember,
	createGroup,
	listMembers,
	renameMember,
	regenerateInviteToken
} from './services/groups.js';
import { createGroupLimiter } from './ratelimit.js';
import { unwrap } from './result.js';
import { createTestWorld, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

describe('invite token is the only credential', () => {
	test('an unknown token resolves to unknown_group (the route 404s)', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const resolution = resolveFromCookies({
			db: world.db,
			token: 'not-a-real-token',
			getCookie: () => undefined
		});
		expect(resolution.kind).toBe('unknown_group');
	});

	test('an empty token resolves to unknown_group', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(resolveFromCookies({ db: world.db, token: '', getCookie: () => undefined }).kind).toBe(
			'unknown_group'
		);
	});

	test('the real token resolves the group and its config', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const resolution = resolveFromCookies({
			db: world.db,
			token: world.group.inviteToken,
			getCookie: () => undefined
		});
		expect(resolution.kind).toBe('need_member');
		if (resolution.kind === 'unknown_group') throw new Error('unreachable');
		expect(resolution.group.id).toBe(world.group.id);
		expect(resolution.config.n_finalists).toBe(5);
	});

	test('the token is >=128 bits of URL-safe randomness', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const token = world.group.inviteToken;
		// 24 random bytes → 32 base64url chars → 192 bits.
		expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
		const second = unwrap(createGroup(world.db, { name: 'Other', memberName: 'Zed' }));
		expect(second.group.inviteToken).not.toBe(token);
	});
});

describe('member cookie flow', () => {
	test('no cookie → need_member; after claiming → ok', () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const cookies = new Map<string, string>();
		const read = (name: string) => cookies.get(name);

		const before = resolveFromCookies({ db: world.db, token: world.group.inviteToken, getCookie: read });
		expect(before.kind).toBe('need_member');

		// The picker claims a name and the server sets the cookie.
		const claimed = unwrap(claimMember(world.db, { groupId: world.group.id, memberId: world.member('Ben').id }));
		cookies.set(memberCookieName(world.group.id), claimed.id);

		const after = resolveFromCookies({ db: world.db, token: world.group.inviteToken, getCookie: read });
		expect(after.kind).toBe('ok');
		if (after.kind !== 'ok') throw new Error('unreachable');
		expect(after.member.displayName).toBe('Ben');
	});

	test('the cookie is HTTP-only, path-wide and long-lived', () => {
		// Safari caps script-written storage at ~7 days, so this must be a real
		// Set-Cookie with a long Max-Age.
		expect(MEMBER_COOKIE_OPTIONS.httpOnly).toBe(true);
		expect(MEMBER_COOKIE_OPTIONS.path).toBe('/');
		expect(MEMBER_COOKIE_OPTIONS.sameSite).toBe('lax');
		expect(MEMBER_COOKIE_MAX_AGE).toBeGreaterThan(60 * 60 * 24 * 90);
	});

	test('a cookie naming a member of another group falls back to the picker', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Other group', memberName: 'Outsider' }));
		const resolution = resolveContext({
			db: world.db,
			token: world.group.inviteToken,
			memberIdFromCookie: other.member.id
		});
		expect(resolution.kind).toBe('need_member');
	});

	test('a stale cookie falls back to the picker rather than erroring', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(
			resolveContext({
				db: world.db,
				token: world.group.inviteToken,
				memberIdFromCookie: 'deleted-long-ago'
			}).kind
		).toBe('need_member');
	});

	test('the blank “Not you?” marker resolves as unclaimed, exactly like no cookie', () => {
		// "Not you?" rewrites the cookie EMPTY instead of deleting it, so that the group
		// stays on the device's landing switchboard. Every identity-resolving path must
		// read that as "nobody has claimed a name here" — the picker — and never as an
		// error or a member.
		world = createTestWorld({ memberNames: ['Ana'] });
		const cookies = new Map([[memberCookieName(world.group.id), '']]);
		const resolution = resolveFromCookies({
			db: world.db,
			token: world.group.inviteToken,
			getCookie: (name) => cookies.get(name)
		});
		expect(resolution.kind).toBe('need_member');
		if (resolution.kind === 'unknown_group') throw new Error('unreachable');
		expect(resolution.group.id).toBe(world.group.id);
	});

	test('regenerating the invite link kills the old URL but keeps the session', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const oldToken = world.group.inviteToken;
		const cookieName = memberCookieName(world.group.id);
		const cookies = new Map([[cookieName, world.member('Ana').id]]);

		const regenerated = unwrap(regenerateInviteToken(world.db, world.group.id));
		expect(regenerated.inviteToken).not.toBe(oldToken);

		// Old link is dead...
		expect(
			resolveFromCookies({ db: world.db, token: oldToken, getCookie: (n) => cookies.get(n) }).kind
		).toBe('unknown_group');
		// ...and the device is still signed in on the new one, because the cookie is
		// keyed by group id rather than by token.
		expect(
			resolveFromCookies({
				db: world.db,
				token: regenerated.inviteToken,
				getCookie: (n) => cookies.get(n)
			}).kind
		).toBe('ok');
	});
});

describe('which routes require a claimed member', () => {
	test('the picker and claim endpoint do not; everything else under /g/[token] does', () => {
		expect(requiresMember('/g/[token]/picker')).toBe(false);
		expect(requiresMember('/g/[token]/claim-member')).toBe(false);
		expect(requiresMember('/g/[token]')).toBe(true);
		expect(requiresMember('/g/[token]/round/veto')).toBe(true);
		expect(requiresMember('/g/[token]/events')).toBe(true);
		expect(requiresMember('/g/[token]/settings')).toBe(true);
	});

	test('routes outside the group shell are unguarded', () => {
		expect(requiresMember('/')).toBe(false);
		expect(requiresMember(null)).toBe(false);
	});
});

describe('claiming a name', () => {
	test('display names are unique per group, and the DB is the real guard', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const duplicate = claimMember(world.db, { groupId: world.group.id, name: 'Ana' });
		expect(duplicate.ok).toBe(false);
		if (duplicate.ok) throw new Error('unreachable');
		expect(duplicate.code).toBe('name_taken');

		// ...but the same name in a different group is fine.
		const other = unwrap(createGroup(world.db, { name: 'Other', memberName: 'Zed' }));
		expect(claimMember(world.db, { groupId: other.group.id, name: 'Ana' }).ok).toBe(true);
	});

	test('names are trimmed and whitespace-collapsed', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const member = unwrap(claimMember(world.db, { groupId: world.group.id, name: '  Ben   Two  ' }));
		expect(member.displayName).toBe('Ben Two');
	});

	test('an empty or oversized name is rejected', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		for (const name of ['', '   ', 'x'.repeat(81)]) {
			const result = claimMember(world.db, { groupId: world.group.id, name });
			expect(result.ok).toBe(false);
		}
	});

	test('claiming an unknown member id fails', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const result = claimMember(world.db, { groupId: world.group.id, memberId: 'nope' });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.code).toBe('unknown_member');
	});
});

describe('group creation', () => {
	test('creates the group, the first member, and their fairness row', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const fairnessRow = world.db.$client
			.query<{ member_id: string; wins_count: number }, [string]>(
				'select member_id, wins_count from fairness where member_id = ?'
			)
			.get(world.member('Ana').id);
		expect(fairnessRow?.wins_count).toBe(0);
	});

	test('rejects a missing group or member name', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(createGroup(world.db, { name: '', memberName: 'Ana' }).ok).toBe(false);
		expect(createGroup(world.db, { name: 'Nice', memberName: '  ' }).ok).toBe(false);
	});

	test('is rate limited per address', () => {
		createGroupLimiter.reset();
		const allowed: boolean[] = [];
		for (let i = 0; i < 7; i++) allowed.push(createGroupLimiter.check('203.0.113.7').allowed);
		expect(allowed).toEqual([true, true, true, true, true, false, false]);
		// A different address is unaffected.
		expect(createGroupLimiter.check('198.51.100.1').allowed).toBe(true);
		createGroupLimiter.reset();
	});

	test('the rate-limit window expires', () => {
		createGroupLimiter.reset();
		const start = 1_000_000;
		for (let i = 0; i < 5; i++) createGroupLimiter.check('192.0.2.9', start);
		expect(createGroupLimiter.check('192.0.2.9', start).allowed).toBe(false);
		expect(createGroupLimiter.check('192.0.2.9', start + 60 * 60 * 1000 + 1).allowed).toBe(true);
		createGroupLimiter.reset();
	});
});

/* ------------------------------------------------------------------ */
/* Regressions from the adversarial review                            */
/* ------------------------------------------------------------------ */

describe('regression: member names are unique case-insensitively', () => {
	test('"ana" cannot join alongside "Ana"', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		for (const variant of ['ana', 'ANA', '  AnA  ']) {
			const result = claimMember(world.db, { groupId: world.group.id, name: variant });
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error('unreachable');
			expect(result.code).toBe('name_taken');
		}
		expect(listMembers(world.db, world.group.id).length).toBe(1);
	});

	test('display casing is preserved as typed', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const ben = unwrap(claimMember(world.db, { groupId: world.group.id, name: 'BeN' }));
		expect(ben.displayName).toBe('BeN');
	});

	test('the database enforces it even if the service check is bypassed', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		let threw = false;
		try {
			world.db.$client.run('insert into members (id, group_id, display_name) values (?, ?, ?)', [
				'forced',
				world.group.id,
				'ANA'
			]);
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});

	test('renaming onto an existing name case-insensitively is rejected', () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const result = renameMember(world.db, {
			groupId: world.group.id,
			memberId: world.member('Ana').id,
			name: 'ben'
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.code).toBe('name_taken');
		// Renaming to a different casing of your OWN name still works.
		expect(
			renameMember(world.db, {
				groupId: world.group.id,
				memberId: world.member('Ana').id,
				name: 'ANA'
			}).ok
		).toBe(true);
	});

	test('the same name in another group is still fine', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Other', memberName: 'Zed' }));
		expect(claimMember(world.db, { groupId: other.group.id, name: 'ana' }).ok).toBe(true);
	});
});

describe('regression: the entry guard rejects from inside resolve()', () => {
	test('hooks resolution leaves locals null instead of throwing', () => {
		// The hook must not throw: a response produced by a throwing `handle` never
		// passes back through it, so it shipped without `Referrer-Policy` — on
		// exactly the responses whose URL contains an invite token.
		world = createTestWorld({ memberNames: ['Ana'] });
		const unknown = resolveFromCookies({
			db: world.db,
			token: 'nope',
			getCookie: () => undefined
		});
		expect(unknown.kind).toBe('unknown_group');
		const noMember = resolveFromCookies({
			db: world.db,
			token: world.group.inviteToken,
			getCookie: () => undefined
		});
		expect(noMember.kind).toBe('need_member');
	});
});

describe('regression: the dev seed refuses to run without an explicit opt-in', () => {
	test('it exits non-zero unless DEV_MODE=1 or --force', async () => {
		// The script pins the guessable invite token `dev-movie-club`, and the token
		// IS the credential — one stray run against a production DATABASE_URL would
		// publish a permanently open group.
		const dir = mkdtempSync(join(tmpdir(), 'movie-voting-seedguard-'));
		try {
			const blocked = Bun.spawnSync({
				cmd: ['bun', 'run', 'scripts/seed.ts'],
				env: { ...process.env, DEV_MODE: '', DATABASE_URL: join(dir, 'guard.db') },
				stdout: 'pipe',
				stderr: 'pipe'
			});
			expect(blocked.exitCode).not.toBe(0);
			expect(new TextDecoder().decode(blocked.stderr)).toContain('refusing to seed');
			// It must not have created anything.
			expect(existsSync(join(dir, 'guard.db'))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('regression: the SSE keep-alive fits inside the adapter idle timeout', () => {
	test('the default heartbeat is under Bun’s 10s default idleTimeout', () => {
		// A 25s heartbeat against a 10s idle timeout killed every stream at ~12s and
		// made every tab reconnect forever.
		const source = readFileSync('src/routes/g/[token]/events/+server.ts', 'utf8');
		const match = source.match(/SSE_KEEPALIVE_MS \?\? (\d+)/);
		expect(match).not.toBeNull();
		expect(Number(match![1])).toBeLessThan(10_000);
		// ...and the deployment guidance raises both together.
		const env = readFileSync('.env.example', 'utf8');
		expect(env).toContain('IDLE_TIMEOUT');
		expect(env).toContain('SSE_KEEPALIVE_MS');
		const idle = Number(env.match(/^IDLE_TIMEOUT=(\d+)$/m)![1]) * 1000;
		const keepAlive = Number(env.match(/^SSE_KEEPALIVE_MS=(\d+)$/m)![1]);
		expect(keepAlive).toBeLessThan(idle);
	});

	test('.env.example warns that ADDRESS_HEADER is mandatory behind a proxy', () => {
		const env = readFileSync('.env.example', 'utf8');
		expect(env).toContain('ADDRESS_HEADER is NOT optional behind a proxy');
		expect(env).toContain('ONE GLOBAL BUCKET');
	});
});
