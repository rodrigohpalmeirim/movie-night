import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [svelte()],
	server: {
		proxy: {
			'/socket.io': {
				target: 'ws://localhost:5174',
				ws: true,
			},
		},
	},
});