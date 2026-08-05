/**
 * The group's web app manifest.
 *
 * app-spec: "There is **one app** ... What differs is where the icon starts." So
 * the whole of this endpoint is `static/manifest.webmanifest` with `start_url`
 * rewritten to `/?g=<token>`, and these tests pin exactly that: identical except
 * that one field, the hint actually present in it, and the two things that would
 * quietly undo the model — a second app identity, or a publicly cacheable response
 * (the body carries the invite token).
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

describe('installing from inside a group installs the app, started at the group', () => {
	test('the start_url carries the group as a hint on the root page', async () => {
		// The empty-cookie-jar bootstrap: an iOS PWA's first launch has no member
		// cookie, so the token in the query is the only thing that can get it home.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { response, body } = await manifestOf(world, world.group);
		expect(response.status).toBe(200);
		expect(body.start_url).toBe(`/?g=${world.group.inviteToken}`);
	});

	test('the identity and scope stay the app’s, so two groups are one install', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Thursday Cinema', memberName: 'Zed' }));
		const mine = await manifestOf(world, world.group);
		const theirs = await manifestOf(world, other.group);

		expect(mine.body.id).toBe('/');
		expect(mine.body.scope).toBe('/');
		// Same id means the second install replaces nothing and adds no second icon.
		expect(mine.body.id).toBe(theirs.body.id);
		// ...and only the start_url tells the two manifests apart.
		expect(mine.body.start_url).not.toBe(theirs.body.start_url);
	});

	test('the icon is labelled with the app’s name, not the group’s', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = unwrap(createGroup(world.db, { name: 'Thursday Cinema', memberName: 'Zed' }));
		const { body } = await manifestOf(world, other.group);
		expect(body.name).toBe('Movie Night');
		expect(body.short_name).toBe('Movie Night');
	});

	test('the start_url is inside the scope', async () => {
		// A start_url outside its own scope makes the manifest uninstallable.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { body } = await manifestOf(world, world.group);
		expect(String(body.start_url).startsWith(String(body.scope))).toBe(true);
	});

	test('it is served as a manifest and cached privately', async () => {
		// The start_url embeds the invite token, which IS the credential: a shared
		// cache holding it would hand one group's link to whoever asked next.
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

	test('it is the static manifest, identical except start_url', async () => {
		// The static manifest stays the landing page's, and the two must not drift:
		// same identity, same names, same felt colours, same icons — one field apart.
		world = createTestWorld({ memberNames: ['Ana'] });
		const { body } = await manifestOf(world, world.group);

		// No field was added, renamed or forgotten, and the order is the same too.
		expect(Object.keys(body)).toEqual(Object.keys(STATIC_MANIFEST));
		const differing = Object.keys(STATIC_MANIFEST).filter(
			(key) => JSON.stringify(body[key]) !== JSON.stringify(STATIC_MANIFEST[key])
		);
		expect(differing).toEqual(['start_url']);
	});
});

describe('regression: exactly one manifest link, and it is the layout’s', () => {
	test('app.html no longer hardcodes the manifest or the iOS title', () => {
		// Browsers honour the FIRST rel=manifest in document order, so a link left
		// in app.html would beat the group's own and the hint would never be read.
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

	test('the iOS home-screen title is the app’s, not the group’s', () => {
		// One app means one label: a per-group title would name whichever group the
		// install happened to start from, on an icon shared by all of them.
		const layout = readFileSync('src/routes/+layout.svelte', 'utf8');
		expect(layout).toContain("const installTitle = 'Movie Night'");
		expect(layout).not.toContain('page.data.groupName');
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
