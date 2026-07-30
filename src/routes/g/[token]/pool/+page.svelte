<!--
	Pool tab: browsable pool, my own three-state vote badge, the swipe-stack entry,
	and the TMDB suggest sheet.

	Aggregate counts never appear here — not before a reveal and not after, because
	standing votes outlive rounds.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '$lib/components/Poster.svelte';
	import VoteBadge from '$lib/components/VoteBadge.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
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
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-xl font-bold tracking-tight">The pool</h2>
		<button
			type="button"
			onclick={() => (sheetOpen = !sheetOpen)}
			aria-expanded={sheetOpen}
			class="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
		>
			+ Suggest a film
		</button>
	</div>

	{#if form && 'added' in form && form.added}
		<p
			class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
			role="status"
		>
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
		<p role="alert" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
			{form.message}
		</p>
	{/if}

	<!-- ── Suggest sheet ─────────────────────────────────────────────── -->
	{#if sheetOpen}
		<section
			class="space-y-3 rounded-xl border border-indigo-300 p-3 dark:border-indigo-800"
			aria-label="Suggest a film"
		>
			{#if !data.searchAvailable}
				<p class="text-sm text-amber-800 dark:text-amber-300">
					Film search isn't configured on this server yet (no TMDB key), so suggestions are
					unavailable.
				</p>
			{/if}
			<form method="POST" action="?/search" use:enhance class="space-y-2">
				<label for="q" class="block text-sm font-medium">Search TMDB</label>
				<div class="flex gap-2">
					<input
						id="q"
						name="query"
						bind:value={query}
						oninput={onInput}
						autocomplete="off"
						placeholder="Alien, Brazil, Casino…"
						class="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
					/>
					<button
						class="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700"
						>Search</button
					>
				</div>
			</form>

			{#if searching}
				<p class="text-sm text-neutral-500 dark:text-neutral-400">Searching…</p>
			{/if}
			{#if searchError}
				<p role="alert" class="text-sm text-rose-600 dark:text-rose-400">{searchError}</p>
			{/if}

			{#if suggestions.length > 0}
				<ul class="space-y-2">
					{#each suggestions as result (result.tmdbId)}
						<li>
							<form method="POST" action="?/suggest" use:enhance>
								<input type="hidden" name="tmdb_id" value={result.tmdbId} />
								<button
									class="flex w-full items-center gap-3 rounded-xl border border-neutral-200 p-2 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-neutral-800"
								>
									<div class="h-16 w-11 shrink-0 overflow-hidden rounded">
										<Poster path={result.posterPath} title={result.title} size="w92" />
									</div>
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-semibold">{result.title}</span>
										<span class="block text-xs text-neutral-500 dark:text-neutral-400"
											>{result.year ?? 'year unknown'}</span
										>
									</span>
									<span aria-hidden="true" class="shrink-0 text-lg text-indigo-600">+</span>
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<!-- ── My swipe stack ────────────────────────────────────────────── -->
	{#if data.pool.unswipedCount > 0}
		<a
			href="/g/{data.token}/swipe"
			class="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
		>
			<span>{data.pool.unswipedCount} to swipe</span>
			<ArrowRight size={18} />
		</a>
	{/if}

	<!-- ── The pool ──────────────────────────────────────────────────── -->
	{#if shown.length === 0}
		<p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
			The pool is empty. Suggest something.
		</p>
	{:else}
		<ul class="space-y-2">
			{#each shown as movie (movie.id)}
				<li>
					<a
						href="/g/{data.token}/movies/{movie.id}"
						class="flex items-center gap-3 rounded-xl border border-neutral-200 p-2 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-800 dark:hover:bg-neutral-800"
					>
						<div class="h-20 w-14 shrink-0 overflow-hidden rounded">
							<Poster path={movie.posterPath} title={movie.title} size="w92" />
						</div>
						<div class="min-w-0 flex-1 space-y-1">
							<p class="truncate text-sm font-semibold">
								{movie.title}
								{#if movie.status === 'watched'}
									<span
										class="ml-1 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase dark:bg-neutral-700"
										>watched</span
									>
								{/if}
							</p>
							<p class="text-xs text-neutral-500 dark:text-neutral-400">
								{movieMeta(movie.year, movie.runtimeMin)}
								{#if movie.suggestedBy}· {movie.suggestedBy.displayName}{/if}
							</p>
							<VoteBadge vote={movie.myVote} />
						</div>
						<span aria-hidden="true" class="shrink-0 text-neutral-400">›</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
