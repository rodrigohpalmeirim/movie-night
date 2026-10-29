<!--
	A THEMED NIGHT'S ORNAMENT — a die-cut piece laid on the table for the two
	preset themes only: a jack-o'-lantern for Halloween, a sprig of holly for
	Christmas. Custom themes get no ornament (and no palette); their chip says it.

	Cut like everything else on this table: flat fills in the printing inks, a
	2px ink outline, and no lip — it is a decoration, not a control, so it lies
	flat (raised means pressable). It casts the same soft shadow a card dealt
	onto the felt does, and is turned a few degrees, the way a piece you put
	down by hand never lands square.

	The fills read the live palette: the pumpkin is the brass plate, which the
	Halloween table repaints pumpkin; the holly is jade and its berries cherry —
	the two inks no theme ever touches.

	Purely decorative: the theme is always named in real text beside it.
-->
<script lang="ts">
	import type { ThemePalette } from '$lib/tags.js';

	let {
		theme,
		size = '3rem',
		rotate = -8,
		class: className = ''
	}: { theme: ThemePalette; size?: string; rotate?: number; class?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 64 64"
	width={size}
	height={size}
	stroke="var(--color-ink)"
	stroke-width="2.5"
	stroke-linejoin="round"
	stroke-linecap="round"
	aria-hidden="true"
	focusable="false"
	class="ornament {className}"
	style="--ornament-rot:{rotate}deg"
>
	{#if theme === 'halloween'}
		<!-- Stem first, so the body's outline caps it. -->
		<path d="M30 17c0-5 2-9 7-11l2 4c-3 1-4 4-4 7z" fill="var(--color-jade-deep)" />
		<!-- Three lobes, outer two first: the centre lobe's outline is the ribs. -->
		<ellipse cx="21" cy="38" rx="14" ry="18" fill="var(--color-brass)" />
		<ellipse cx="43" cy="38" rx="14" ry="18" fill="var(--color-brass)" />
		<ellipse cx="32" cy="38" rx="13" ry="19.5" fill="var(--color-brass)" />
		<!-- The carving, cut through to the dark inside. -->
		<g fill="var(--color-ink)" stroke="none">
			<path d="M19 34l6-8 4 9z" />
			<path d="M45 34l-6-8-4 9z" />
			<path d="M29.5 40l2.5-4 2.5 4z" />
			<path
				d="M17 43c5 9 25 9 30 0l-4 1-2 3-3-3-3 4-3-4-3 4-3-4-3 3-2-3z"
			/>
		</g>
	{:else}
		<!-- Two spiked leaves fanned up and out from the stem, each one leaf drawn
		     along its own axis and turned into place; berries on top. -->
		{#each [-152, -28] as turn (turn)}
			<g transform="translate(32 38) rotate({turn})">
				<path
					d="M0 0L4-6 9-5 12-12 17-8 22-13 26-7 33 0 26 7 22 13 17 8 12 12 9 5 4 6z"
					fill="var(--color-jade)"
				/>
				<path d="M3 0H28" fill="none" stroke-width="2" />
			</g>
		{/each}
		<g fill="var(--color-cherry)">
			<circle cx="26.5" cy="42" r="5.5" />
			<circle cx="37.5" cy="42" r="5.5" />
			<circle cx="32" cy="51" r="5.5" />
		</g>
		<!-- A catch of light on each berry, so they read as round. -->
		<g fill="var(--color-board)" stroke="none">
			<circle cx="24.7" cy="40.2" r="1.4" />
			<circle cx="35.7" cy="40.2" r="1.4" />
			<circle cx="30.2" cy="49.2" r="1.4" />
		</g>
	{/if}
</svg>

<style>
	.ornament {
		flex-shrink: 0;
		rotate: var(--ornament-rot);
		/* The soft shadow a dealt card casts — lift, not an invitation to press. */
		filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.35));
	}
</style>
