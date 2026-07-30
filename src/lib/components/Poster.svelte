<!--
	A poster with a graceful text fallback: TMDB does not have artwork for
	everything, and a broken image on a tap target is worse than a title.

	The fallback is treated as a component that came out of the box without art
	printed on it — ink plate, stencilled title — rather than as an error.
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
		class="h-full w-full bg-felt-deep object-cover {className}"
		onerror={() => (failed = true)}
	/>
{:else}
	<div
		class="stencil flex h-full w-full items-center justify-center bg-felt-deep p-2 text-center text-xs font-medium tracking-[0.06em] text-board uppercase {className}"
		aria-label="No poster for {title}"
	>
		{title}
	</div>
{/if}
