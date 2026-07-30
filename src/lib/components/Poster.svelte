<!--
	A poster with a graceful text fallback: TMDB does not have artwork for
	everything, and a broken image on a tap target is worse than a title.

	The fallback is treated as a component that came out of the box without art
	printed on it — ink plate, stencilled title — rather than as an error.

	HYDRATION: which branch renders must not depend on anything the client can
	know and the server cannot, or SvelteKit hydrates a tree that does not match
	the HTML it was handed and tears the page down — which is how a single failed
	poster could blank a directly-loaded /swipe. So `failed` is gated behind
	`mounted`, which is false on the server and false on the client's first
	render: both sides render the <img> whenever there is a src, every time. Only
	after the mount effect has run — that is, once hydration is finished — can the
	fallback take over.

	That gate also fixes what the naive version got wrong. A poster that failed
	while the JavaScript was still downloading never fires `error` at us, because
	the listener did not exist yet, so the old code sat on a broken image for
	ever. On mount we therefore ask the element what happened instead of waiting
	to be told: a finished load reporting zero width is a failed one.
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

	const src = $derived(posterUrl(path, size));

	let failed = $state(false);
	/** False on the server and all through hydration; true from the first effect on. */
	let mounted = $state(false);
	let img = $state<HTMLImageElement | null>(null);

	$effect(() => {
		mounted = true;
		// `complete` covers success and failure alike, and a successful decode
		// always reports a width — so zero width on a finished load means broken.
		if (img?.complete && img.naturalWidth === 0) failed = true;
	});

	/** No artwork at all is known to both sides, so that half needs no gate. */
	const showFallback = $derived(!src || (mounted && failed));
</script>

{#if showFallback}
	<div
		class="stencil flex h-full w-full items-center justify-center bg-felt-deep p-2 text-center text-xs font-medium tracking-[0.06em] text-board uppercase {className}"
		aria-label="No poster for {title}"
	>
		{title}
	</div>
{:else}
	<img
		bind:this={img}
		{src}
		alt="Poster for {title}"
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		class="h-full w-full bg-felt-deep object-cover {className}"
		onerror={() => (failed = true)}
	/>
{/if}
