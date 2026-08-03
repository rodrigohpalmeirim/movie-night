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

	The latch is optimistic, in the same spirit as `$lib/latch.svelte.ts`: a real
	radio's button goes down when your finger does, not when the station arrives,
	so the tapped tab latches at once and holds through the whole navigation.
-->
<script lang="ts">
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Film from '$lib/icons/Film.svelte';
	import Popcorn from '$lib/icons/Popcorn.svelte';
	import ScrollText from '$lib/icons/ScrollText.svelte';
	import SlidersHorizontal from '$lib/icons/SlidersHorizontal.svelte';

	let { token, swipeCount = 0 }: { token: string; swipeCount?: number } = $props();

	const tabs = $derived([
		{
			href: `/g/${token}`,
			label: 'Round',
			icon: Popcorn,
			match: (p: string) => p === `/g/${token}`
		},
		{
			href: `/g/${token}/pool`,
			label: 'Pool',
			icon: Film,
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

	function tabFor(pathname: string): string | null {
		return tabs.find((tab) => tab.match(pathname))?.href ?? null;
	}

	/** The tab the route says we are on. What `aria-current` answers to, always. */
	const current = $derived(tabFor(page.url.pathname));

	/** The tab we are on our way to, while a navigation is in the air. */
	let pending = $state<string | null>(null);
	/** Monotonic, so a late abort cannot let go of a newer press's latch. */
	let latchToken = 0;

	function latch(href: string | null) {
		pending = href;
		return ++latchToken;
	}

	/** Intent wins until reality catches up. */
	const latched = $derived(pending ?? current);

	/**
	 * Press first, ask the router later. The router won't run `beforeNavigate`
	 * while another navigation is still in flight, and an impatient second tap on
	 * a slow connection is exactly that — so the press itself has to latch.
	 */
	function press(event: MouseEvent, href: string) {
		// Only the presses that will really become a navigation: a modified click
		// opens a new tab and one already handled goes nowhere, and neither must
		// leave the bar latched on a screen we never went to.
		if (event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (event.defaultPrevented) return;
		latch(href);
	}

	// Navigations the bar didn't start — a back gesture, a link on the page, a
	// redirect — latch the tab they are heading for just the same, so the bar
	// always reads as where you are going. Somewhere with no seat in the bar
	// latches nothing new and simply keeps the current tab down until it lands.
	beforeNavigate((nav) => {
		// Leaving the document altogether: the bar goes with it, so hold nothing.
		if (nav.willUnload || !nav.to) {
			latch(null);
			return;
		}

		const token = latch(tabFor(nav.to.url.pathname));
		// One signal for every ending: `complete` resolves when the navigation
		// lands and rejects when it is cancelled or aborted by a later one. Either
		// way the bar goes back to answering to the route — and it resolves after
		// the new page is committed, so letting go leaves no gap and never depends
		// on the view transition's timing.
		const release = () => {
			if (latchToken === token) pending = null;
		};
		nav.complete.then(release, release);
	});

	// Belt and braces for the navigations `beforeNavigate` never sees (the ones
	// begun while another was in flight): whatever finally lands, the route is
	// the truth again.
	afterNavigate(() => {
		pending = null;
	});
</script>

<nav
	aria-label="Main"
	class="vt-tabbar fixed inset-x-0 bottom-0 z-20 border-t-2 border-board-shade bg-felt-deep pb-[env(safe-area-inset-bottom)]"
>
	<ul class="mx-auto flex max-w-lg gap-2 px-3 pt-2.5 pb-3.5">
		{#each tabs as tab (tab.href)}
			{@const active = latched === tab.href}
			<li class="flex-1">
				<!-- `aria-current` stays with the route even while the latch runs ahead:
				     the press is a promise to the eye, not a claim about where the
				     screen reader currently is. -->
				<a
					href={tab.href}
					aria-current={current === tab.href ? 'page' : undefined}
					class="block"
					onclick={(event) => press(event, tab.href)}
				>
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
