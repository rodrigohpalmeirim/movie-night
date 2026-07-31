<!--
	History tab: "Past nights, newest first: winner poster, date, suggested-by;
	expandable to the round's full revealed tally."

	Each night is a played-and-filed ticket stub: the winner's artwork on the left,
	the facts on the right, and the scorepad folded up underneath.
-->
<script lang="ts">
	import Poster from '$lib/components/Poster.svelte';
	import RevealTally from '$lib/components/RevealTally.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ChevronRight from '$lib/icons/ChevronRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatDate, movieMeta } from '$lib/images.js';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<div class="space-y-4">
	<div>
		<p class="eyebrow text-brass">The record</p>
		<h2 class="display mt-1 text-[1.6rem] text-board">Past nights</h2>
	</div>

	{#if data.entries.length === 0}
		<p class="tile-slot px-4 py-8 text-center text-sm text-chalk-dim">
			No nights yet. Once a round is revealed it lands here, tally and all.
		</p>
	{:else}
		<!-- Stubs are filed newest first and deal in the same way. Keyed by
		     round id, so the SSE refresh reuses the nodes — no re-deal. -->
		<ul class="space-y-4">
			{#each data.entries as entry, i (entry.roundId)}
				<li class="deal-in tile overflow-hidden" style="--deal:{i}">
					<div class="flex gap-3 p-3">
						<div class="w-16 shrink-0">
							<div class="aspect-[2/3] overflow-hidden rounded-[3px] border-2 border-ink">
								{#if entry.winner}
									<Poster path={entry.winner.posterPath} title={entry.winner.title} size="w185" />
								{:else}
									<div class="flex h-full w-full items-center justify-center bg-felt-deep p-1">
										<Stamp word="No pick" tone="cherry" size="0.6rem" rotate={-8} />
									</div>
								{/if}
							</div>
						</div>
						<div class="min-w-0 flex-1">
							<p class="stencil text-[0.7rem] text-ink-soft uppercase">
								{formatDate(entry.watchedAt ?? entry.decidedAt)}
								{#if entry.state === 'watched'}· watched{:else}· decided, not watched yet{/if}
							</p>
							<p class="mt-0.5 text-[0.95rem] leading-snug font-semibold text-ink">
								{entry.winner?.title ?? 'No clear favourite'}
							</p>
							{#if entry.winner}
								<p class="mt-1 text-xs text-ink-soft">
									{movieMeta(entry.winner.year, entry.winner.runtimeMin)}
									{#if entry.winner.suggestedBy}· suggested by {entry.winner.suggestedBy
											.displayName}{/if}
								</p>
							{/if}
							{#if entry.reveal.veto.vetoesIgnored}
								<!--
									The tally below is collapsed on this tab, so the veto exception
									would otherwise be a tap away. voting-spec asks for it to be
									surfaced prominently, so it rides on the row itself.
								-->
								<p
									class="stencil mt-2 inline-flex items-start gap-1.5 rounded border-2 border-ink bg-cherry px-1.5 py-1 text-[0.68rem] leading-snug font-semibold text-ink uppercase"
								>
									<TriangleAlert size={13} class="mt-px shrink-0" />
									Vetoes set aside — they would have left fewer than two films
								</p>
							{/if}
						</div>
					</div>
					<details class="group/tally expand border-t-2 border-dashed border-board-shade">
						<summary
							class="eyebrow row-press flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-ink-soft select-none hover:text-ink focus-visible:outline-offset-[-3px]"
						>
							<ChevronRight
								size={14}
								class="transition-transform group-open/tally:rotate-90 motion-reduce:transition-none"
							/>
							How the vote went
						</summary>
						<div class="border-t-2 border-dashed border-board-shade p-3">
							<RevealTally reveal={entry.reveal} />
						</div>
					</details>
				</li>
			{/each}
		</ul>
	{/if}
</div>
