<!--
	A poster with a graceful text fallback: TMDB does not have artwork for
	everything, and a broken image on a tap target is worse than a title.
-->
<script lang="ts">
	import { posterUrl, type PosterSize } from '$lib/images.js';

	let {
		path = null,
		title,
		size = 'w342',
		class: className = '',
		eager = false
	}: {
		path?: string | null;
		title: string;
		size?: PosterSize;
		class?: string;
		eager?: boolean;
	} = $props();

	let failed = $state(false);
	const src = $derived(posterUrl(path, size));
</script>

{#if src && !failed}
	<img
		{src}
		alt="Poster for {title}"
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		class="h-full w-full bg-neutral-800 object-cover {className}"
		onerror={() => (failed = true)}
	/>
{:else}
	<div
		class="flex h-full w-full items-center justify-center bg-neutral-800 p-2 text-center text-xs font-medium text-neutral-300 {className}"
		aria-label="No poster for {title}"
	>
		{title}
	</div>
{/if}
