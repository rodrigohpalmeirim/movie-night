<!--
	History tab: "Past nights, newest first: winner poster, date, suggested-by;
	expandable to the round's full revealed tally."
-->
<script lang="ts">
	import Poster from '$lib/components/Poster.svelte';
	import RevealTally from '$lib/components/RevealTally.svelte';
	import { formatDate, movieMeta } from '$lib/images.js';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<div class="space-y-5">
	<h2 class="text-xl font-bold tracking-tight">Past nights</h2>

	{#if data.entries.length === 0}
		<p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
			No nights yet. Once a round is revealed it lands here, tally and all.
		</p>
	{:else}
		<ul class="space-y-3">
			{#each data.entries as entry (entry.roundId)}
				<li class="rounded-xl border border-neutral-200 dark:border-neutral-800">
					<div class="flex gap-3 p-3">
						<div class="h-24 w-16 shrink-0 overflow-hidden rounded-lg">
							{#if entry.winner}
								<Poster path={entry.winner.posterPath} title={entry.winner.title} size="w185" />
							{:else}
								<div
									class="flex h-full w-full items-center justify-center bg-neutral-200 text-2xl dark:bg-neutral-800"
									aria-hidden="true"
								>
									🤷
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1 space-y-1">
							<p class="text-sm font-semibold">
								{entry.winner?.title ?? 'No clear favourite'}
							</p>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								{formatDate(entry.watchedAt ?? entry.decidedAt)}
								{#if entry.state === 'watched'}· watched{:else}· decided, not watched yet{/if}
							</p>
							{#if entry.winner}
								<p class="text-xs text-neutral-500 dark:text-neutral-400">
									{movieMeta(entry.winner.year, entry.winner.runtimeMin)}
									{#if entry.winner.suggestedBy}· suggested by {entry.winner.suggestedBy.displayName}{/if}
								</p>
							{/if}
							{#if entry.reveal.veto.vetoesIgnored}
								<!--
									The tally below is collapsed on this tab, so the veto exception
									would otherwise be a tap away. voting-spec asks for it to be
									surfaced prominently, so it rides on the row itself.
								-->
								<p
									class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
								>
									<span aria-hidden="true">⚠</span> Vetoes set aside — they would have left
									fewer than two films
								</p>
							{/if}
						</div>
					</div>
					<details class="border-t border-neutral-200 dark:border-neutral-800">
						<summary
							class="cursor-pointer px-3 py-2 text-xs font-semibold text-neutral-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-neutral-300"
						>
							How the vote went
						</summary>
						<div class="border-t border-neutral-200 p-3 dark:border-neutral-800">
							<RevealTally reveal={entry.reveal} />
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>
