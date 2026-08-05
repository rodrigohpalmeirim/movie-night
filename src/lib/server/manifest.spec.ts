/**
 * The per-group web app manifest.
 *
 * app-spec: "installing from inside a group installs *that group*". The point of
 * these tests is the four fields that make that true — `id`, `start_url`, `scope`
 * and the pair of names — plus the two things that would quietly undo it: a
 * publicly cacheable response (the body carries the invite token) and drift away
 * from `static/manifest.webmanifest`, which stays the landing page's manifest.
 *
 * The real route handler is imported and called with a real database, so the
 * token resolution and the 404 are the actual ones.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { isHttpError } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { createGroup } from './services/groups.js';
import { unwrap } from './result.js';
import { createTestWorld, type TestWorld } from './testing.js';
import { GET } from '../../routes/g/[token]/manifest.webmanifest/+server.js';

/** The handler's own event type, so the fake below is checked against it. */
type ManifestEvent = Parameters<typeof GET>[0];

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

/**
 * The slice of `RequestEvent` this endpoint touches: the locals that
 * `hooks.server.ts` fills from the invite token. `group: null` is exactly what
 * the hook leaves behind for an unknown token — it resolves, it never rejects.
 */
function manifestEvent(input: {
	world: TestWorld;
	group: TestWorld['group'] | null;
}): ManifestEvent {
	const token = input.group?.inviteToken ?? 'not-a-real-token';
	return {
		locals: {
			db: input.world.db,
			group: input.group,
			config: input.group ? input.world.config : null,
			member: null
		},
		params: { token },
		route: { id: '/g/[token]/manifest.webmanifest' },
		request: new Request(`http://localhost/g/${token}/manifest.webmanifest`),
		url: new URL(`http://localhost/g/${token}/manifest.webmanifest`)
	} as unknown as ManifestEvent;
}

/** Runs the handler; SvelteKit signals failure by throwing, so catch that too. */
async function invoke(event: ManifestEvent): Promise<Response | unknown> {
	try {
		return await GET(event);
	} catch (thrown) {
		return thrown;
	}
}

async function manifestOf(world: TestWorld, group: TestWorld['group']) {
	const response = (await invoke(manifestEvent({ world, group }))) as Response;
	expect(response instanceof Response).toBe(true);
	return {
		response,
		body: (await response.json()) as Record<string, unknown>
	};
}

const STATIC_MANIFEST = JSON.parse(
	readFileSync('static/manifest.webmanifest', 'utf8')
) as Record<string, unknown>;

describe('installing from inside a group installs that group', () => {
	test('start_url, scope and id are all the group URL', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const { response, body } = await manifestOf(world, world.group);
		const token = world.group.inviteToken;

		expect(response.status).toBe(200);
		expect(body.start_url).toBe(`/g/${token}`);
		expect(body.scope).toBe(`/g/${token}`);
		expect(body.id).toBe(`/g/${token}`);
	});

	test('the scope has no trailing slash, so the start_url is inside it', async () => {
		// `/g/<token>/` would put the extensionless start_url out of its own scope,
		// and a start_url outside the scope makes the manifest uninstallable.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { body } = await manifestOf(world, world.group);
		expect(String(body.scope).endsWith('/')).toBe(false);
		expect(String(body.start_url).startsWith(String(body.scope))).toBe(true);
	});

	test('the icon is labelled with the group name, not the app name', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Thursday Cinema', memberName: 'Zed' }));
		const { body } = await manifestOf(world, other.group);
		expect(body.name).toBe('Thursday Cinema');
		expect(body.short_name).toBe('Thursday Cinema');
		// The description describes the app, so it does not change per group.
		expect(body.description).toBe(STATIC_MANIFEST.description);
	});

	test('two groups get two identities, so both can be installed at once', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Thursday Cinema', memberName: 'Zed' }));
		const mine = await manifestOf(world, world.group);
		const theirs = await manifestOf(world, other.group);
		expect(mine.body.id).not.toBe(theirs.body.id);
	});

	test('it is served as a manifest and cached privately', async () => {
		// The body embeds the invite token, which IS the credential: a shared cache
		// holding it would hand one group's link to whoever asked next.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { response } = await manifestOf(world, world.group);
		expect(response.headers.get('content-type')).toBe('application/manifest+json');
		const cacheControl = response.headers.get('cache-control') ?? '';
		expect(cacheControl).toContain('private');
		expect(cacheControl).not.toContain('public');
	});

	test('an unknown token 404s, like every other route under /g/[token]', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const thrown = await invoke(manifestEvent({ world, group: null }));
		expect(isHttpError(thrown)).toBe(true);
		expect((thrown as { status: number }).status).toBe(404);
	});

	test('everything else matches the static manifest', async () => {
		// The static manifest stays the landing page's, and the two must not drift:
		// same felt colours, same display mode, same icons.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { body } = await manifestOf(world, world.group);
		for (const key of [
			'description',
			'lang',
			'dir',
			'categories',
			'display',
			'orientation',
			'background_color',
			'theme_color',
			'icons'
		]) {
			expect(body[key]).toEqual(STATIC_MANIFEST[key]);
		}
		// And no field of the static manifest was simply forgotten.
		expect(Object.keys(body).sort()).toEqual(Object.keys(STATIC_MANIFEST).sort());
	});
});

describe('regression: exactly one manifest link, and it is the layout’s', () => {
	test('app.html no longer hardcodes the manifest or the iOS title', () => {
		// Browsers honour the FIRST rel=manifest in document order, so a link left
		// in app.html would beat the group's own and every install would open the
		// create-a-group screen again.
		const html = readFileSync('src/app.html', 'utf8');
		expect(html).not.toMatch(/rel="manifest"/);
		expect(html).not.toMatch(/name="apple-mobile-web-app-title"/);
	});

	test('the root layout emits both, once each', () => {
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout.match(/rel="manifest"/g)?.length).toBe(1);
		expect(layout.match(/name="apple-mobile-web-app-title"/g)?.length).toBe(1);
		// Group pages point at the group's manifest, everything else at the static one.
		expect(layout).toContain('/manifest.webmanifest');
		expect(layout).toContain('page.params.token');
	});

	test('no other component emits a manifest link or an iOS title', () => {
		const offenders = [...new Bun.Glob('src/**/*.svelte').scanSync('.')].filter((file) => {
			if (file.replace(/\\/g, '/') === 'src/routes/+layout.svelte') return false;
			const source = readFileSync(file, 'utf8');
			return /rel="manifest"|name="apple-mobile-web-app-title"/.test(source);
		});
		expect(offenders).toEqual([]);
	});
});
