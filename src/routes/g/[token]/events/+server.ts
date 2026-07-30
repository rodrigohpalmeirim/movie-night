/**
 * SSE invalidation stream.
 *
 * app-spec: "GET events → SSE stream; emits an invalidation ping on every write
 * in the group, no payload." The client holds an `EventSource` and calls
 * `invalidateAll()` on ping. Because nothing is ever pushed, the hidden-tallies
 * rule cannot be violated through this channel.
 *
 * "The stream sends a keep-alive comment every ~25 s so proxies don't drop idle
 * connections", and `X-Accel-Buffering: no` stops nginx buffering the stream.
 */

import { requireActor } from '$lib/server/http.js';
import { subscribeGroup } from '$lib/server/events.js';
import type { RequestHandler } from './$types';

/**
 * app-spec asks for "a keep-alive comment every ~25 s". That is too slow for the
 * default deployment: `svelte-adapter-bun` sets Bun's `idleTimeout` to 10 s, so a
 * 25 s heartbeat let every stream die at ~12 s and every tab reconnect forever.
 *
 * The default here therefore sits under that 10 s floor. Raise `IDLE_TIMEOUT`
 * (see .env.example) and `SSE_KEEPALIVE_MS` together to get closer to the spec's
 * 25 s and cut the chatter.
 */
const KEEP_ALIVE_MS = Number(process.env.SSE_KEEPALIVE_MS ?? 8000);

export const GET: RequestHandler = (event) => {
	const actor = requireActor(event);
	const encoder = new TextEncoder();

	let unsubscribe: (() => void) | undefined;
	let keepAlive: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// Client vanished between the ping and the write; `cancel` cleans up.
				}
			};

			// Tell the client the stream is live and set a generous retry.
			send('retry: 3000\n\n');

			unsubscribe = subscribeGroup(actor.group.id, () => send('event: invalidate\ndata: 1\n\n'));
			keepAlive = setInterval(() => send(': keep-alive\n\n'), KEEP_ALIVE_MS);

			// Belt and braces for runtimes that only signal abort on the request.
			event.request.signal.addEventListener('abort', () => {
				unsubscribe?.();
				if (keepAlive) clearInterval(keepAlive);
			});
		},
		cancel() {
			unsubscribe?.();
			if (keepAlive) clearInterval(keepAlive);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
