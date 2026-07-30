/**
 * Thin glue between services and SvelteKit. All HTTP knowledge lives here so the
 * services stay framework-free and directly testable.
 */

import { error, json, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { statusOf, type Result } from './result.js';
import type { ActorContext } from './context.js';
import type { Db, Group, GroupConfig } from './db/index.js';

/** Turns a service `Result` into a JSON response with the mapped status. */
export function jsonResult<T>(result: Result<T>, init?: ResponseInit): Response {
	if (result.ok) return json({ ok: true, ...(result.value as object) }, init);
	return json({ ok: false, code: result.code, message: result.message }, { status: statusOf(result) });
}

/** GET routes that must fail with a status rather than be redirected to HTML. */
const STATUS_ONLY_ROUTE_IDS = new Set([
	'/g/[token]/events',
	'/g/[token]/round',
	'/g/[token]/pool',
	'/g/[token]/history'
]);

/**
 * The group half of the guard: 404 on an unknown invite token.
 *
 * Thrown here rather than in `hooks.server.ts` so SvelteKit renders it inside
 * `resolve()` — which is what lets the `Referrer-Policy` header in the hook reach
 * it. These are exactly the responses whose URL carries an invite token, so they
 * are the ones that most need the header.
 */
export function requireGroup(event: RequestEvent): { db: Db; group: Group; config: GroupConfig } {
	const { db, group, config } = event.locals;
	// The token is the only credential, so an unknown one is simply a bad URL.
	if (!group || !config) error(404, 'No such group');
	return { db, group, config };
}

/**
 * The member half: redirect page navigations to the picker, and give API calls a
 * status they can act on (a redirect would hand a POST or an EventSource picker
 * HTML and look like a mysterious failure).
 */
export function requireActor(event: RequestEvent): ActorContext {
	const { db, group, config } = requireGroup(event);
	const member = event.locals.member;
	if (!member) {
		const routeId = event.route.id ?? '';
		if (event.request.method === 'GET' && !STATUS_ONLY_ROUTE_IDS.has(routeId)) {
			redirect(303, `/g/${group.inviteToken}/picker`);
		}
		error(401, 'Claim a member for this group first');
	}
	return { db, group, config, member, now: new Date() };
}

/** Tolerant JSON body reader: a missing or malformed body becomes `{}`. */
export async function readJsonBody(event: RequestEvent): Promise<Record<string, unknown>> {
	try {
		const body = await event.request.json();
		return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Form bodies arrive as strings; `undefined` for absent fields. */
export function formValue(data: FormData, key: string): string | undefined {
	const value = data.get(key);
	return typeof value === 'string' ? value : undefined;
}

export function formBoolean(data: FormData, key: string): boolean | undefined {
	const value = formValue(data, key);
	if (value === undefined) return undefined;
	return value === 'true' || value === 'on' || value === '1';
}
