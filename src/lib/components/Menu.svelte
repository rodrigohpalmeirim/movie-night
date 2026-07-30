<!--
	Overflow menu built on <details>/<summary>: no JS, no focus trap, keyboard
	operable for free. Used to tuck "Abandon this round" out of thumb range.

	The panel is a dark tray rather than board stock, so anything laid inside it
	(a Confirm's board-stock question card) still reads as a separate piece.
-->
<script lang="ts">
	import Ellipsis from '$lib/icons/Ellipsis.svelte';

	let { label = 'More', children } = $props();
</script>

<details class="group relative">
	<summary
		class="flex cursor-pointer list-none items-center justify-center rounded border-2 border-board-shade px-2 py-1.5 text-chalk-dim select-none hover:border-brass hover:text-brass"
	>
		<span class="sr-only">{label}</span>
		<Ellipsis size={18} />
	</summary>
	<div
		class="absolute right-0 z-10 mt-2 w-64 space-y-2 rounded-md border-2 border-board-shade bg-felt-deep p-3"
	>
		{@render children?.()}
	</div>
</details>
