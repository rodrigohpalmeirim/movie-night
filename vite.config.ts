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
