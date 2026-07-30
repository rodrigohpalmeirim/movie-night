<!--
	Overflow menu built on <details>/<summary>: no JS, no focus trap, keyboard
	operable for free. Used to tuck "Abandon this round" out of thumb range.
-->
<script lang="ts">
	let { label = 'More', children } = $props();
</script>

<details class="group relative">
	<summary
		class="cursor-pointer list-none rounded-lg px-3 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
	>
		<span class="sr-only">{label}</span>
		<span aria-hidden="true">···</span>
	</summary>
	<div
		class="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
	>
		{@render children?.()}
	</div>
</details>
