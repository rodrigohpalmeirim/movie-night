<!--
	Group shell: header, bottom tab bar, and the live-update stream.

	The header is the game-box lid: the group's name set in the slab face, the
	member you're currently playing as on a board-stock chip, and a brass rule
	closing the lid off from the table below.

	The picker renders inside this shell too, and it is reachable before an
	identity is claimed, so `data.group` may be null — the tab bar is hidden until
	there is a member to be.
-->
<script lang="ts">
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
</script>

<svelte:head>
	<title>{data.groupName} — Movie Night</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-lg flex-col" data-felt={felt}>
	<!-- vt-header: the lid stays put during page transitions instead of
	     sliding sideways with the table. -->
	<header class="vt-header px-4 pt-4">
		<div class="flex items-center justify-between gap-3">
			<h1 class="display truncate text-[1.35rem] text-board">{data.groupName}</h1>
			{#if data.group}
				<p
					class="stencil shrink-0 rounded-full border-2 border-board-shade px-2.5 py-0.5 text-[0.7rem] tracking-[0.08em] text-chalk uppercase"
				>
					<span class="text-chalk-dim">playing as</span>&nbsp;{data.group.me.displayName}
				</p>
			{/if}
		</div>
		<div class="mt-2.5 h-[3px] rounded-full bg-brass"></div>
		<div class="mt-[3px] border-t-2 border-dashed border-felt-line"></div>
	</header>

	<!-- The bottom padding is the tab bar's clearance and nothing else: the bar is
	     fixed and about 4.5rem tall plus the iOS safe area, so the last thing on
	     the page has to be able to scroll out from under it. (It used to also
	     carry the app-wide TMDB footer above the bar; that band of reserved space
	     is gone — the credit lives in the suggest sheet and in Settings.) -->
	<main
		class="flex-1 px-4 pt-5 {data.devMode
			? 'pb-[calc(9rem_+_env(safe-area-inset-bottom))]'
			: 'pb-[calc(6rem_+_env(safe-area-inset-bottom))]'}"
	>
		{@render children?.()}
	</main>

	{#if data.group}
		{#if data.devMode}
			<DevBar token={data.inviteToken} members={data.group.members} meId={data.group.me.id} />
		{/if}
		<TabBar token={data.inviteToken} swipeCount={data.swipeCount ?? 0} />
	{/if}
</div>
