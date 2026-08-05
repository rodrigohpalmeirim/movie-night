<!--
	Group shell: header, bottom tab bar, and the live-update stream.

	The header is the game-box lid: the group's name set in the slab face, the
	name this device is claiming on a board-stock chip, and a brass rule closing
	the lid off from the table below.

	THE SHELL IS THE THING THAT DOES NOT MOVE. It is exactly as tall as the
	viewport and it never scrolls: lid at the top, tray at the bottom, and one
	scroll region between them carrying the screen. The furniture is therefore
	pinned by LAYOUT — plain flex children, no `position: fixed` anywhere — which
	is the only way to be immune to a phone browser retracting its own URL bar
	under the page (see the note on `html` in app.css: that is what was making the
	tray flicker through a page transition). The lid stays put as a side effect,
	which is what it always claimed to be anyway.

	The picker renders inside this shell too, and it is reachable before an
	identity is claimed, so `data.group` may be null — the tab bar is hidden until
	there is a member to be.
-->
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import TabBar from '$lib/components/TabBar.svelte';
	import { startLiveUpdates } from '$lib/live.js';
	import DevBar from './dev/DevBar.svelte';
	import type { LayoutServerData } from './$types';

	let { data, children }: { data: LayoutServerData; children?: import('svelte').Snippet } =
		$props();

	// Owned by an effect so the stream is torn down on navigation away and
	// re-established if the token ever changes (e.g. after regenerating the link).
	$effect(() => startLiveUpdates(data.inviteToken));

	/**
	 * Which felt table this route sits on. app.css reads the attribute via
	 * `html:has([data-felt=…])` and swaps the felt trio as a set — see the
	 * mapping comment there. Keyed on the route id (not the URL), so it is
	 * decided at SSR time and there is no first-paint flash.
	 */
	const FELT_BY_SEGMENT: Record<string, string> = {
		pool: 'pool',
		movies: 'pool',
		swipe: 'pool',
		veto: 'runoff',
		pairs: 'runoff',
		settings: 'settings',
		history: 'history'
	};
	const felt = $derived(
		FELT_BY_SEGMENT[page.route.id?.split('/')[3] ?? ''] ?? 'round'
	);

	/**
	 * The app's one scroll region. SvelteKit resets and restores the WINDOW's
	 * scroll on navigation, and the window's scroll is now permanently 0, so
	 * starting each screen at the top is ours to do — otherwise the new page
	 * arrives already halfway down, at wherever the last one had been left.
	 *
	 * Landing at the top is all this does. Back and forward do NOT restore where
	 * you were: the screens here are short, a bounded list or one round, and
	 * arriving at the top of them is what a tab bar app does — every tab shows
	 * you its head.
	 */
	let scroller = $state<HTMLElement | null>(null);
	afterNavigate(() => {
		if (scroller) scroller.scrollTop = 0;
	});
</script>

<svelte:head>
	<title>{data.groupName} — Movie Night</title>
</svelte:head>

<!-- The shell is the viewport, exactly: `h-full` off the html → body chain in
     app.css, and full width, because the centred `max-w-lg` column is now each
     piece's own business. Widening it is what keeps a swipe card flying to the
     edge of the SCREEN rather than to the edge of the column. -->
<div class="flex h-full flex-col" data-felt={felt}>
	<!-- vt-header: the lid keeps its own transition group, so it stays put during
	     page transitions instead of sliding sideways with the table. It no longer
	     scrolls away either — being outside the scroll region is what pins it. -->
	<header class="vt-header shrink-0">
		<div class="mx-auto max-w-lg px-4 pt-4">
			<div class="flex items-center justify-between gap-3">
				<h1 class="display truncate text-[1.35rem] text-board">{data.groupName}</h1>
				{#if data.group}
					<!-- The bare name, no preamble. A chip opposite the group's own name, on
					     every screen, is already read as "this is who you are here"; saying so
					     out loud only spent the chip's width on a label. Settings is where the
					     name can be handed on ("Not you?"), which is where it says more. -->
					<p
						class="stencil shrink-0 rounded-full border-2 border-board-shade px-2.5 py-0.5 text-[0.7rem] tracking-[0.08em] text-chalk uppercase"
					>
						{data.group.me.displayName}
					</p>
				{/if}
			</div>
			<div class="mt-2.5 h-[3px] rounded-full bg-brass"></div>
			<div class="mt-[3px] border-t-2 border-dashed border-felt-line"></div>
		</div>
	</header>

	<!--
		THE ONE SCROLL REGION. `min-h-0` so it can actually give way to the lid and
		the tray instead of pushing them off the shell, and the sideways guarantee
		is re-stated here because it has to be: `overflow-y: auto` cannot sit next
		to an `overflow-x: visible`, and letting it default to `auto` would hand the
		flying swipe card a horizontal scrollbar to drag. `clip` on the x axis and
		the card leaves the screen with nothing following it.

		`overscroll-contain` stops the region chaining its overscroll to the
		document (there is nothing there to chain to) which is also what keeps a
		pull past the top from being read as pull-to-refresh.

		The bar reserves no space now — it sits below this region rather than over
		it — so the padding here is just the bottom margin of the printed page. (It
		used to be the fixed bar's clearance, and before that the app-wide TMDB
		footer's band; the credit lives in the suggest sheet and in Settings.)
	-->
	<div
		bind:this={scroller}
		class="min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain"
	>
		<main class="mx-auto max-w-lg px-4 pt-5 pb-8">
			{@render children?.()}
		</main>
	</div>

	{#if data.group}
		{#if data.devMode}
			<DevBar token={data.inviteToken} members={data.group.members} meId={data.group.me.id} />
		{/if}
		<TabBar token={data.inviteToken} swipeCount={data.swipeCount ?? 0} />
	{/if}
</div>
