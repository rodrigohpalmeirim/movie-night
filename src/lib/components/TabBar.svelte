<!--
	Bottom tab bar: Round / Pool / History / Settings (app-spec's Screens table).

	A row of latched mechanical buttons, like the station presets on an old car
	radio: every tab is a raised board token you can press, and the screen you
	are on is the one whose button is latched DOWN — sunk flush into the tray,
	brass instead of board, and it stays down until another one is pressed.
	The raised tokens carry the same diagonal two-ply extrusion as every other
	pressable in the app, and pressing one travels the same down-and-right
	diagonal before it latches.

	Real <a> elements so the whole shell is keyboard- and screen-reader-navigable,
	and so it works with JavaScript off.
-->
<script lang="ts">
	import { page } from '$app/state';
	import Clapperboard from '$lib/icons/Clapperboard.svelte';
	import Layers2 from '$lib/icons/Layers2.svelte';
	import ScrollText from '$lib/icons/ScrollText.svelte';
	import SlidersHorizontal from '$lib/icons/SlidersHorizontal.svelte';

	let { token, swipeCount = 0 }: { token: string; swipeCount?: number } = $props();

	const tabs = $derived([
		{
			href: `/g/${token}`,
			label: 'Round',
			icon: Clapperboard,
			match: (p: string) => p === `/g/${token}`
		},
		{
			href: `/g/${token}/pool`,
			label: 'Pool',
			icon: Layers2,
			badge: swipeCount,
			match: (p: string) => p.startsWith(`/g/${token}/pool`) || p.startsWith(`/g/${token}/movies`)
		},
		{
			href: `/g/${token}/history`,
			label: 'History',
			icon: ScrollText,
			match: (p: string) => p.startsWith(`/g/${token}/history`)
		},
		{
			href: `/g/${token}/settings`,
			label: 'Settings',
			icon: SlidersHorizontal,
			match: (p: string) => p.startsWith(`/g/${token}/settings`)
		}
	]);
</script>

<nav
	aria-label="Main"
	class="vt-tabbar fixed inset-x-0 bottom-0 z-20 border-t-2 border-board-shade bg-felt-deep pb-[env(safe-area-inset-bottom)]"
>
	<ul class="mx-auto flex max-w-lg gap-2 px-3 pt-2.5 pb-3.5">
		{#each tabs as tab (tab.href)}
			{@const active = tab.match(page.url.pathname)}
			<li class="flex-1">
				<a href={tab.href} aria-current={active ? 'page' : undefined} class="block">
					<!-- The real `.token` set rather than a hand-rolled copy of it: `token-sm`
					     is exactly this tab's 3px lift, and `token-latched` is exactly the
					     press animation's end state, so a tab can never drift away from the
					     rest of the app's pressables. Only the layout (icon stacked over
					     label) and the brass fill are added on top. -->
					<span
						class="token token-sm relative flex-col gap-0.5 py-1.5 {active
							? 'token-brass token-latched'
							: ''}"
					>
						<tab.icon size={20} />
						<span class="eyebrow text-[0.62rem] tracking-[0.1em]">{tab.label}</span>
						{#if tab.badge}
							<!-- badge-pop runs when the chip first lands (0 → N, e.g. a
							     top-up arriving over SSE); a count that merely changes
							     keeps this node and does not re-pop. -->
							<span
								class="stencil badge-pop absolute -top-2 -right-2 min-w-[1.15rem] rounded-full border-2 border-ink bg-cherry px-1 text-center text-[0.65rem] leading-[0.95rem] font-semibold text-ink"
								aria-hidden="true"
							>
								{tab.badge}
							</span>
							<span class="sr-only">{tab.badge} to swipe</span>
						{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
