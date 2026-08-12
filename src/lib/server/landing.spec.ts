/**
 * The front door: what `/` does with a device's member cookies.
 *
 * app-spec: "`/` is therefore the front door, and it reads the device's `member_*`
 * cookies to decide". There is one installed app, so every launch lands here and
 * this load is the whole routing decision — one group redirects, several print a
 * switchboard, none falls back to the `?g` hint an installed group manifest
 * carries, and `?all` always renders so a one-group device can still reach the lid.
 *
 * The real load is imported and called against a real database and a fake cookie
 * jar, so the resolution, the pruning and the redirects are the actual ones.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { isRedirect } from '@sveltejs/kit';
import { memberCookieName, type DeviceGroup } from './context.js';
import { createGroup, removeMember } from './services/groups.js';
import { unwrap } from './result.js';
import { createTestWorld, type TestWorld } from './testing.js';
import { load } from '../../routes/+page.server.js';

/** The load's own event type, so the fake below is checked against it. */
type LandingEvent = Parameters<typeof load>[0];

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

interface Jar {
	values: Map<string, string>;
	/** Cookie names the load asked to delete, with the path it used. */
	deleted: { name: string; path: string | undefined }[];
}

/**
 * The slice of `RequestEvent` this load touches: the db `hooks.server.ts` puts in
 * locals, the cookie jar, the URL's query and the request method (a form action's
 * re-render must not be redirected away from its error message).
 */
function landingEvent(input: {
	world: TestWorld;
	cookies?: Record<string, string>;
	query?: string;
	method?: string;
}): { event: LandingEvent; jar: Jar } {
	const jar: Jar = { values: new Map(Object.entries(input.cookies ?? {})), deleted: [] };
	const url = new URL(`http://localhost/${input.query ?? ''}`);
	const event = {
		locals: { db: input.world.db, group: null, config: null, member: null },
		route: { id: '/' },
		request: new Request(url, { method: input.method ?? 'GET' }),
		url,
		cookies: {
			get: (name: string) => jar.values.get(name),
			getAll: () => [...jar.values].map(([name, value]) => ({ name, value })),
			set: (name: string, value: string) => jar.values.set(name, value),
			delete: (name: string, options?: { path?: string }) => {
				jar.values.delete(name);
				jar.deleted.push({ name, path: options?.path });
			}
		}
	} as unknown as LandingEvent;
	return { event, jar };
}

interface Landed {
	/** The path the load redirected to, or null if it rendered. */
	redirectedTo: string | null;
	groups: DeviceGroup[];
	jar: Jar;
}

/** Runs the load; SvelteKit signals a redirect by throwing, so catch that too. */
async function land(input: Parameters<typeof landingEvent>[0]): Promise<Landed> {
	const { event, jar } = landingEvent(input);
	try {
		// `PageServerLoad` widens every load's return to `void | …`; this one always
		// returns the page's data, and a redirect leaves through the catch below.
		const data = (await load(event)) as { groups: DeviceGroup[] };
		return { redirectedTo: null, groups: data.groups, jar };
	} catch (thrown) {
		if (!isRedirect(thrown)) throw thrown;
		expect(thrown.status).toBe(303);
		return { redirectedTo: thrown.location, groups: [], jar };
	}
}

/** A second group on the same database, with its own first member. */
function otherGroup(world: TestWorld, name: string, memberName: string) {
	return unwrap(createGroup(world.db, { name, memberName }));
}

describe('the landing page routes by member cookie', () => {
	test('a device with no cookies gets the lid', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
	});

	test('a device with one group is sent straight into it', async () => {
		// One group is not a choice, so it is not a screen.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({
			world,
			cookies: { [memberCookieName(world.group.id)]: world.member('Ana').id }
		});
		expect(landed.redirectedTo).toBe(`/g/${world.group.inviteToken}`);
		expect(landed.jar.deleted).toEqual([]);
	});

	test('a device with two groups gets the switchboard, and both are named', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = otherGroup(world, 'Thursday Cinema', 'Ana of Thursdays');
		const landed = await land({
			world,
			cookies: {
				[memberCookieName(world.group.id)]: world.member('Ana').id,
				[memberCookieName(other.group.id)]: other.member.id
			}
		});

		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([
			{
				groupName: 'Movie Night',
				inviteToken: world.group.inviteToken,
				memberName: 'Ana'
			},
			{
				groupName: 'Thursday Cinema',
				inviteToken: other.group.inviteToken,
				memberName: 'Ana of Thursdays'
			}
		]);
	});

	test('cookies for other things are left alone', async () => {
		// The jar is read whole, because the cookie NAME carries the group id — so
		// everything else in it must be beneath notice.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, cookies: { swipe_intro_seen: '1' } });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
		expect(landed.jar.deleted).toEqual([]);
		expect(landed.jar.values.get('swipe_intro_seen')).toBe('1');
	});
});

