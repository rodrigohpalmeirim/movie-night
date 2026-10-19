/**
 * Where the pool list was scrolled to, remembered across a visit to a film.
 *
 * The shell's one scroll region starts every screen at the top (see the layout).
 * The pool is the exception worth making: it is the only list long enough to
 * lose your place in, and opening a film and coming back should not make you
 * scroll down to where you were. Pure — no DOM, no SvelteKit — so the policy is
 * checkable on its own; the layout only feeds it navigations and a scroller.
 */

/** Route ids (as `page.route.id` reports them) the memory cares about. */
export const POOL_ROUTE = '/g/[token]/pool';
export const MOVIE_ROUTE = '/g/[token]/movies/[id]';

/** SvelteKit's navigation types, narrowed to what the policy reads. */
export type NavType = 'enter' | 'form' | 'leave' | 'link' | 'goto' | 'popstate';

/**
 * Which screens keep a position, and the key it is filed under. Keyed on the
 * route id's shape rather than the URL so a group's pool is one entry whatever
 * query string (`?suggest`) it was opened with; a different group (a different
 * token) is a different list, so the token stays in the key via the pathname.
 */
export function memoryKey(routeId: string | null, pathname: string): string | null {
	return routeId === POOL_ROUTE ? pathname : null;
}

/**
 * Whether arriving at `to` should put the scroll back where it was left.
 *
 * Back/forward always does, for a remembered screen. The "Back to the pool" link
 * on a film is an ordinary link navigation, so it counts too — but only when it
 * comes FROM a film: a tap on the Pool tab from anywhere else is "show me the
 * pool's head", like every other tab.
 */
export function shouldRestore(opts: {
	type: NavType;
	fromRouteId: string | null;
	toRouteId: string | null;
}): boolean {
	if (opts.toRouteId !== POOL_ROUTE) return false;
	if (opts.type === 'popstate') return true;
	return opts.fromRouteId === MOVIE_ROUTE;
}

export type ScrollMemory = {
	remember(key: string, top: number): void;
	recall(key: string): number | null;
	forget(key: string): void;
};

/** A plain in-memory map: lives as long as the tab does, which is the point. */
export function createScrollMemory(): ScrollMemory {
	const positions = new Map<string, number>();
	return {
		remember(key, top) {
			// Resting at the head is the default, not a position worth keeping.
			if (top > 0) positions.set(key, top);
			else positions.delete(key);
		},
		recall: (key) => positions.get(key) ?? null,
		forget: (key) => void positions.delete(key)
	};
}
