<!--
	Pool tab: browsable pool, my own three-state vote badge, the swipe-stack entry,
	and the TMDB suggest sheet.

	Drawn as the deck box: every film is a card lying face up on the table, and
	because tapping one opens it, every card is raised and presses down. The
	suggest sheet is the opposite — a flat pad you write on, holding punched
	blanks and the results it finds.

	Aggregate counts never appear here — not before a reveal and not after, because
	standing votes outlive rounds.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '$lib/components/Poster.svelte';
	import VoteBadge from '$lib/components/VoteBadge.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import BrushCleaning from '$lib/icons/BrushCleaning.svelte';
	import ChevronRight from '$lib/icons/ChevronRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import X from '$lib/icons/X.svelte';
	import { movieMeta } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let sheetOpen = $state(false);
	let query = $state('');
	let results = $state<
		Array<{ tmdbId: number; title: string; year: number | null; posterPath: string | null }>
	>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);

	/**
	 * Debounced search straight to the JSON endpoint. Without JavaScript the
	 * `?/search` form action does the same job on submit.
	 */
	let timer: ReturnType<typeof setTimeout> | undefined;
	function onInput() {
		if (timer) clearTimeout(timer);
		const term = query.trim();
		if (term.length < 2) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			searching = true;
			searchError = null;
			try {
				const response = await fetch(`/g/${data.token}/movies/search`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ query: term })
				});
				const body = await response.json();
				if (body.ok) results = body.results;
				else {
					results = [];
					searchError = body.message ?? 'Search failed';
				}
			} catch {
				searchError = 'Search failed — are you online?';
			} finally {
				searching = false;
			}
		}, 300);
	}

	const shown = $derived(data.pool.movies);
	const serverResults = $derived(form && 'results' in form ? form.results : null);
	/** Live fetch results win; the no-JS action results are the fallback. */
	const suggestions = $derived(results.length > 0 ? results : (serverResults ?? []));
</script>

