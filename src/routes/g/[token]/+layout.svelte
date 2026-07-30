<!--
	Group shell: header, bottom tab bar, and the live-update stream.

	The picker renders inside this shell too, and it is reachable before an
	identity is claimed, so `data.group` may be null — the tab bar is hidden until
	there is a member to be.
-->
<script lang="ts">
	import TabBar from '$lib/components/TabBar.svelte';
	import { startLiveUpdates } from '$lib/live.js';
	import DevBar from './dev/DevBar.svelte';
	import type { LayoutServerData } from './$types';

	let { data, children }: { data: LayoutServerData; children?: import('svelte').Snippet } =
		$props();

	// Owned by an effect so the stream is torn down on navigation away and
	// re-established if the token ever changes (e.g. after regenerating the link).
	$effect(() => startLiveUpdates(data.inviteToken));
</script>

<svelte:head>
	<title>{data.groupName} — Movie Night</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-lg flex-col">
	<header class="flex items-baseline justify-between px-4 pt-4 pb-2">
		<h1 class="truncate text-lg font-bold tracking-tight">{data.groupName}</h1>
		{#if data.group}
			<p class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
				{data.group.me.displayName}
			</p>
		{/if}
	</header>

	<main class="flex-1 px-4 {data.devMode ? 'pb-36' : 'pb-24'}">
		{@render children?.()}
	</main>

	{#if data.group}
		{#if data.devMode}
			<DevBar
				token={data.inviteToken}
				members={data.group.members}
				meId={data.group.me.id}
			/>
		{/if}
		<TabBar token={data.inviteToken} swipeCount={data.swipeCount ?? 0} />
	{/if}
</div>
