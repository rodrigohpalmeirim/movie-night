<!--
	The now-public tally.

	app-spec: "the now-public tallies — head-to-head grid, approval numbers,
	vetoes, and which tiebreak rule (if any) decided it, including the
	seeded-random proof."

	Drawn as the scorepad that comes with the game: ink on board stock, ruled
	rows, condensed stencil headers, numbers right-aligned and tabular. It is
	always rendered inside a board component (the round page's disclosure, or a
	history row), so it styles for ink-on-board and never carries its own surface.

	Rendered only where `reveal` is non-null, which the server populates for
	`decided`/`watched` rounds and nothing else — so this component cannot leak
	anything early even if it were mounted by mistake.
-->
<script lang="ts">
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatPercent, TIEBREAK_LABELS } from '$lib/images.js';
	import type { RevealView } from '$lib/server/services/views.js';

	let { reveal }: { reveal: RevealView } = $props();

	const titleOf = $derived(new Map(reveal.finalists.map((movie) => [movie.id, movie.title])));
	const ids = $derived(reveal.finalists.map((movie) => movie.id));

	/**
	 * Total vetoes cast on finalists, summed from the per-movie counts. Derived
	 * rather than read from a member→movie list: individual veto ballots are not
	 * published (neither spec authorises attributing a veto to a person), so the
	 * per-movie counts are all the reveal carries.
	 */
	const vetoTotal = $derived(
		Object.values(reveal.veto.counts).reduce((sum, count) => sum + count, 0)
	);

	/** The voting-spec exception: vetoes existed, but honouring them would have
	 *  left fewer than two finalists, so they were set aside for the ranking.
	 *  Both halves are required — a round where nobody vetoed must say nothing. */
	const vetoesSetAside = $derived(reveal.veto.vetoesIgnored && vetoTotal > 0);

	/** Films that met the veto threshold. They were only actually removed from the
	 *  comparison if the exception above did not fire. */
	const vetoedOut = $derived(
		reveal.finalists.filter((movie) => reveal.veto.disqualifiedIds.includes(movie.id))
	);

	/** aWins for (row, col), read off the normalised matrix in either direction. */
	function preferredCount(row: string, col: string): number | null {
		for (const head of reveal.matrix) {
			if (head.a === row && head.b === col) return head.aWins;
			if (head.b === row && head.a === col) return head.bWins;
		}
		return null;
	}

	function joinTitles(movies: Array<{ title: string }>): string {
		const titles = movies.map((movie) => movie.title);
		if (titles.length < 2) return titles.join('');
		return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
	}

	function pairWinner(row: string, col: string): string | null {
		for (const head of reveal.matrix) {
			if ((head.a === row && head.b === col) || (head.b === row && head.a === col))
				return head.winner;
		}
		return null;
	}
</script>

