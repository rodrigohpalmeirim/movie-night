<!--
	The error card: what renders when a screen cannot.

	One card, three stories, told apart by what actually happened rather than by
	bare status code:

	- the connection dropped (`CONNECTION_LOST`, stamped by hooks.client.ts) —
	  by far the common case on phones, and the one thing this card exists to
	  say gently: nothing was lost, the server never heard about it, try again;
	- a link that leads nowhere (404) — retrying a wrong address helps nobody,
	  so its button goes home instead;
	- everything else — a real fault, ours, with the same honest "try again"
	  because a transient crash and a dropped connection recover the same way.

	The retry is an <a> to the page's own URL, not a JS reload: it works with
	JavaScript off (an SSR'd error page is exactly where the client might not be
	running), and `data-sveltekit-reload` makes it a full document load either
	way, which also clears whatever wedged client state got the reader here.

	The status line at the foot is for the screenshot a friend sends the person
	who hosts the thing.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { CONNECTION_LOST } from '$lib/error-copy.js';

	const kind = $derived(
		page.status === 404 ? 'lost' : page.error?.message === CONNECTION_LOST ? 'connection' : 'fault'
	);

	const copy = $derived(
		{
			connection: {
				eyebrow: 'Connection dropped',
				title: 'The table went quiet',
				note: 'The last request never made it out of this device. Nothing is lost — every swipe and vote already made lives on the server.'
			},
			lost: {
				eyebrow: 'Wrong room',
				title: 'Nothing at this address',
				note: 'This link doesn’t lead to a page. It may be mistyped — or it’s an old invite link, regenerated since.'
			},
			fault: {
				eyebrow: 'Our fault',
				title: 'Something slipped off the table',
				note: 'The app fumbled this screen. Trying again usually picks it right back up — nothing you played is lost.'
			}
		}[kind]
	);

	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<section class="tile px-4 pt-4 pb-4">
	<p class="eyebrow text-ink-soft">{copy.eyebrow}</p>
	<h1 class="display mt-1.5 text-[2rem] leading-[0.98] text-ink">{copy.title}</h1>
	<div class="mt-3 h-[3px] bg-ink"></div>
	<div class="mt-[3px] border-t-2 border-dashed border-board-shade"></div>
	<p class="mt-3 text-sm leading-relaxed text-ink">{copy.note}</p>

	{#if kind === 'lost'}
		<a href="/" class="token token-lg mt-4 block w-full text-center">Back to the start</a>
	{:else}
		<a href={retryHref} data-sveltekit-reload class="token token-lg mt-4 block w-full text-center"
			>Try again</a
		>
	{/if}

	<p class="stencil mt-3 text-[0.7rem] tracking-[0.06em] text-ink-soft uppercase">
		Error {page.status}{#if kind === 'fault' && page.error?.message}&nbsp;— {page.error.message}{/if}
	</p>
</section>
