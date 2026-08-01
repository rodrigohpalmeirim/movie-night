/**
 * Toolchain invariant: every command that runs SvelteKit's `sync` must run
 * under the same JavaScript runtime — Bun.
 *
 * WHY (this guards a real, blank-page bug):
 *
 * `svelte-kit sync` walks `src/routes` with a plain `fs.readdirSync` and numbers
 * the page nodes in whatever order the directory happens to hand back — there is
 * no sort (`create_manifest_data/index.js`: "populate the page nodes list"). Bun
 * returns raw directory order; Node returns a different (sorted) order. So the
 * two runtimes assign *different* indices to the same routes: under Bun
 * `/g/[token]/swipe` was node 8 and `/g/[token]/picker` node 7; under Node
 * `picker` was 8 and `swipe` 11.
 *
 * Those indices are not internal bookkeeping — a server-rendered page ships them
 * to the browser verbatim, as the `node_ids: [0, 2, 8]` array in the inline
 * hydration script, and the client looks each one up in the `nodes` array of the
 * generated `client/app.js`. If the server's numbering and `app.js` disagree, a
 * direct page load hydrates the WRONG component against the right data: loading
 * `/g/<token>/swipe` instantiated `picker/+page.svelte`, which read
 * `data.members.length` off the swipe payload and threw
 * `TypeError: Cannot read properties of undefined (reading 'length')`, leaving a
 * blank screen. Client-side navigation kept working throughout, because
 * `__data.json` carries the branch positionally and never mentions a node index —
 * which is exactly what made the bug look impossible.
 *
 * The mismatch was produced by the scripts themselves: `dev` and `build` run
 * `bun --bun vite …`, so their sync numbered nodes Bun-style, while `check` and
 * `prepare` shelled out to `node_modules/.bin/svelte-kit`, whose
 * `#!/usr/bin/env node` shebang numbered them Node-style and rewrote
 * `.svelte-kit/generated/client/app.js` underneath the running dev server. One
 * `bun run check` was enough to break every direct load until the dev server was
 * restarted.
 *
 * Hence: no bare `svelte-kit` or `vite` invocation anywhere in `package.json`.
 * (If a sync ever comes from outside these scripts — `npx svelte-kit sync`, or an
 * editor's Svelte plugin — the same corruption returns, and the symptom to
 * recognise is precisely the one above.)
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
	scripts: Record<string, string>;
};

/** Tools whose invocation triggers SvelteKit's node numbering. */
const SYNCING_TOOLS = ['svelte-kit', 'vite'];

/** `a && b || c; d` → the individual commands, trimmed. */
function commands(script: string): string[] {
	return script
		.split(/&&|\|\||;/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function invokes(command: string, tool: string): boolean {
	// Word-boundary match on the tool name so `drizzle-kit` is not read as
	// `svelte-kit` and `vitest` is not read as `vite`.
	return new RegExp(`(^|[\\s/])${tool}(\\s|$)`).test(command);
}

describe('package.json scripts', () => {
	const entries = Object.entries(pkg.scripts);

	for (const tool of SYNCING_TOOLS) {
		it(`runs every \`${tool}\` command through \`bun --bun\``, () => {
			const offenders = entries.flatMap(([name, script]) =>
				commands(script)
					.filter((command) => invokes(command, tool) && !command.startsWith('bun --bun '))
					.map((command) => `${name}: ${command}`)
			);
			expect(offenders).toEqual([]);
		});
	}

	it('still runs the syncing tools somewhere (the guard is not vacuous)', () => {
		const all = entries.flatMap(([, script]) => commands(script));
		for (const tool of SYNCING_TOOLS) {
			expect(all.some((command) => invokes(command, tool))).toBe(true);
		}
	});
});

describe('vitest', () => {
	/**
	 * Vitest is deliberately NOT on the list above: its config leaves the
	 * SvelteKit plugin out (see the comment at the top of `vitest.config.ts`), so
	 * running it never syncs and cannot renumber anything. That exemption is only
	 * true while the plugin stays out, so assert it rather than trusting it.
	 */
	it('runs without the SvelteKit plugin, so it never triggers a sync', () => {
		// Comments stripped first: that config *talks about* `sveltekit()` in a
		// note about what a future test project would need.
		const code = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(^|\s)\/\/.*$/gm, '');
		expect(code).not.toMatch(/@sveltejs\/kit\/vite/);
		expect(code).not.toMatch(/\bsveltekit\s*\(/);
	});
});
