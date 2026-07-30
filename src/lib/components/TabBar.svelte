<!--
	Bottom tab bar: Round / Pool / History / Settings (app-spec's Screens table).
	Real <a> elements so the whole shell is keyboard- and screen-reader-navigable,
	and so it works with JavaScript off.
-->
<script lang="ts">
	import { page } from '$app/state';

	let { token, swipeCount = 0 }: { token: string; swipeCount?: number } = $props();

	const tabs = $derived([
		{ href: `/g/${token}`, label: 'Round', icon: '🎬', match: (p: string) => p === `/g/${token}` },
		{
			href: `/g/${token}/pool`,
			label: 'Pool',
			icon: '🍿',
			badge: swipeCount,
			match: (p: string) => p.startsWith(`/g/${token}/pool`) || p.startsWith(`/g/${token}/movies`)
		},
		{
			href: `/g/${token}/history`,
			label: 'History',
			icon: '📼',
			match: (p: string) => p.startsWith(`/g/${token}/history`)
		},
		{
			href: `/g/${token}/settings`,
			label: 'Settings',
			icon: '⚙️',
			match: (p: string) => p.startsWith(`/g/${token}/settings`)
		}
	]);
</script>

<nav
	aria-label="Main"
	class="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95"
>
	<ul class="mx-auto flex max-w-lg">
		{#each tabs as tab (tab.href)}
			{@const active = tab.match(page.url.pathname)}
			<li class="flex-1">
				<a
					href={tab.href}
					aria-current={active ? 'page' : undefined}
					class="flex flex-col items-center gap-0.5 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 {active
						? 'text-indigo-600 dark:text-indigo-400'
						: 'text-neutral-500 dark:text-neutral-400'}"
				>
					<span aria-hidden="true" class="relative text-lg leading-none">
						{tab.icon}
						{#if tab.badge}
							<span
								class="absolute -top-1 -right-2 rounded-full bg-indigo-600 px-1 text-[10px] leading-4 font-bold text-white"
							>
								{tab.badge}
							</span>
						{/if}
					</span>
					{tab.label}
					{#if tab.badge}
						<span class="sr-only">{tab.badge} to swipe</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>
