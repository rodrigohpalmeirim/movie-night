/*
 * Vite/SvelteKit config.
 *
 * IMPORTANT: every command that can run SvelteKit's `sync` — this config (via
 * `vite dev` / `vite build`) and the bare `svelte-kit sync` in `package.json` —
 * must run under the SAME JavaScript runtime, which for this project is Bun
 * (`bun --bun …`). SvelteKit numbers page nodes in `fs.readdirSync` order, and
 * Bun and Node return directory entries in different orders, so two runtimes
 * produce two different numberings for the same routes. See
 * `scripts/toolchain.spec.ts` for the full mechanism and the guard.
 */

import adapter from 'svelte-adapter-bun';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// svelte-adapter-bun: standalone Bun.serve() server in ./build.
			// Fallback if it ever breaks: @sveltejs/adapter-node, `bun ./build/index.js`.
			adapter: adapter()
		})
	]
});
