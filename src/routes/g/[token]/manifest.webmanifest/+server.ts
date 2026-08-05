/**
 * The group's own web app manifest.
 *
 * app-spec: "Mobile-first, installable PWA (manifest + icons + theme color)."
 * `static/manifest.webmanifest` is that, for the landing page — but its
 * `start_url` is `/`, so a member who installed from inside their group got an
 * icon that opened the create-a-group screen. Installing from a group must land
 * back in that group, so every group serves its own manifest, differing from the
 * static one in exactly four fields:
 *
 * - `id` is `/g/<token>`, which is the app *identity* a browser keys an install
 *   on. Distinct ids are what let two groups be installed side by side instead
 *   of the second overwriting the first.
 * - `start_url` is `/g/<token>`: the round screen, the group's front door.
 * - `scope` is the same string, deliberately with no trailing slash — `/g/<t>/`
 *   would leave the extensionless `start_url` outside its own scope.
 * - `name` and `short_name` are both the group's name. `short_name` is the label
 *   under the icon, and with several groups installed the group's name is the
 *   only thing that tells them apart; "Movie Night" three times over is no
 *   label at all. The description stays as written — it describes the app.
 *
 * Everything else is copied from the static manifest, and `manifest.spec.ts`
 * fails if the two ever drift. The icon paths are absolute, so they resolve the
 * same from this scope as from the root.
 */

import { requireGroup } from '$lib/server/http.js';
import type { RequestHandler } from './$types';

/**
 * Shared with `static/manifest.webmanifest` (the spec test pins them equal).
 * Not imported from it: the route is loaded directly by `bun test`, which has no
 * Vite `?raw` loader, and reading the file at runtime would depend on the shape
 * of the build output.
 */
const SHARED = {
	description: 'Pick what to watch, together.',
	lang: 'en',
	dir: 'ltr',
	categories: ['entertainment', 'social'],
	display: 'standalone',
	orientation: 'portrait',
	background_color: '#4c141c',
	theme_color: '#4c141c',
	icons: [
		{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
		{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
		{ src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
		{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
		{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
	]
} as const;

export const GET: RequestHandler = (event) => {
	// Unknown token → 404, like every other route under /g/[token]. No member is
	// required: a manifest is fetched by the browser itself, often without the
	// cookie, and it says nothing a group member does not already see in the URL.
	const { group } = requireGroup(event);
	const scope = `/g/${group.inviteToken}`;

	const manifest = {
		id: scope,
		name: group.name,
		short_name: group.name,
		description: SHARED.description,
		lang: SHARED.lang,
		dir: SHARED.dir,
		categories: SHARED.categories,
		start_url: scope,
		scope,
		display: SHARED.display,
		orientation: SHARED.orientation,
		background_color: SHARED.background_color,
		theme_color: SHARED.theme_color,
		icons: SHARED.icons
	};

	return new Response(JSON.stringify(manifest, null, '\t'), {
		headers: {
			'Content-Type': 'application/manifest+json',
			// The body carries the invite token, which IS the credential — so this is
			// cacheable by the one browser that asked for it and by nothing in
			// between. An hour is long enough to spare the re-fetch on every launch.
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
