<!--
	Movie detail: revise the standing vote at any time, or remove the film.
	The only vote shown is the viewer's own.

	The card pulled out of the deck and turned over: a flat stub, artwork inset in
	its own ink frame, and your standing answer stamped across the corner in the
	same seal the swipe screen prints. The two answer tokens are the same pair of
	tokens as the swipe screen, in the same order, because it is the same act.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Confirm from '$lib/components/Confirm.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import VoteBadge from '$lib/components/VoteBadge.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import Check from '$lib/icons/Check.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import X from '$lib/icons/X.svelte';
	import { formatDate, movieMeta } from '$lib/images.js';
	import { createLatch } from '$lib/latch.svelte.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	/** The answer pair is one control group: pressing one raises the other now. */
	const answer = createLatch<'yes' | 'no' | null>((body) =>
		body.get('value') === 'yes' ? 'yes' : 'no'
	);
	const vote = $derived(
		answer.value(form && 'myVote' in form && form.myVote ? form.myVote : data.myVote)
	);
</script>

<div class="space-y-5">
	<a
		href="/g/{data.token}/pool"
		class="stencil inline-flex items-center gap-1.5 text-xs text-chalk-dim uppercase hover:text-brass"
	>
		<ArrowLeft size={14} /> Back to the pool
	</a>

	<!-- The card, face up. Flat: it is a record, not a control. -->
	<div class="tile p-2.5">
		<div class="flex gap-3">
			<div class="relative w-28 shrink-0">
				<div class="aspect-[2/3] overflow-hidden rounded-[3px] border-2 border-ink">
					<Poster path={data.movie.posterPath} title={data.movie.title} size="w342" eager />
				</div>
				{#if vote}
					<!-- Your standing answer, stamped where you would stamp a card. -->
					<div class="pointer-events-none absolute -right-2.5 -bottom-3">
						<Stamp
							word={vote === 'yes' ? 'Yes' : 'Nope'}
							tone={vote === 'yes' ? 'jade' : 'cherry'}
							size="1rem"
							rotate={-9}
						/>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="display text-[1.4rem] leading-[1.06] text-ink">{data.movie.title}</h2>
				<p class="stencil mt-1.5 text-[0.72rem] text-ink-soft uppercase">
					{movieMeta(data.movie.year, data.movie.runtimeMin)}
				</p>
				{#if data.movie.suggestedBy}
					<p class="stencil text-[0.72rem] text-ink-soft uppercase">
						Suggested by {data.movie.suggestedBy}
					</p>
				{/if}
				{#if data.movie.status === 'watched'}
					<p class="mt-2 flex items-start gap-1.5 text-xs leading-snug font-medium text-jade-deep">
						<Check size={14} class="mt-px shrink-0" />
						Watched {formatDate(data.movie.watchedAt)}
					</p>
				{:else if data.movie.status === 'removed'}
					<p class="mt-2 text-xs leading-snug text-ink-soft">
						Out of the pool. Suggesting it again brings it back with every swipe intact.
					</p>
				{/if}
				<!-- Answered films carry the seal on the artwork, so the badge only has
				     a job when there is no answer to stamp. -->
				{#if !vote}
					<p class="mt-2.5"><VoteBadge vote={null} /></p>
				{/if}
			</div>
		</div>
	</div>

	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}

	<section class="space-y-2.5">
		<div>
			<h3 class="eyebrow text-chalk">Would you watch this?</h3>
			<p class="mt-1 text-xs leading-relaxed text-chalk-dim">
				A standing answer, not a vote for tonight. Change it whenever you like.
			</p>
		</div>
		<!-- A standing answer is a state, not a move, so these latch: your current
		     answer is held down and inked, the other stays raised and pressable.
		     Same pair, same order and same inks as the swipe screen — but there the
		     buttons fire a one-off vote on the card in front of you, so there they
		     spring back. The latch is optimistic, so a slow answer from the server
		     never lets the press up and back down again. -->
		<form method="POST" action="?/vote" use:enhance={answer.submit} class="flex gap-3">
			<button
				name="value"
				value="no"
				aria-pressed={vote === 'no'}
				class="token token-lg flex-1 {vote === 'no' ? 'token-cherry token-latched' : ''}"
			>
				<X size={17} />
				No
			</button>
			<button
				name="value"
				value="yes"
				aria-pressed={vote === 'yes'}
				class="token token-lg flex-1 {vote === 'yes' ? 'token-jade token-latched' : ''}"
			>
				<Check size={17} />
				Yes
			</button>
		</form>
	</section>

	{#if data.movie.status === 'pool'}
		<form method="POST" action="?/remove" use:enhance>
			<Confirm
				label="Remove from the pool"
				confirmLabel="Remove it"
				question="Duplicate, joke, or already seen? Everyone's swipes are kept, so re-suggesting restores it."
				variant="quiet"
			size="md"
			/>
		</form>
	{/if}
</div>