describe('cookies that no longer resolve are pruned as they are read', () => {
	test('a removed member’s cookie is ignored and deleted', async () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const cookieName = memberCookieName(world.group.id);
		unwrap(removeMember({ db: world.db, groupId: world.group.id, memberId: world.member('Ben').id }));

		const landed = await land({ world, cookies: { [cookieName]: world.member('Ben').id } });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
		// Deleted with the path it was written with, or the delete names a different
		// cookie than the one being served and clears nothing.
		expect(landed.jar.deleted).toEqual([{ name: cookieName, path: '/' }]);
	});

	test('a live group with a member id that names nobody is deleted', async () => {
		// A hand-edited or cross-group value: the group is real, the identity is not,
		// and there is no group in the URL here to fall back to a picker for.
		world = createTestWorld({ memberNames: ['Ana'] });
		const cookieName = memberCookieName(world.group.id);
		const landed = await land({ world, cookies: { [cookieName]: 'nobody-by-that-id' } });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
		expect(landed.jar.deleted).toEqual([{ name: cookieName, path: '/' }]);
	});

	test('a cookie for a group that is gone is deleted', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, cookies: { member_no_such_group: 'whoever' } });
		expect(landed.groups).toEqual([]);
		expect(landed.jar.deleted).toEqual([{ name: 'member_no_such_group', path: '/' }]);
	});

	test('a dead cookie beside a live one leaves exactly one group, and still redirects', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({
			world,
			cookies: {
				member_no_such_group: 'whoever',
				[memberCookieName(world.group.id)]: world.member('Ana').id
			}
		});
		expect(landed.redirectedTo).toBe(`/g/${world.group.inviteToken}`);
		expect(landed.jar.deleted.map((entry) => entry.name)).toEqual(['member_no_such_group']);
	});
});

describe('“Not you?” blanks the cookie and keeps the group on the switchboard', () => {
	test('a blank cookie for a live group is a memberless row, not a stale one', async () => {
		// The marker the settings `forget` action writes: this device knows the group,
		// nobody has claimed a name on it. Deleting the cookie instead would have taken
		// the group off this list, leaving the invite link as the only way back.
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = otherGroup(world, 'Thursday Cinema', 'Zed');
		const landed = await land({
			world,
			cookies: {
				[memberCookieName(world.group.id)]: world.member('Ana').id,
				[memberCookieName(other.group.id)]: ''
			}
		});

		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([
			{ groupName: 'Movie Night', inviteToken: world.group.inviteToken, memberName: 'Ana' },
			{ groupName: 'Thursday Cinema', inviteToken: other.group.inviteToken, memberName: null }
		]);
		expect(landed.jar.deleted).toEqual([]);
	});

	test('a device whose only group has nobody signed in lands on that group’s picker', async () => {
		// Still one group, so still not a screen — but the door is the picker, since
		// the group home would only bounce there.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, cookies: { [memberCookieName(world.group.id)]: '' } });
		expect(landed.redirectedTo).toBe(`/g/${world.group.inviteToken}/picker`);
		expect(landed.jar.deleted).toEqual([]);
	});

	test('a blank cookie for a group that is gone is pruned like any other', async () => {
		// No group row is the one thing the picker cannot mend.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, cookies: { member_no_such_group: '' } });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
		expect(landed.jar.deleted).toEqual([{ name: 'member_no_such_group', path: '/' }]);
	});

	test('?all prints the memberless row rather than redirecting', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({
			world,
			cookies: { [memberCookieName(world.group.id)]: '' },
			query: '?all'
		});
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([
			{ groupName: 'Movie Night', inviteToken: world.group.inviteToken, memberName: null }
		]);
	});
});

describe('the ?g bootstrap, for an installed app’s empty cookie jar', () => {
	test('no cookies plus a real token redirects into that group', async () => {
		// An iOS PWA launches with an EMPTY cookie jar, so the token in the group
		// manifest's start_url is the only thing that can get the first launch home.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, query: `?g=${world.group.inviteToken}` });
		expect(landed.redirectedTo).toBe(`/g/${world.group.inviteToken}`);
	});

	test('an unknown token is simply the landing page', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		for (const query of ['?g=not-a-real-token', '?g=']) {
			const landed = await land({ world, query });
			expect(landed.redirectedTo).toBeNull();
			expect(landed.groups).toEqual([]);
		}
	});

	test('cookies win: a hint naming another group is ignored', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = otherGroup(world, 'Thursday Cinema', 'Zed');
		const landed = await land({
			world,
			cookies: { [memberCookieName(world.group.id)]: world.member('Ana').id },
			query: `?g=${other.group.inviteToken}`
		});
		expect(landed.redirectedTo).toBe(`/g/${world.group.inviteToken}`);
	});
});

describe('?all is the escape hatch', () => {
	test('one group renders the switchboard instead of redirecting', async () => {
		// Without this a device with exactly one group could never see the create
		// form again: `/` would bounce it home every time.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({
			world,
			cookies: { [memberCookieName(world.group.id)]: world.member('Ana').id },
			query: '?all'
		});
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([
			{ groupName: 'Movie Night', inviteToken: world.group.inviteToken, memberName: 'Ana' }
		]);
	});

	test('it beats the ?g hint too', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({ world, query: `?all&g=${world.group.inviteToken}` });
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups).toEqual([]);
	});
});

describe('regression: the create form’s errors survive', () => {
	test('a POST is never redirected by this logic', async () => {
		// The action re-renders this page on a rejected name, and a member of one
		// group must read why rather than be swept into their group.
		world = createTestWorld({ memberNames: ['Ana'] });
		const landed = await land({
			world,
			cookies: { [memberCookieName(world.group.id)]: world.member('Ana').id },
			method: 'POST'
		});
		expect(landed.redirectedTo).toBeNull();
		expect(landed.groups.map((group) => group.groupName)).toEqual(['Movie Night']);
	});
});
