<!--
	Bottom tab bar: Round / Pool / History / Settings (app-spec's Screens table).

	Styled as the tray along the near edge of the board — a darker plane with a
	board-stock lip. The current tab is the one whose token has been pushed up
	out of the tray: brass fill, ink icon.

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
	<ul class="mx-auto flex max-w-lg">
		{#each tabs as tab (tab.href)}
			{@const active = tab.match(page.url.pathname)}
			<li class="flex-1">
				<a
					href={tab.href}
					aria-current={active ? 'page' : undefined}
					class="flex flex-col items-center gap-1 py-2 focus-visible:outline-offset-[-3px] {active
						? 'text-brass'
						: 'text-chalk-dim'}"
				>
					<span
						class="relative flex h-8 w-10 items-center justify-center rounded border-2 {active
							? 'border-ink bg-brass text-ink shadow-[0.5px_1px_0_0_var(--color-brass-deep),1px_2px_0_0_var(--color-brass-deep),2px_4px_0_0_var(--color-ink)]'
							: 'border-transparent'}"
					>
						<tab.icon size={20} />
						{#if tab.badge}
							<!-- badge-pop runs when the chip first lands (0 → N, e.g. a
							     top-up arriving over SSE); a count that merely changes
							     keeps this node and does not re-pop. -->
							<span
								class="stencil badge-pop absolute -top-1.5 -right-1.5 min-w-[1.15rem] rounded-full border-2 border-ink bg-brass px-1 text-center text-[0.65rem] leading-[0.95rem] font-semibold text-ink"
								aria-hidden="true"
							>
								{tab.badge}
							</span>
						{/if}
					</span>
					<span class="eyebrow text-[0.62rem] tracking-[0.12em]">{tab.label}</span>
					{#if tab.badge}
						<span class="sr-only">{tab.badge} to swipe</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
