<!--
	The viewer's own standing vote as three visually distinct states.
	voting-spec: "Never conflate 'no' with 'not yet seen'." Shape, colour and text
	all differ, so the distinction survives colour-blindness and greyscale.
-->
<script lang="ts">
	let { vote, class: className = '' }: { vote: 'yes' | 'no' | null; class?: string } = $props();
</script>

{#if vote === 'yes'}
	<span
		class="inline-flex items-center gap-1 rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 {className}"
	>
		<span aria-hidden="true">✓</span> Yes
	</span>
{:else if vote === 'no'}
	<span
		class="inline-flex items-center gap-1 rounded-full bg-rose-600/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-400 {className}"
	>
		<span aria-hidden="true">✕</span> No
	</span>
{:else}
	<span
		class="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-400 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 {className}"
	>
		Not yet seen
	</span>
{/if}
