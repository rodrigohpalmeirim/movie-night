<!--
	The viewer's own standing vote as three visually distinct states.
	voting-spec: "Never conflate 'no' with 'not yet seen'." Shape, colour, icon
	and text all differ, so the distinction survives colour-blindness and
	greyscale: yes is a dark jade chip with a tick, no is a bright cherry chip
	with a cross, and not-yet-seen is an unfilled chip with a cut edge and no
	icon at all. Jade and cherry sit on opposite sides of mid-grey, so the two
	answers stay apart even with the colour thrown away.
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
	<!-- Bright plate, ink type — the same reading as the No token and the Nope seal. -->
	<span class="{base} border-ink bg-cherry text-ink {className}">
		<X size={13} /> No
	</span>
{:else}
	<!-- Ink-soft, not chalk: this badge only ever appears on board stock. -->
	<span class="{base} border-dashed border-ink-soft text-ink-soft {className}"> Not yet seen </span>
{/if}
