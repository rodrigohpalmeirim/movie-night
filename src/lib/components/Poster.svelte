<!--
	A poster with three deliberate states, because artwork is the one thing on
	this table that arrives from somewhere else and may not arrive at all:

	  LOADING — the felt-deep plate the <img> carries as its own background. It
	    paints under the artwork, so the poster covers it the instant it decodes
	    and there is no layer to mount, remove or fade. `color: transparent` is
	    the other half: alt text is painted in the element's colour, so the
	    browser's alt-text-while-loading (and its alt text on a 404) is invisible
	    while the alt attribute itself stays exactly where screen readers want it.

	  NO ARTWORK — TMDB does not have a poster for everything, so the film gets
	    the component it would have had if the art had never been printed: kraft
	    stock, a clapperboard struck in soft ink, its title stencilled under it.
	    Not an error state — a blank card.

	  FAILED — the same blank card. A poster that 404s or dies on the wire is,
	    from the table's point of view, a film without artwork.

	SIZE-BLIND: the same blank card is asked to be a 44px list thumb and a
	full-bleed swipe card, so the glyph and the stencilled title are sized in
	`cqw` against the box itself rather than in fixed type — see the styles below.

	ANATOMY: exactly one element, `h-full w-full`, filling the box its caller
	sized — as before. Nothing here adds, removes or fades a layer, which is
	what the swipe deck needs: a card's layer tree must not change shape because
	a poster finished decoding behind it.

	HYDRATION: which branch renders must not depend on anything the client can
	know and the server cannot, or SvelteKit hydrates a tree that does not match
	the HTML it was handed and tears the page down — which is how a single failed
	poster could blank a directly-loaded /swipe. So `failed` is gated behind
	`mounted`, which is false on the server and false on the client's first
	render: both sides render the <img> whenever there is a src, every time. Only
	after the mount effect has run — that is, once hydration is finished — can the
	blank card take over. With no JavaScript at all the <img> simply loads, on its
	felt plate, exactly as the markup says.

	That gate also fixes what the naive version got wrong. A poster that failed
	while the JavaScript was still downloading never fires `error` at us, because
	the listener did not exist yet, so the old code sat on a broken image for
	ever. On mount we therefore ask the element what happened instead of waiting
	to be told: a finished load reporting zero width is a failed one.
-->
<script lang="ts">
	import Clapperboard from '$lib/icons/Clapperboard.svelte';
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
	const showBlank = $derived(!src || (mounted && failed));
</script>

{#if showBlank}
	<div class="poster-blank {className}" role="img" aria-label="No poster for {title}">
		<span class="poster-blank-glyph"><Clapperboard size="100%" class="block h-auto w-full" /></span>
		<span class="poster-blank-title stencil">{title}</span>
	</div>
{:else}
	<img
		bind:this={img}
		{src}
		alt="Poster for {title}"
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		class="h-full w-full bg-felt-deep object-cover text-transparent {className}"
		onerror={() => (failed = true)}
	/>
{/if}

<style>
	/*
		The blank card. `container-type` makes the box its own measuring stick, so
		one card works from a 44px thumb to a full-width swipe face: everything
		inside is a share of the box's width (`cqw`, and percentage padding), and
		the two type sizes are clamped so the smallest boxes stay legible-ish
		rather than sub-pixel and the largest do not shout.
	*/
	.poster-blank {
		container-type: inline-size;
		display: flex;
		height: 100%;
		width: 100%;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5%;
		overflow: hidden;
		padding: 8% 7%;
		background-color: var(--color-board);
		color: var(--color-ink);
		text-align: center;
	}

	/* Struck in soft ink: the glyph says "film", the title says which film, and
	   the title is the one that should be read first. */
	.poster-blank-glyph {
		display: block;
		width: clamp(0.75rem, 26cqw, 3.25rem);
		color: var(--color-ink-soft);
	}

	.poster-blank-title {
		font-size: clamp(0.4rem, 8.5cqw, 1rem);
		line-height: 1.15;
		text-transform: uppercase;
		/* Long titles are cut, never spilled: the card is a fixed piece of stock. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}
</style>
