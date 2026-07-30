/**
 * In-process pub/sub for SSE invalidation pings.
 *
 * app-spec: "Each group has an in-process emitter (one Bun server, so a plain
 * `EventEmitter` keyed by `group_id` is the whole pub/sub); every write action
 * emits a ping". No payload ever travels: the client just calls
 * `invalidateAll()`, which keeps the hidden-tallies rule intact by construction —
 * there is no channel through which an aggregate could leak early.
 *
 * Scaling out would need external pub/sub and is explicitly out of scope.
 */

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
// One group can legitimately have many devices connected.
emitter.setMaxListeners(0);

const CHANNEL = (groupId: string) => `group:${groupId}`;

/** Called by every service that writes. Never carries data. */
export function notifyGroup(groupId: string): void {
	emitter.emit(CHANNEL(groupId), undefined);
}

/** Returns an unsubscribe function; the SSE route calls it on disconnect. */
export function subscribeGroup(groupId: string, onPing: () => void): () => void {
	const channel = CHANNEL(groupId);
	emitter.on(channel, onPing);
	return () => emitter.off(channel, onPing);
}

export function listenerCount(groupId: string): number {
	return emitter.listenerCount(CHANNEL(groupId));
}
