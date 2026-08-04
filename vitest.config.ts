import { defineConfig } from 'vitest/config';

// Deliberately NO SvelteKit / Tailwind plugins and NO $lib alias.
// The tally module is required to be pure (no DB layer, no SvelteKit imports);
// running its tests in a bare Vite/Vitest environment makes any such import a
// hard failure rather than something that silently works.
//
// Later stages that need SvelteKit-aware tests (components, `$lib` aliases,
// `$app/*` mocks) should widen `include` AND add the sveltekit()/svelte()
// plugins — ideally as a second Vitest project so this one keeps its teeth.
//
// `swipe.ts` is admitted on exactly the same terms: it is the swipe card's
// gesture arithmetic, framework-agnostic by design (no runes, no DOM, no
// imports at all), so it runs here unaltered — and if it ever reaches for
// SvelteKit, this project fails rather than quietly growing a plugin.
export default defineConfig({
	test: {
		include: ['src/lib/tally/**/*.test.ts', 'src/lib/swipe.test.ts'],
		environment: 'node',
		reporters: ['default']
	}
});
