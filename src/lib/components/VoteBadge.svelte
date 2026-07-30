<!--
	The viewer's own standing vote as three visually distinct states.
	voting-spec: "Never conflate 'no' with 'not yet seen'." Shape, colour, icon
	and text all differ, so the distinction survives colour-blindness and
	greyscale: yes is a filled jade chip with a tick, no is a filled cherry chip
	with a cross, and not-yet-seen is an unfilled chip with a cut edge and no
	icon at all.
-->
<script lang="ts">
	import Check from '$lib/icons/Check.svelte';
	import X from '$lib/icons/X.svelte';

	let { vote, class: className = '' }: { vote: 'yes' | 'no' | null; class?: string } = $props();

	const base =
		'stencil inline-flex items-center gap-1 rounded border-2 px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em]';
</script>

{#if vote === 'yes'}
	<span class="{base} border-ink bg-jade text-ink {className}">
		<Check size={13} /> Yes
	</span>
{:else if vote === 'no'}
	<!-- cherry-deep, not cherry: board type on the brighter ink misses AA at this size. -->
	<span class="{base} border-ink bg-cherry-deep text-board {className}">
		<X size={13} /> No
	</span>
{:else}
	<span class="{base} border-dashed border-board-shade text-chalk-dim {className}">
		Not yet seen
	</span>
{/if}
