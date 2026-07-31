<!--
	Pairwise screen: "Two posters per screen, tap one or 'no preference'; progress
	indicator."

	A face-off: two cards dealt side by side with an ink VS medallion struck over
	the gutter between them. Both cards are raised, because both are the control —
	picking one is a press, and the whole card is the target. "No preference" is an
	empty slot underneath, so refusing to choose still looks like a move on the
	board rather than a missing button.

	The order is the server's per-member shuffle, and progress is per-voter only —
	no aggregate ever appears here, which is why there is nothing to hide: the
	payload simply does not contain one.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
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
	<div class="space-y-2">
		<div class="flex items-baseline justify-between gap-3">
			<a
				href="/g/{data.token}"
				class="stencil flex items-center gap-1.5 text-xs text-chalk-dim uppercase hover:text-brass"
			>
				<ArrowLeft size={14} /> Back to the round
			</a>
			<p class="eyebrow text-brass" aria-live="polite">
				Pair {Math.min(doneCount + (pair ? 1 : 0), me.pairsTotal)}
				<span class="text-chalk-dim">of {me.pairsTotal}</span>
			</p>
		</div>
		<!-- The same punched rail the swipe deck uses: one progress grammar. -->
		<div
			class="h-2.5 overflow-hidden rounded-full border-2 border-board-shade bg-felt-deep"
			role="progressbar"
			aria-valuenow={doneCount}
			aria-valuemin="0"
			aria-valuemax={me.pairsTotal}
			aria-label="Pairs compared"
		>
			<div
				class="h-full rounded-full bg-brass transition-[width] duration-200"
				style="width: {me.pairsTotal === 0 ? 0 : (doneCount / me.pairsTotal) * 100}%"
			></div>
		</div>
	</div>

	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}

	{#if !pair || !left || !right}
		<div class="tile-slot space-y-3.5 px-4 py-8 text-center">
			<Stamp word="Done" tone="jade" size="1.3rem" rotate={-7} slam />
			<h2 class="display text-[1.6rem] text-board">Your picks are in</h2>
			<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
				Nothing is revealed until someone hits reveal on the round screen.
			</p>
			<div class="mx-auto flex max-w-[15rem] flex-col gap-2.5 pt-1">
				<a href="/g/{data.token}" class="token token-brass w-full">
					Back to the round
					<ArrowRight size={17} />
				</a>
				{#if me.pairsTotal > 0}
					<button type="button" onclick={() => (cursor = 0)} class="token token-slot w-full">
						Review my picks
					</button>
				{/if}
			</div>
		</div>
	{:else}
		<h2 class="display text-center text-[1.45rem] text-board">Which one, tonight?</h2>

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

			<div class="relative">
				<div class="grid grid-cols-2 gap-4">
					<!-- Each new pair is dealt: keyed by movie id, so advancing the
					     cursor deals two fresh cards (left a beat before right), while
					     an SSE refresh that lands on the same pair reuses the nodes. -->
					{#each [left, right] as movie, i (movie.id)}
						<button
							name="winner"
							value={movie.id}
							class="deal-in tile tile-press p-2 text-left"
							style="--deal:{i}"
						>
							<span class="block aspect-[2/3] overflow-hidden rounded-[3px] border-2 border-ink">
								<Poster path={movie.posterPath} title={movie.title} size="w342" eager />
							</span>
							<span class="mt-2 block text-sm leading-snug font-semibold text-ink">{movie.title}</span>
							<span class="stencil mt-0.5 block text-[0.7rem] text-ink-soft uppercase">
								{formatRuntime(movie.runtimeMin)}
							</span>
						</button>
					{/each}
				</div>
				<!-- The medallion struck over the gutter. Decorative: the heading above
				     already says what the screen is asking. -->
				<span
					class="pointer-events-none absolute top-[28%] left-1/2 -translate-x-1/2 -rotate-6"
					aria-hidden="true"
				>
					<span
						class="display flex size-11 items-center justify-center rounded-full border-2 border-brass bg-ink text-[0.95rem] text-brass shadow-[0_0_0_3px_var(--color-ink)]"
					>
						VS
					</span>
				</span>
			</div>

			<button name="winner" value="" class="token token-slot mt-4 w-full"> No preference </button>
		</form>

		<p class="text-center text-xs leading-relaxed text-chalk-dim">
			Haven't seen either? "No preference" is the honest answer and counts for neither side.
		</p>

		{#if cursor > 0}
			<button type="button" onclick={() => (cursor -= 1)} class="token token-sm token-slot mx-auto">
				<ArrowLeft size={13} /> Back one pair
			</button>
		{/if}
	{/if}
</div>
