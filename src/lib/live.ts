/**
 * Live-ness: SSE invalidation pings, no websockets.
 *
 * app-spec: "real-time sync never pushes data — only 'something changed,
 * refetch'. ... the client holds an `EventSource` and calls `invalidateAll()` on
 * ping, debounced. `EventSource` reconnects automatically. ... Screens also
 * refetch on focus/visibility change — this covers iOS PWAs, which drop
 * connections when backgrounded. No polling loop."
 */

import { invalidateAll } from '$app/navigation';

const DEBOUNCE_MS = 250;

/**
 * Starts the stream and the visibility listener. Returns a teardown function, so
 * a Svelte `$effect` can own the lifecycle.
 */
export function startLiveUpdates(token: string): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const refetch = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void invalidateAll(), DEBOUNCE_MS);
	};

	const source = new EventSource(`/g/${token}/events`);
	// The ping carries no payload; the only reaction is to refetch.
	source.addEventListener('invalidate', refetch);

	const onVisible = () => {
		if (document.visibilityState === 'visible') refetch();
	};
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('focus', onVisible);

	return () => {
		if (timer) clearTimeout(timer);
		source.close();
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('focus', onVisible);
	};
}
