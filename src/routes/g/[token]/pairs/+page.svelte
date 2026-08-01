<!--
	Pairwise screen: "Two posters per screen, tap one or 'no preference'; progress
	indicator."

	A face-off: two cards dealt side by side with an ink VS medallion struck over
	the gutter between them. Both cards are raised, because both are the control —
	picking one is a press, and the whole card is the target. "No preference" is an
	empty slot underneath, so refusing to choose still looks like a move on the
	board rather than a missing button.

	The deck is the member's whole ballot, not just the unanswered part: stepping
	back and forth is allowed, and a pair you have already answered shows that
	answer marked with the jade seal so changing it is one tap. Re-casting is an
	upsert on (round, member, unordered pair), so an edit replaces the row and can
	never double-count.

	The order is the server's per-member shuffle, and progress is per-voter only —
	no aggregate ever appears here, which is why there is nothing to hide: the
	payload simply does not contain one.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import Check from '$lib/icons/Check.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatRuntime } from '$lib/images.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const round = $derived(data.round);
	const me = $derived(round.me);
	const finalists = $derived(new Map((round.finalists ?? []).map((movie) => [movie.id, movie])));

	/** Pairs are unordered and the server normalises to a < b, so this is stable. */
	const pairKey = (a: string, b: string) => `${a}|${b}`;

	/**
	 * Answers cast on this device that the server round trip hasn't handed back
	 * yet. The SSE ping refreshes `data` a moment later and agrees with these, so
	 * they only cover the gap — without them, stepping straight back to the pair
	 * you just answered would show it unmarked.
	 */
	let justCast = $state<Record<string, string | null>>({});
	/** `has` = answered; the value may legitimately be `null` = no preference. */
	const answers = $derived(
		new Map<string, string | null>([
			...me.myPairVotes.map((vote) => [pairKey(vote.a, vote.b), vote.winnerId] as const),
			...Object.entries(justCast)
		])
	);

	/**
	 * Where in my own shuffled order I am. `null` means "follow the server", i.e.
	 * open on the first pair I haven't answered; any tap takes local control.
	 *
	 * Deliberately NOT an `$effect` recomputed from the data: that is what broke
	 * reviewing. Every pair vote pings the group, the ping calls `invalidateAll`,
	 * and an effect would then drag the cursor back to "first unanswered" — past
	 * the end for anyone who has finished — bouncing a member out of the deck and
	 * onto "your picks are in" mid-review.
	 */
	let cursor = $state<number | null>(null);
	const firstUnanswered = $derived.by(() => {
		const i = me.pairOrder.findIndex((pair) => !answers.has(pairKey(pair.a, pair.b)));
		return i === -1 ? me.pairOrder.length : i;
	});
	/**
	 * The same position, in the URL, for the no-JS path: `?review` opens the deck
	 * at pair one and `?i=N` opens it at pair N+1. Every step is also a real link
	 * (and the pick form posts to `?/pick&i=<next>`), so the whole walk works with
	 * scripting off; with JS the local cursor wins and nothing round-trips.
	 */
	const urlIndex = $derived.by(() => {
		const raw = page.url.searchParams.get('i');
		if (raw !== null && /^\d+$/.test(raw)) {
			return Math.min(Number(raw), me.pairOrder.length);
		}
		return page.url.searchParams.has('review') ? 0 : null;
	});
	const index = $derived(cursor ?? urlIndex ?? firstUnanswered);
	/** Step there now; the `href` is the fallback when JS is off. */
	const step = (to: number) => (event: MouseEvent) => {
		event.preventDefault();
		cursor = Math.min(Math.max(to, 0), me.pairOrder.length);
	};

	const pair = $derived(me.pairOrder[index] ?? null);
	const left = $derived(pair ? finalists.get(pair.a) : undefined);
	const right = $derived(pair ? finalists.get(pair.b) : undefined);
	const answer = $derived(pair ? answers.get(pairKey(pair.a, pair.b)) : undefined);
	const answered = $derived(pair ? answers.has(pairKey(pair.a, pair.b)) : false);
	const doneCount = $derived(me.pairOrder.filter((p) => answers.has(pairKey(p.a, p.b))).length);
	const isLast = $derived(index >= me.pairOrder.length - 1);

	/** Record it locally and step on; roll both back if the server refuses. */
	const cast: SubmitFunction = ({ formData }) => {
		const key = pairKey(String(formData.get('a')), String(formData.get('b')));
		const winner = formData.get('winner');
		const from = index;
		const previous = key in justCast ? justCast[key] : undefined;
		justCast[key] = winner === null || winner === '' ? null : String(winner);
		cursor = from + 1;

		return async ({ result, update }) => {
			if (result.type !== 'success') {
				if (previous === undefined) delete justCast[key];
				else justCast[key] = previous;
				cursor = from;
			}
			await update({ reset: false, invalidateAll: false });
		};
	};
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
				Pair {Math.min(index + 1, me.pairsTotal)}
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
					<!-- One entry point: reviewing and changing are the same walk through
					     the deck, so there is one button for both. -->
					<a href="?review" onclick={step(0)} class="token token-slot w-full"> Review my picks </a>
					<p class="text-xs leading-relaxed text-chalk-dim">
						Your answers are marked as you step through — tap a different film to change one.
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<h2 class="display text-center text-[1.45rem] text-board">
			{answered ? 'Happy with this one?' : 'Which one, tonight?'}
		</h2>

		<!-- `&i=` is the no-JS cursor: a plain post lands on the next pair instead of
		     jumping back to the first unanswered one. -->
		<form method="POST" action="?/pick&i={index + 1}" use:enhance={cast}>
			<input type="hidden" name="round_id" value={round.id} />
			<input type="hidden" name="a" value={pair.a} />
			<input type="hidden" name="b" value={pair.b} />

			<div class="relative">
				<div class="grid grid-cols-2 gap-4">
					<!-- Each new pair is dealt: keyed by movie id, so advancing the
					     cursor deals two fresh cards (left a beat before right), while
					     an SSE refresh that lands on the same pair reuses the nodes. -->
					{#each [left, right] as movie, i (movie.id)}
						{@const chosen = answer === movie.id}
						<button
							name="winner"
							value={movie.id}
							aria-pressed={chosen}
							class="deal-in tile tile-press relative p-2 text-left {chosen
								? 'outline-3 outline-offset-2 outline-jade-deep'
								: ''}"
							style="--deal:{i}"
						>
							<span class="block aspect-[2/3] overflow-hidden rounded-[3px] border-2 border-ink">
								<Poster path={movie.posterPath} title={movie.title} size="w342" eager />
							</span>
							<span class="mt-2 block text-sm leading-snug font-semibold text-ink">{movie.title}</span>
							<span class="stencil mt-0.5 block text-[0.7rem] text-ink-soft uppercase">
								{formatRuntime(movie.runtimeMin)}
							</span>
							{#if chosen}
								<!-- The seal says what the text below already says. -->
								<span class="pointer-events-none absolute -top-2.5 -right-2">
									<Stamp word="Your pick" tone="jade" size="0.62rem" rotate={-8} />
								</span>
								<span class="sr-only">your current pick</span>
							{/if}
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

			<button
				name="winner"
				value=""
				aria-pressed={answered && answer === null}
				class="token mt-4 w-full {answered && answer === null ? 'token-jade' : 'token-slot'}"
			>
				{#if answered && answer === null}<Check size={16} />{/if}
				No preference
			</button>
		</form>

		<p class="text-center text-xs leading-relaxed text-chalk-dim">
			{#if answered}
				Your answer is marked. Tap a film to change it — the new answer replaces the old one.
			{:else}
				Haven't seen either? "No preference" is the honest answer and counts for neither side.
			{/if}
		</p>

		<!-- Stepping through without answering again: allowed both ways, so a
		     member can walk their whole ballot and only change what they meant to. -->
		<div class="flex justify-center gap-2.5">
			{#if index > 0}
				<a href="?i={index - 1}" onclick={step(index - 1)} class="token token-sm token-slot">
					<ArrowLeft size={13} /> Previous
				</a>
			{/if}
			{#if answered}
				<a href="?i={index + 1}" onclick={step(index + 1)} class="token token-sm token-slot">
					{isLast ? 'Done' : 'Keep it'}
					<ArrowRight size={13} />
				</a>
			{/if}
		</div>
	{/if}
</div>
