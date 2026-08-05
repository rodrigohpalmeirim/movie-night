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
	import Play from '$lib/icons/Play.svelte';
	import Star from '$lib/icons/Star.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import X from '$lib/icons/X.svelte';
	import { formatDate, movieMeta, trailerUrl } from '$lib/images.js';
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

	/**
	 * The star is its own control group: it posts no `value` at all — a star is an
	 * upgraded yes, so the server keeps the answer that is already there — and the
	 * answer pair's latch reads `value`, which would draw a "no" for a form that
	 * never mentioned one.
	 */
	const starLatch = createLatch<boolean>((body) => body.get('starred') === 'true');
	const starred = $derived(
		starLatch.value(form && 'myStarred' in form ? form.myStarred === true : data.myStarred)
	);

	/**
	 * Every extra is optional — TMDB has all of it for a blockbuster and none of
	 * it for a 1970s obscurity, and a film whose details have not been fetched
	 * yet has none of it either. Each section is therefore its own `{#if}`: an
	 * absent fact prints nothing at all rather than an empty heading.
	 */
	const details = $derived(data.movie.details);
	const trailer = $derived(trailerUrl(details?.trailerKey));
	const hasNotes = $derived(
		!!details && (!!details.overview || details.directors.length > 0 || details.cast.length > 0)
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
					<!-- Your standing answer, stamped where you would stamp a card. A starred
					     yes prints the brass STAR seal instead of the jade YES — same mark,
					     same corner, said louder — so the seal always states what your vote
					     currently IS, and the token below states what you can do about it. -->
					<div class="pointer-events-none absolute -right-2.5 -bottom-3">
						<Stamp
							word={vote === 'yes' ? (starred ? 'Star' : 'Yes') : 'Nope'}
							tone={vote === 'yes' ? (starred ? 'brass' : 'jade') : 'cherry'}
							size="1rem"
							rotate={-9}
						/>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<h2 class="display text-[1.4rem] leading-[1.06] text-ink">{data.movie.title}</h2>
				{#if details?.tagline}
					<!-- The line the poster itself would carry, set in the box-lid slab. -->
					<p class="display mt-1.5 text-[0.8rem] leading-[1.25] text-ink-soft">{details.tagline}</p>
				{/if}
				<p class="stencil mt-1.5 text-[0.72rem] text-ink-soft uppercase">
					{movieMeta(data.movie.year, data.movie.runtimeMin)}
				</p>
				{#if details && (details.genres.length > 0 || details.certification)}
					<!-- Printed on the component: the rating in its own boxed plate, the
					     genres as punched chips. -->
					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						{#if details.certification}
							<span
								class="stencil rounded-[3px] border-2 border-ink px-1.5 pt-0.5 pb-px text-[0.66rem] leading-none font-semibold text-ink uppercase"
							>
								<span class="sr-only">Rated </span>{details.certification}
							</span>
						{/if}
						{#each details.genres as genre (genre)}
							<span
								class="stencil rounded-full border border-ink/35 bg-board-shade/45 px-2 pt-0.5 pb-px text-[0.66rem] leading-none text-ink-soft uppercase"
							>
								{genre}
							</span>
						{/each}
					</div>
				{/if}
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

	{#if trailer}
		<!-- A link off the table, not a screen embedded in it: the app talks to
		     exactly one third-party origin (image.tmdb.org), so the trailer opens
		     in YouTube's own tab and no player is loaded here. -->
		<a href={trailer} target="_blank" rel="noopener" class="token token-lg token-brass w-full">
			<Play size={16} />
			Watch trailer<span class="sr-only"> for {data.movie.title} on YouTube (opens a new tab)</span>
		</a>
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

		{#if vote === 'yes'}
			<!--
				The star, and only on a yes: it is not a third answer, it is the loudest
				version of this one, so it appears under the pair rather than beside it and
				it goes away with the answer it belongs to. Latched like the answer pair —
				held down and inked when it is on — so it reads as the state of your vote,
				which is the same thing the brass seal on the artwork above is saying. This
				is the only screen with the room to say the word and what it buys; the pool
				only prints the seal.
			-->
			<form method="POST" action="?/vote" use:enhance={starLatch.submit} class="pop-settle">
				<button
					name="starred"
					value={starred ? 'false' : 'true'}
					aria-pressed={starred}
					class="token w-full {starred ? 'token-brass token-latched' : ''}"
				>
					<Star size={16} class={starred ? 'fill-current' : ''} />
					{starred ? 'Starred' : 'Star it'}
				</button>
			</form>
			<p class="text-xs leading-relaxed text-chalk-dim">
				Stars are used as tiebreakers. You can star as many films as you like.
			</p>
		{/if}
	</section>

	{#if hasNotes && details}
		<!-- The notes printed on the back of the card: what it is about, and whose
		     names are on it. Text only — no headshots; this is a printed component,
		     not a database record. -->
		<section class="tile space-y-3 p-3.5">
			{#if details.overview}
				<div>
					<h3 class="eyebrow text-ink-soft">The story</h3>
					<p class="mt-1 text-sm leading-relaxed text-ink">{details.overview}</p>
				</div>
			{/if}
			{#if details.directors.length > 0}
				<div class="border-t-2 border-dashed border-board-shade pt-2.5">
					<h3 class="eyebrow text-ink-soft">Directed by</h3>
					<p class="mt-1 text-sm leading-snug text-ink">{details.directors.join(' & ')}</p>
				</div>
			{/if}
			{#if details.cast.length > 0}
				<div class="border-t-2 border-dashed border-board-shade pt-2.5">
					<h3 class="eyebrow text-ink-soft">Starring</h3>
					<ul class="mt-1 space-y-0.5 text-sm leading-snug text-ink">
						{#each details.cast as person (person.name + person.character)}
							<li>
								<!-- The separator is written OUT, as an expression: a space that is
								     only ever leading whitespace inside the span is collapsed away
								     by the compiler, which is what ran "Ryan Gosling" straight into
								     "as K". `{' '}` is a text node, so it survives. -->
								{person.name}{#if person.character}{' '}<span class="text-ink-soft"
										>as {person.character}</span
									>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>
	{/if}

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