<div class="space-y-5">
	<div class="flex items-end justify-between gap-3">
		<div class="min-w-0">
			<p class="eyebrow text-brass">The deck</p>
			<h2 class="display mt-1 text-[1.75rem] text-board">The pool</h2>
			<p class="stencil mt-1.5 text-xs text-chalk-dim uppercase">
				{shown.length}
				{shown.length === 1 ? 'film on the table' : 'films on the table'}
			</p>
		</div>
		<button
			type="button"
			onclick={() => (sheetOpen = !sheetOpen)}
			aria-expanded={sheetOpen}
			class="token token-brass shrink-0"
		>
			{#if sheetOpen}<X size={15} /> Close{:else}+ Suggest{/if}
			<span class="sr-only"> a film</span>
		</button>
	</div>

	{#if form && 'added' in form && form.added}
		<p class="notice notice-jade" role="status">
			{#if form.added === 'restored'}
				Brought "{form.title}" back — everyone's old swipes are intact.
			{:else if form.added === 'rewatch'}
				"{form.title}" is back in the pool for a re-watch.
			{:else}
				Added "{form.title}" to the pool.
			{/if}
		</p>
	{/if}
	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}

	<!-- ── Suggest sheet ───────────────────────────────────────────────
	     A flat pad: you write on it, so nothing here is raised except the
	     controls themselves. -->
	{#if sheetOpen}
		<section class="pop-settle tile space-y-3 px-3 py-3" aria-label="Suggest a film">
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Add to the pool</h3>

			{#if !data.searchAvailable}
				<p class="notice notice-cherry">
					<TriangleAlert size={17} class="mt-px shrink-0" />
					Film search isn't set up on this server yet, so nothing can be added. Whoever runs it needs
					to add a TMDB key.
				</p>
			{/if}

			<form method="POST" action="?/search" use:enhance class="space-y-2">
				<label for="q" class="field-label text-ink">Search for a film</label>
				<div class="flex gap-2">
					<input
						id="q"
						name="query"
						bind:value={query}
						oninput={onInput}
						autocomplete="off"
						placeholder="Alien, Brazil, Casino…"
						class="field min-w-0 flex-1"
					/>
					<button class="token shrink-0">Search</button>
				</div>
			</form>

			{#if searching}
				<p class="stencil text-xs text-ink-soft uppercase">Searching…</p>
			{/if}
			{#if searchError}
				<p role="alert" class="notice notice-cherry">
					<TriangleAlert size={17} class="mt-px shrink-0" />
					{searchError}
				</p>
			{/if}

			{#if suggestions.length > 0}
				<!-- Results deal in as they arrive; keyed by TMDB id, so a film that
				     survives a query refinement stays put instead of re-dealing. -->
				<ul class="space-y-2.5 border-t-2 border-dashed border-board-shade pt-3">
					{#each suggestions as result, i (result.tmdbId)}
						<li class="deal-in" style="--deal:{i}">
							<form method="POST" action="?/suggest" use:enhance>
								<input type="hidden" name="tmdb_id" value={result.tmdbId} />
								<button class="tile tile-press flex w-full items-center gap-2.5 p-2 text-left">
									<span class="block h-16 w-11 shrink-0 overflow-hidden rounded-[3px] border-2 border-ink">
										<Poster path={result.posterPath} title={result.title} size="w92" />
									</span>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-semibold text-ink">{result.title}</span>
										<span class="stencil block text-[0.7rem] text-ink-soft uppercase"
											>{result.year ?? 'year unknown'}</span
										>
									</span>
									<span
										class="display flex size-7 shrink-0 items-center justify-center rounded-sm border-2 border-ink bg-brass text-base leading-none text-ink"
										aria-hidden="true">+</span
									>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<!--
				TMDB's credit, where TMDB's data actually is: every result on this pad
				came from their search, so the sheet is the compliance-relevant spot
				rather than the bottom of every screen in the app. Set in the sheet's
				own quiet ink-soft help type, ruled off from the results above it.
			-->
			<p class="border-t-2 border-dashed border-board-shade pt-2.5 text-[0.7rem] leading-relaxed text-ink-soft">
				Search results, film data and posters come from
				<a href="https://www.themoviedb.org/" rel="noreferrer" class="underline"
					>The Movie Database</a
				>. This product uses the TMDB API but is not endorsed or certified by TMDB.
			</p>
		</section>
	{/if}

	<!-- ── My swipe stack ────────────────────────────────────────────── -->
	{#if data.pool.unswipedCount > 0}
		<!-- deal-in doubles as the top-up moment: when new films land over SSE
		     this ticket settles in; a count that merely changes stays still. -->
		<a href="/g/{data.token}/swipe" class="deal-in token token-lg token-brass w-full justify-between">
			<span class="flex items-center gap-2.5">
				<span
					class="display flex h-7 min-w-7 items-center justify-center rounded-sm border-2 border-ink bg-board px-1 text-base leading-none"
					aria-hidden="true">{data.pool.unswipedCount}</span
				>
				{data.pool.unswipedCount === 1 ? 'card to swipe' : 'cards to swipe'}
			</span>
			<ArrowRight size={20} />
		</a>
	{/if}

	<!-- ── The pool ──────────────────────────────────────────────────── -->
	{#if shown.length === 0}
		<div class="tile-slot space-y-3 px-4 py-8 text-center">
			<BrushCleaning size={38} class="mx-auto text-brass" />
			<h3 class="display text-[1.5rem] text-board">Nothing on the table</h3>
			<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
				Suggest a film and everyone can start swiping it. The pool carries over between nights.
			</p>
		</div>
	{:else}
		<!-- The deck dealt onto the table, top row first. Keyed by movie id, so
		     the SSE invalidateAll refresh reuses these nodes: existing rows never
		     flicker or re-deal, and only a genuinely new suggestion animates. -->
		<ul class="space-y-2.5">
			{#each shown as movie, i (movie.id)}
				<li class="deal-in" style="--deal:{i}">
					<a
						href="/g/{data.token}/movies/{movie.id}"
						class="tile tile-press flex items-center gap-3 p-2"
					>
						<span class="block h-20 w-14 shrink-0 overflow-hidden rounded-[3px] border-2 border-ink">
							<Poster path={movie.posterPath} title={movie.title} size="w92" />
						</span>
						<span class="min-w-0 flex-1 space-y-1">
							<span class="flex items-baseline gap-1.5">
								<span class="min-w-0 truncate text-sm font-semibold text-ink">{movie.title}</span>
								{#if movie.status === 'watched'}
									<span
										class="stencil shrink-0 rounded border-2 border-ink bg-ink px-1 text-[0.6rem] tracking-[0.08em] text-board uppercase"
										>watched</span
									>
								{/if}
							</span>
							<span class="stencil block text-[0.7rem] text-ink-soft uppercase">
								{movieMeta(movie.year, movie.runtimeMin)}
								{#if movie.suggestedBy}· {movie.suggestedBy.displayName}{/if}
							</span>
							<!-- THE STAR, as a mark rather than a control: a film you starred
							     carries the brass STAR seal where an ordinary yes carries the jade
							     one. The pool is a list you read; starring happens where the film
							     is in front of you — the swipe gesture, or its own page. -->
							<VoteBadge vote={movie.myVote} starred={movie.myStarred} />
						</span>
						<ChevronRight size={17} class="shrink-0 text-ink-soft" />
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
