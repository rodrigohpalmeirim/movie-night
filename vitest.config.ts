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
//
// `cooldown.ts` too: it is the re-watch ladder, one array and the arithmetic that
// maps a rung to days. It is shared by the settings page and the settings action
// precisely BECAUSE it depends on neither, and this project is what keeps that
// true.
//
// `tags.ts` likewise: tag normalisation, the presets and the themed deck order —
// shared by the tag services, the screens and the seed for exactly that reason,
// and its fold has to agree with SQLite's `lower()`, which is worth pinning here
// where nothing else can sneak in.
//
// `pool-sort.ts` too: the pool list's sort orders, including the group ranking,
// which reuses the tally module's Phase 1 chain — pure data, shared by the pool
// screen's server render and the browser.
export default defineConfig({
	test: {
		include: [
			'src/lib/tally/**/*.test.ts',
			'src/lib/swipe.test.ts',
			'src/lib/cooldown.test.ts',
			'src/lib/tags.test.ts',
			'src/lib/pool-sort.test.ts'
		],
		environment: 'node',
		reporters: ['default']
	}
});
