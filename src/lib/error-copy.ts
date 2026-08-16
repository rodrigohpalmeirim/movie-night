/**
 * The one error message the client hook and the error card must agree on.
 *
 * A failed client-side navigation — the radio asleep, the Wi-Fi left behind, a
 * backgrounded tab's fetch killed on resume — surfaces as a plain thrown
 * `TypeError`, and SvelteKit would print it as a bare "500 Internal Error" even
 * though no request ever reached the server. `hooks.client.ts` translates those
 * to this exact string, and `ErrorCard` matches on it to say "connection", not
 * "crash". It reads as a sentence because an unrecognised boundary would print
 * it verbatim.
 */
export const CONNECTION_LOST = 'The request never reached the table.';
