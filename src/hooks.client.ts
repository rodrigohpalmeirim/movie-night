/**
 * Client-side error hook: its whole job is telling a dropped connection apart
 * from a genuine crash.
 *
 * Most "500" pages this app ever showed were neither 500s nor pages the server
 * saw: a client-side navigation's `__data.json` fetch died on a phone network
 * and SvelteKit fell back to its built-in error screen. Those failures throw
 * `TypeError`s whose wording is the browser's own — "Failed to fetch" (Chrome),
 * "Load failed" (Safari), "NetworkError when attempting to fetch resource."
 * (Firefox) — so the match is on the message, plus the one signal that needs no
 * parsing at all: `navigator.onLine` saying the radio is off.
 */

import { CONNECTION_LOST } from '$lib/error-copy.js';
import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, message }) => {
	// The default hook logs; overriding it inherits the duty.
	console.error(error);

	const text = error instanceof Error ? error.message : String(error);
	const network = !navigator.onLine || /fetch|load failed|networkerror/i.test(text);

	return { message: network ? CONNECTION_LOST : message };
};
