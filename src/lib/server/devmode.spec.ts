/**
 * DEV_MODE: the developer-only member switcher.
 *
 * The point of these tests is the *off* state. A dev affordance that lets one
 * device become any member of any group whose invite link it holds must be
 * inert — not merely invisible — whenever the flag is unset, so the endpoint is
 * exercised here directly rather than through the bar that renders it.
 *
 * The real route handler is imported and called with a real database, so this
 * covers the actual guard order (flag, then group, then member) instead of a
 * re-implementation of it.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { MEMBER_COOKIE_MAX_AGE, memberCookieName } from './context.js';
import { devModeEnabled } from './devmode.js';
import { createGroup } from './services/groups.js';
import { unwrap } from './result.js';
import { createTestWorld, type TestWorld } from './testing.js';
import { POST } from '../../routes/g/[token]/dev/switch/+server.js';

let world: TestWorld | undefined;
const originalDevMode = process.env.DEV_MODE;

afterEach(() => {
	world?.cleanup();
	world = undefined;
	if (originalDevMode === undefined) delete process.env.DEV_MODE;
	else process.env.DEV_MODE = originalDevMode;
});

interface Jar {
	values: Map<string, string>;
	options: Map<string, Record<string, unknown>>;
}

/**
 * The slice of `RequestEvent` this endpoint touches: locals (populated by
 * `hooks.server.ts` in the real request), the form body, and the cookie jar.
 */
function switchEvent(input: {
	world: TestWorld;
	actor: string;
	form: Record<string, string>;
	jar: Jar;
}): RequestEvent {
	const body = new URLSearchParams(input.form);
	return {
		locals: {
			db: input.world.db,
			group: input.world.group,
			config: input.world.config,
			member: input.world.member(input.actor)
		},
		params: { token: input.world.group.inviteToken },
		request: new Request('http://localhost/g/t/dev/switch', {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body
		}),
		cookies: {
			get: (nameOfCookie: string) => input.jar.values.get(nameOfCookie),
			set: (nameOfCookie: string, value: string, options: Record<string, unknown>) => {
				input.jar.values.set(nameOfCookie, value);
				input.jar.options.set(nameOfCookie, options);
			},
			delete: (nameOfCookie: string) => input.jar.values.delete(nameOfCookie)
		}
	} as unknown as RequestEvent;
}

function emptyJar(): Jar {
	return { values: new Map(), options: new Map() };
}

/** Runs the handler and returns whatever it threw (SvelteKit signals with throws). */
async function invoke(event: RequestEvent): Promise<unknown> {
	try {
		const response = await POST(event);
		return response;
	} catch (thrown) {
		return thrown;
	}
}

describe('the DEV_MODE flag', () => {
	test('only the exact string "1" enables it', () => {
		delete process.env.DEV_MODE;
		expect(devModeEnabled()).toBe(false);
		for (const value of ['', '0', 'true', 'yes', 'on', '2', ' 1']) {
			process.env.DEV_MODE = value;
			expect(devModeEnabled()).toBe(false);
		}
		process.env.DEV_MODE = '1';
		expect(devModeEnabled()).toBe(true);
	});
});

describe('dev/switch with DEV_MODE off', () => {
	test('404s and does not touch the member cookie', async () => {
		delete process.env.DEV_MODE;
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const jar = emptyJar();

		const thrown = await invoke(
			switchEvent({
				world,
				actor: 'Ana',
				form: { member_id: world.member('Ben').id },
				jar
			})
		);

		expect(isHttpError(thrown)).toBe(true);
		if (!isHttpError(thrown)) throw new Error('unreachable');
		expect(thrown.status).toBe(404);
		// The no-op is the assertion that matters: no cookie was written, so the
		// device is still whoever it was.
		expect(jar.values.size).toBe(0);
	});

	test('an existing session is left pointing at the same member', async () => {
		delete process.env.DEV_MODE;
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const cookieName = memberCookieName(world.group.id);
		const jar = emptyJar();
		jar.values.set(cookieName, world.member('Ana').id);

		await invoke(
			switchEvent({ world, actor: 'Ana', form: { member_id: world.member('Ben').id }, jar })
		);

		expect(jar.values.get(cookieName)).toBe(world.member('Ana').id);
		expect(jar.options.size).toBe(0);
	});

	test('"0" and "true" are just as off as unset', async () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		for (const value of ['0', 'true']) {
			process.env.DEV_MODE = value;
			const jar = emptyJar();
			const thrown = await invoke(
				switchEvent({ world, actor: 'Ana', form: { member_id: world.member('Ben').id }, jar })
			);
			expect(isHttpError(thrown) && thrown.status).toBe(404);
			expect(jar.values.size).toBe(0);
		}
	});
});

describe('dev/switch with DEV_MODE on', () => {
	test('switches the member cookie and bounces back to the page', async () => {
		process.env.DEV_MODE = '1';
		world = createTestWorld({ memberNames: ['Ana', 'Ben', 'Cal'] });
		const cookieName = memberCookieName(world.group.id);
		const jar = emptyJar();
		jar.values.set(cookieName, world.member('Ana').id);
		const returnTo = `/g/${world.group.inviteToken}/pool`;

		const thrown = await invoke(
			switchEvent({
				world,
				actor: 'Ana',
				form: { member_id: world.member('Cal').id, return_to: returnTo },
				jar
			})
		);

		expect(isRedirect(thrown)).toBe(true);
		if (!isRedirect(thrown)) throw new Error('unreachable');
		expect(thrown.status).toBe(303);
		expect(thrown.location).toBe(returnTo);

		expect(jar.values.get(cookieName)).toBe(world.member('Cal').id);
		// Same cookie mechanics as the picker: server-set, HTTP-only, long-lived.
		const options = jar.options.get(cookieName);
		expect(options?.httpOnly).toBe(true);
		expect(options?.path).toBe('/');
		expect(options?.maxAge).toBe(MEMBER_COOKIE_MAX_AGE);
	});

	test('a return_to outside the group falls back to the group home', async () => {
		process.env.DEV_MODE = '1';
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const home = `/g/${world.group.inviteToken}`;

		for (const returnTo of ['https://evil.example/', '//evil.example', `${home}/../../`, '/']) {
			const thrown = await invoke(
				switchEvent({
					world,
					actor: 'Ana',
					form: { member_id: world.member('Ben').id, return_to: returnTo },
					jar: emptyJar()
				})
			);
			expect(isRedirect(thrown) && thrown.location).toBe(home);
		}
	});

	test('a member of another group cannot be assumed', async () => {
		process.env.DEV_MODE = '1';
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Other', memberName: 'Outsider' }));
		const jar = emptyJar();

		const thrown = await invoke(
			switchEvent({ world, actor: 'Ana', form: { member_id: other.member.id }, jar })
		);

		expect(isHttpError(thrown) && thrown.status).toBe(404);
		expect(jar.values.size).toBe(0);
	});

	test('a missing member_id is rejected rather than creating a member', async () => {
		process.env.DEV_MODE = '1';
		world = createTestWorld({ memberNames: ['Ana'] });
		const jar = emptyJar();

		const thrown = await invoke(switchEvent({ world, actor: 'Ana', form: {}, jar }));

		expect(isHttpError(thrown)).toBe(true);
		if (!isHttpError(thrown)) throw new Error('unreachable');
		expect(thrown.status).toBe(400);
		expect(jar.values.size).toBe(0);
		expect(world.db.$client.query('select count(*) as n from members').get()).toEqual({ n: 1 });
	});
});
