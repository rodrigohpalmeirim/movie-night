// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { Db, Group, GroupConfig, Member } from '$lib/server/db/index.js';

declare global {
	namespace App {
		interface Locals {
			db: Db;
			/** Resolved from the invite token; null outside `/g/[token]`. */
			group: Group | null;
			config: GroupConfig | null;
			/** Resolved from the per-group member cookie; null before a name is claimed. */
			member: Member | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
