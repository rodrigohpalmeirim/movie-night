/**
 * The group's web app manifest — the same app, started at the group's door.
 *
 * app-spec: "Mobile-first, installable PWA (manifest + icons + theme color)."
 * There is exactly ONE app: installing from anywhere gives you "Movie Night",
 * whose identity and scope are `/`, and the root page works out where the device
 * belongs from its member cookies. So this manifest is `static/manifest.webmanifest`
 * with a single field changed:
 *
 * - `start_url` is `/?g=<token>`, and that query string is the whole point. An
 *   installed PWA on iOS launches with an EMPTY cookie jar — it does not inherit
 *   Safari's — so a member who installed from inside their group would land on `/`
 *   as a stranger, with no cookie to redirect on and no link to their group. The
 *   token in the start_url is the hint that gets that first launch home; from
 *   there the group's picker claims a name and the cookie takes over.
 *
 * `id` stays `/`, so a second install from a second group does not become a second
 * app; `name`/`short_name` stay "Movie Night", because there is only one app to
 * name. Everything else is copied from the static manifest, and `manifest.spec.ts`
 * fails if the two ever drift.
 */

import { requireGroup } from '$lib/server/http.js';
import type { RequestHandler } from './$types';

/**
 * `static/manifest.webmanifest`, field for field (the spec test pins them equal).
 * Not imported from it: the route is loaded directly by `bun test`, which has no
 * Vite `?raw` loader, and reading the file at runtime would depend on the shape
 * of the build output.
 */
const STATIC_MANIFEST = {
	id: '/',
	name: 'Movie Night',
	short_name: 'Movie Night',
	description: 'Pick what to watch, together.',
	lang: 'en',
	dir: 'ltr',
	categories: ['entertainment', 'social'],
	start_url: '/',
	scope: '/',
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

	// The invite token is URL-safe base64, so it needs no escaping to sit in a query.
	const manifest = { ...STATIC_MANIFEST, start_url: `/?g=${group.inviteToken}` };

	return new Response(JSON.stringify(manifest, null, '\t'), {
		headers: {
			'Content-Type': 'application/manifest+json',
			// The start_url carries the invite token, which IS the credential — so this
			// is cacheable by the one browser that asked for it and by nothing in
			// between. An hour is long enough to spare the re-fetch on every launch.
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