<div class="space-y-5 text-ink">
	<!--
		voting-spec: "if vetoes leave fewer than two finalists, ignore them for
		ranking but surface them prominently in the UI." First thing in the reveal,
		full-width, always expanded — not a footnote further down.
	-->
	{#if vetoesSetAside}
		<!-- No id/aria-labelledby: the history tab renders one tally per past night,
		     and a duplicated id would be worse than an unnamed region. -->
		<section class="rounded-md border-2 border-ink bg-cherry p-3 text-ink">
			<h3 class="eyebrow flex items-center gap-1.5">
				<TriangleAlert size={15} /> Vetoes were set aside tonight
			</h3>
			<p class="mt-1.5 text-sm leading-relaxed">
				{vetoTotal === 1 ? 'One veto was' : `${vetoTotal} vetoes were`} cast{#if vetoedOut.length > 0}, and
					{joinTitles(vetoedOut)} reached the veto threshold{/if}. Honouring
				{vetoedOut.length === 1 ? 'that' : 'those'} would have left fewer than two films to compare, so
				the rules kept the options on the table: nothing was disqualified, and every finalist went into
				the head-to-head below. The vetoes are listed in full further down.
			</p>
		</section>
	{/if}

	<!-- Approvals -->
	<section>
		<h3 class="eyebrow border-b-2 border-ink pb-1.5">Approval</h3>
		<p class="mt-2 text-xs leading-relaxed text-ink-soft">
			Approval counts only attendees who had swiped the card; coverage is how many attendees had seen
			it at all.
		</p>
		<div class="mt-2 overflow-x-auto">
			<table class="scoresheet w-full text-sm">
				<thead>
					<tr>
						<th scope="col" class="py-1.5 pr-2 text-left">Film</th>
						<th scope="col" class="py-1.5 pr-2 text-right">Yes</th>
						<th scope="col" class="py-1.5 pr-2 text-right">Swiped</th>
						<th scope="col" class="py-1.5 pr-2 text-right">Approval</th>
						<th scope="col" class="py-1.5 text-right">Coverage</th>
					</tr>
				</thead>
				<tbody>
					{#each reveal.tallies as tally (tally.movieId)}
						<tr>
							<th scope="row" class="py-1.5 pr-2 text-left font-medium"
								>{titleOf.get(tally.movieId) ?? tally.movieId}</th
							>
							<td class="py-1.5 pr-2 text-right tabular-nums">{tally.yesVotes}</td>
							<td class="py-1.5 pr-2 text-right tabular-nums">{tally.attendeeVotes}</td>
							<td class="py-1.5 pr-2 text-right font-semibold tabular-nums"
								>{formatPercent(tally.approval)}</td
							>
							<td class="py-1.5 text-right tabular-nums text-ink-soft"
								>{formatPercent(tally.coverage)}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Head-to-head grid -->
	{#if reveal.matrix.length > 0}
		<section>
			<h3 class="eyebrow border-b-2 border-ink pb-1.5">Head to head</h3>
			<p class="mt-2 text-xs leading-relaxed text-ink-soft">
				How many attendees preferred the row film over the column film. Blank cells were not
				compared.
			</p>
			<!-- A matrix squeezed to fit is a matrix nobody can read: it scrolls
			     sideways instead, with every film's name intact. -->
			<div class="mt-2 overflow-x-auto">
				<table class="scoresheet w-auto min-w-full text-sm whitespace-nowrap">
					<caption class="sr-only">Pairwise preference counts between surviving finalists</caption>
					<thead>
						<tr>
							<th scope="col" class="py-1.5 pr-2 text-left">
								<span class="inline-flex items-center gap-1">over <ArrowRight size={12} /></span>
							</th>
							{#each ids as id (id)}
								{#if reveal.veto.survivingIds.includes(id)}
									<th scope="col" class="px-2 py-1.5 text-right">{titleOf.get(id)}</th>
								{/if}
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each ids as row (row)}
							{#if reveal.veto.survivingIds.includes(row)}
								<tr>
									<th scope="row" class="py-1.5 pr-2 text-left font-medium">{titleOf.get(row)}</th>
									{#each ids as col (col)}
										{#if reveal.veto.survivingIds.includes(col)}
											<td class="px-2 py-1.5 text-right tabular-nums">
												{#if row === col}
													<span class="text-board-shade" aria-hidden="true">—</span>
												{:else}
													{@const count = preferredCount(row, col)}
													<span
														class={pairWinner(row, col) === row
															? 'rounded bg-jade px-1.5 py-0.5 font-bold text-ink'
															: 'text-ink-soft'}
													>
														{count ?? '·'}
													</span>
												{/if}
											</td>
										{/if}
									{/each}
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
			<dl class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
				{#each ids as id (id)}
					{#if id in reveal.copeland}
						<div class="flex gap-1">
							<dt class="stencil uppercase">{titleOf.get(id)} pairwise wins:</dt>
							<dd class="font-semibold tabular-nums text-ink">{reveal.copeland[id]}</dd>
						</div>
					{/if}
				{/each}
			</dl>
			{#if reveal.condorcetWinnerId}
				<p class="mt-1.5 text-xs text-ink-soft">
					{titleOf.get(reveal.condorcetWinnerId)} beat every other survivor, so no tiebreak was
					needed.
				</p>
			{/if}
		</section>
	{/if}

	<!-- Vetoes -->
	<section>
		<h3 class="eyebrow border-b-2 border-ink pb-1.5">Vetoes</h3>
		<!--
			Counts per film only. Who vetoed what is never published: the specs
			authorise the veto count as a tally, not individual veto ballots.
		-->
		{#if vetoTotal === 0}
			<p class="mt-2 text-sm text-ink-soft">Nobody vetoed anything.</p>
		{:else}
			<ul class="mt-2 space-y-1.5 text-sm">
				{#each reveal.finalists as movie (movie.id)}
					{@const count = reveal.veto.counts[movie.id] ?? 0}
					{#if count > 0}
						<!-- Same shape as the veto screen's rows: the count and its seal are
						     a fixed cluster on the right, and the title takes what is left and
						     wraps. Left to negotiate, a long title squeezed "2 vetoes" into a
						     column one word wide. -->
						<li class="flex items-center justify-between gap-2">
							<span class="min-w-0 flex-1 font-medium break-words">{movie.title}</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="stencil text-xs text-ink-soft uppercase"
									>{count} veto{count === 1 ? '' : 'es'}</span
								>
								{#if reveal.veto.disqualifiedIds.includes(movie.id)}
									{#if vetoesSetAside}
										<Stamp word="Set aside" tone="brass" size="0.72rem" rotate={-5} />
									{:else}
										<Stamp word="Out" tone="cherry" size="0.72rem" rotate={-5} />
									{/if}
									<span class="sr-only"
										>{vetoesSetAside ? 'veto set aside' : 'disqualified by veto'}</span
									>
								{/if}
							</span>
						</li>
					{/if}
				{/each}
			</ul>
			{#if vetoesSetAside}
				<p class="mt-2 text-xs text-ink-soft">
					Nothing was actually removed from the comparison — see “Vetoes were set aside tonight” at
					the top.
				</p>
			{/if}
		{/if}
	</section>

	<!-- Tiebreak + audit trail -->
	<section>
		<h3 class="eyebrow border-b-2 border-ink pb-1.5">How it was decided</h3>
		<p class="mt-2 text-sm leading-relaxed">
			{#if reveal.outcome === 'no_clear_favourite'}
				No film cleared the approval floor.
			{:else if reveal.tiebreakRuleUsed}
				Decided by <strong class="font-semibold"
					>{TIEBREAK_LABELS[reveal.tiebreakRuleUsed] ?? reveal.tiebreakRuleUsed}</strong
				>.
			{:else if reveal.matrix.length > 0}
				A clear head-to-head winner — no tiebreak rule was consulted.
			{:else}
				Only one film cleared the approval floor, so it won outright.
			{/if}
		</p>
		<p class="mt-1.5 text-xs leading-relaxed text-ink-soft">
			Random seed for this round:
			<code class="rounded bg-ink px-1.5 py-0.5 font-mono text-[0.7rem] tabular-nums text-board"
				>{reveal.randomSeed}</code
			>
			— kept so any seeded tiebreak can be reproduced and checked.
		</p>
	</section>
</div>
