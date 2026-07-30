/**
 * The single entry guard.
 *
 * app-spec: "`/g/[token]` — all routes below resolve the group by token, 404 on
 * unknown token; member cookie identifies the actor, else redirect to picker."
 * And, app-wide: "`Referrer-Policy: same-origin` — the invite token is in every
 * URL and would otherwise leak in the `Referer` header on cross-origin requests
 * (e.g. every poster loaded from `image.tmdb.org`)."
 *
 * This hook RESOLVES but never REJECTS. Throwing `error()` / `redirect()` from a
 * `handle` hook produces a response that never passes back through this function,
 * so the three rejection paths (unknown token, no member, API 401) used to ship
 * without the `Referrer-Policy` header — measurably, the exact responses whose
 * URL contains an invite token. Rejection therefore happens one layer in, in
 * `requireGroup` / `requireActor`, where SvelteKit renders the failure *inside*
 * `resolve()` and the header below is applied to it like any other response.
 *
 * All the resolution logic lives in `$lib/server/context.ts` as pure functions;
 * this file is only the adapter.
 */

import type { Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { resolveFromCookies } from '$lib/server/context.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.db = getDb();
	event.locals.group = null;
	event.locals.config = null;
	event.locals.member = null;

	if (event.route.id?.startsWith('/g/[token]')) {
		const resolution = resolveFromCookies({
			db: event.locals.db,
			token: event.params.token ?? '',
			getCookie: (name) => event.cookies.get(name)
		});
		if (resolution.kind !== 'unknown_group') {
			event.locals.group = resolution.group;
			event.locals.config = resolution.config;
			if (resolution.kind === 'ok') event.locals.member = resolution.member;
		}
	}

	const response = await resolve(event);
	// Every response, including the guard rejections and SvelteKit's error pages.
	response.headers.set('Referrer-Policy', 'same-origin');

	// The invite token in /g/<token> IS the credential, so an indexed group URL is
	// a leaked password. robots.txt only binds crawlers that choose to read it;
	// this header is the instruction that actually travels with the page. Matched
	// on the PATH, not the route id, so unmatched URLs under /g/ (404s included)
	// are covered too.
	if (event.url.pathname.startsWith('/g/')) {
		response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	}
	return response;
};
