<!--
	Pairwise screen: "Two posters per screen, tap one or 'no preference'; progress
	indicator."

	The order is the server's per-member shuffle, and progress is per-voter only —
	no aggregate ever appears here, which is why there is nothing to hide: the
	payload simply does not contain one.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import { formatRuntime } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const round = $derived(data.round);
	const me = $derived(round.me);
	const finalists = $derived(new Map((round.finalists ?? []).map((movie) => [movie.id, movie])));
	const answered = $derived(new Set(me.myPairVotes.map((vote) => `${vote.a}|${vote.b}`)));

	/** Local cursor through my own shuffled order, so a tap doesn't jump around. */
	let cursor = $state(0);
	$effect(() => {
		// Start on the first pair I haven't answered.
		const firstUnanswered = me.pairOrder.findIndex((pair) => !answered.has(`${pair.a}|${pair.b}`));
		cursor = firstUnanswered === -1 ? me.pairOrder.length : firstUnanswered;
	});

	const pair = $derived(me.pairOrder[cursor] ?? null);
	const left = $derived(pair ? finalists.get(pair.a) : undefined);
	const right = $derived(pair ? finalists.get(pair.b) : undefined);
	const doneCount = $derived(me.pairOrder.filter((p) => answered.has(`${p.a}|${p.b}`)).length);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<a
			href="/g/{data.token}"
			class="text-sm text-neutral-500 underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-neutral-400"
			>Back to the round</a
		>
		<p class="text-sm font-medium tabular-nums" aria-live="polite">
			{Math.min(doneCount + (pair ? 1 : 0), me.pairsTotal)} of {me.pairsTotal}
		</p>
	</div>

	<div
		class="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
		role="progressbar"
		aria-valuenow={doneCount}
		aria-valuemin="0"
		aria-valuemax={me.pairsTotal}
		aria-label="Pairs completed"
	>
		<div
			class="h-full rounded-full bg-indigo-600 transition-all"
			style="width: {me.pairsTotal === 0 ? 0 : (doneCount / me.pairsTotal) * 100}%"
		></div>
	</div>

	{#if form?.message}
		<p role="alert" class="text-sm font-medium text-rose-600 dark:text-rose-400">{form.message}</p>
	{/if}

	{#if !pair || !left || !right}
		<div class="space-y-4 py-10 text-center">
			<Stamp word="Done" tone="jade" size="1.35rem" rotate={-7} slam class="mb-1" />
			<h2 class="text-xl font-bold tracking-tight">All done</h2>
			<p class="text-sm text-neutral-600 dark:text-neutral-300">
				Your picks are in. Nothing is revealed until someone hits reveal on the round screen.
			</p>
			<div class="flex flex-col gap-2">
				<a
					href="/g/{data.token}"
					class="rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
					>Back to the round</a
				>
				{#if me.pairsTotal > 0}
					<button
						type="button"
						onclick={() => (cursor = 0)}
						class="rounded-xl border border-neutral-300 px-4 py-3 font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
					>
						Review my picks
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<h2 class="text-center text-base font-semibold">Which one, tonight?</h2>

		<form
			method="POST"
			action="?/pick"
			use:enhance={() => async ({ update }) => {
				cursor += 1;
				await update({ reset: false, invalidateAll: false });
			}}
		>
			<input type="hidden" name="round_id" value={round.id} />
			<input type="hidden" name="a" value={pair.a} />
			<input type="hidden" name="b" value={pair.b} />

			<div class="grid grid-cols-2 gap-3">
				{#each [left, right] as movie (movie.id)}
					<button
						name="winner"
						value={movie.id}
						class="group space-y-2 rounded-xl border border-neutral-200 p-2 text-left transition hover:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-800"
					>
						<div class="aspect-[2/3] overflow-hidden rounded-lg">
							<Poster path={movie.posterPath} title={movie.title} size="w342" eager />
						</div>
						<span class="block text-sm font-semibold">{movie.title}</span>
						<span class="block text-xs text-neutral-500 dark:text-neutral-400">
							{formatRuntime(movie.runtimeMin)}
						</span>
					</button>
				{/each}
			</div>

			<button
				name="winner"
				value=""
				class="mt-3 w-full rounded-xl border border-neutral-300 px-4 py-3 font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
			>
				No preference
			</button>
		</form>

		<p class="text-center text-xs text-neutral-500 dark:text-neutral-400">
			Haven't seen either? "No preference" is the honest answer and counts for neither side.
		</p>

		{#if cursor > 0}
			<button
				type="button"
				onclick={() => (cursor -= 1)}
				class="mx-auto block rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-neutral-300"
			>
				Back one pair
			</button>
		{/if}
	{/if}
</div>
