<!--
	The now-public tally.

	app-spec: "the now-public tallies — head-to-head grid, approval numbers,
	vetoes, and which tiebreak rule (if any) decided it, including the
	seeded-random proof."

	Rendered only where `reveal` is non-null, which the server populates for
	`decided`/`watched` rounds and nothing else — so this component cannot leak
	anything early even if it were mounted by mistake.
-->
<script lang="ts">
	import { formatPercent, TIEBREAK_LABELS } from '$lib/images.js';
	import type { RevealView } from '$lib/server/services/views.js';

	let { reveal }: { reveal: RevealView } = $props();

	const titleOf = $derived(
		new Map(reveal.finalists.map((movie) => [movie.id, movie.title]))
	);
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
			if ((head.a === row && head.b === col) || (head.b === row && head.a === col)) return head.winner;
		}
		return null;
	}
</script>

<div class="space-y-6">
	<!--
		voting-spec: "if vetoes leave fewer than two finalists, ignore them for
		ranking but surface them prominently in the UI." First thing in the reveal,
		full-width, always expanded — not a footnote further down.
	-->
	{#if vetoesSetAside}
		<!-- No id/aria-labelledby: the history tab renders one tally per past night,
		     and a duplicated id would be worse than an unnamed region. -->
		<section
			class="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/70 dark:bg-amber-950/50 dark:text-amber-100"
		>
			<h3 class="text-sm font-bold">
				<span aria-hidden="true">⚠️</span> Vetoes were set aside tonight
			</h3>
			<p class="mt-1 text-sm">
				{vetoTotal === 1 ? 'One veto was' : `${vetoTotal} vetoes were`} cast{#if vetoedOut.length > 0}, and
					{joinTitles(vetoedOut)} reached the veto threshold{/if}. Honouring
				{vetoedOut.length === 1 ? 'that' : 'those'} would have left fewer than two films to compare,
				so the rules kept the options on the table: nothing was disqualified, and every finalist went
				into the head-to-head below. The vetoes are listed in full further down.
			</p>
		</section>
	{/if}

	<!-- Approvals -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Approval</h3>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Approval counts only attendees who had swiped the card; coverage is how many
			attendees had seen it at all.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-xs text-neutral-500 dark:text-neutral-400">
					<tr>
						<th scope="col" class="py-1 pr-2 font-medium">Film</th>
						<th scope="col" class="py-1 pr-2 text-right font-medium">Yes</th>
						<th scope="col" class="py-1 pr-2 text-right font-medium">Swiped</th>
						<th scope="col" class="py-1 pr-2 text-right font-medium">Approval</th>
						<th scope="col" class="py-1 text-right font-medium">Coverage</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
					{#each reveal.tallies as tally (tally.movieId)}
						<tr>
							<th scope="row" class="py-1.5 pr-2 text-left font-medium"
								>{titleOf.get(tally.movieId) ?? tally.movieId}</th
							>
							<td class="py-1.5 pr-2 text-right tabular-nums">{tally.yesVotes}</td>
							<td class="py-1.5 pr-2 text-right tabular-nums">{tally.attendeeVotes}</td>
							<td class="py-1.5 pr-2 text-right tabular-nums">{formatPercent(tally.approval)}</td>
							<td class="py-1.5 text-right tabular-nums">{formatPercent(tally.coverage)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Head-to-head grid -->
	{#if reveal.matrix.length > 0}
		<section class="space-y-2">
			<h3 class="text-sm font-semibold">Head to head</h3>
			<p class="text-xs text-neutral-500 dark:text-neutral-400">
				How many attendees preferred the row film over the column film. Blank cells were
				not compared.
			</p>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<caption class="sr-only">Pairwise preference counts between surviving finalists</caption>
					<thead class="text-xs text-neutral-500 dark:text-neutral-400">
						<tr>
							<th scope="col" class="py-1 pr-2 text-left font-medium">over →</th>
							{#each ids as id (id)}
								{#if reveal.veto.survivingIds.includes(id)}
									<th scope="col" class="px-2 py-1 text-right font-medium">{titleOf.get(id)}</th>
								{/if}
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
						{#each ids as row (row)}
							{#if reveal.veto.survivingIds.includes(row)}
								<tr>
									<th scope="row" class="py-1.5 pr-2 text-left font-medium">{titleOf.get(row)}</th>
									{#each ids as col (col)}
										{#if reveal.veto.survivingIds.includes(col)}
											<td class="px-2 py-1.5 text-right tabular-nums">
												{#if row === col}
													<span class="text-neutral-300 dark:text-neutral-700" aria-hidden="true">—</span>
												{:else}
													{@const count = preferredCount(row, col)}
													<span class={pairWinner(row, col) === row ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''}>
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
			<dl class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
				{#each ids as id (id)}
					{#if id in reveal.copeland}
						<div class="flex gap-1">
							<dt>{titleOf.get(id)} pairwise wins:</dt>
							<dd class="font-semibold tabular-nums">{reveal.copeland[id]}</dd>
						</div>
					{/if}
				{/each}
			</dl>
			{#if reveal.condorcetWinnerId}
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					{titleOf.get(reveal.condorcetWinnerId)} beat every other survivor, so no tiebreak was needed.
				</p>
			{/if}
		</section>
	{/if}

	<!-- Vetoes -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Vetoes</h3>
		<!--
			Counts per film only. Who vetoed what is never published: the specs
			authorise the veto count as a tally, not individual veto ballots.
		-->
		{#if vetoTotal === 0}
			<p class="text-sm text-neutral-500 dark:text-neutral-400">Nobody vetoed anything.</p>
		{:else}
			<ul class="space-y-1 text-sm">
				{#each reveal.finalists as movie (movie.id)}
					{@const count = reveal.veto.counts[movie.id] ?? 0}
					{#if count > 0}
						<li class="flex items-center justify-between gap-2">
							<span>{movie.title}</span>
							<span class="flex items-center gap-2">
								<span class="tabular-nums text-neutral-500 dark:text-neutral-400"
									>{count} veto{count === 1 ? '' : 'es'}</span
								>
								{#if reveal.veto.disqualifiedIds.includes(movie.id)}
									{#if vetoesSetAside}
										<span class="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300"
											>veto set aside</span
										>
									{:else}
										<span class="rounded-full bg-rose-600/15 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-400"
											>disqualified</span
										>
									{/if}
								{/if}
							</span>
						</li>
					{/if}
				{/each}
			</ul>
			{#if vetoesSetAside}
				<p class="text-xs text-amber-800 dark:text-amber-300">
					Nothing was actually removed from the comparison — see “Vetoes were set aside tonight”
					at the top.
				</p>
			{/if}
		{/if}
	</section>

	<!-- Tiebreak + audit trail -->
	<section class="space-y-1">
		<h3 class="text-sm font-semibold">How it was decided</h3>
		<p class="text-sm">
			{#if reveal.outcome === 'no_clear_favourite'}
				No film cleared the approval floor.
			{:else if reveal.tiebreakRuleUsed}
				Decided by <strong>{TIEBREAK_LABELS[reveal.tiebreakRuleUsed] ?? reveal.tiebreakRuleUsed}</strong>.
			{:else if reveal.matrix.length > 0}
				A clear head-to-head winner — no tiebreak rule was consulted.
			{:else}
				Only one film cleared the approval floor, so it won outright.
			{/if}
		</p>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Random seed for this round: <code class="tabular-nums">{reveal.randomSeed}</code> — kept so any
			seeded tiebreak can be reproduced and checked.
		</p>
	</section>
</div>
