<!--
	Veto screen: "One screen, five rows, one optional tap. Skippable."

	Radio buttons rather than tap-to-submit, because the choice is exclusive and
	the submit must be explicit: "done, vetoed nothing" is a recorded answer, not
	an absence. Pre-filled from last round when that film is a finalist again, so
	the person who genuinely cannot watch horror spends one tap instead of five.
-->
<script lang="ts">
	import Poster from '$lib/components/Poster.svelte';
	import { formatRuntime } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const round = $derived(data.round);
	const me = $derived(round.me);
	const prefilled = $derived(me.myVetoMovieId ?? me.vetoPrefillMovieId ?? '');
	let selected = $state('');
	// Initialise once from the server's pre-fill, then let the member drive.
	$effect(() => {
		selected = prefilled;
	});
</script>

<div class="space-y-5">
	<div class="space-y-1">
		<h2 class="text-xl font-bold tracking-tight">Anything you can't sit through?</h2>
		<p class="text-sm text-neutral-600 dark:text-neutral-300">
			You get one veto. Use it on a film you genuinely can't watch — not on one you merely like
			less. Skipping is completely normal.
		</p>
		{#if me.vetoPrefillMovieId && !me.vetoSubmitted}
			<p class="text-xs text-indigo-600 dark:text-indigo-400">
				Pre-filled with your veto from last time, since it's a finalist again.
			</p>
		{/if}
	</div>

	{#if form?.message}
		<p role="alert" class="text-sm font-medium text-rose-600 dark:text-rose-400">{form.message}</p>
	{/if}

	<form method="POST" action="?/submit" class="space-y-4">
		<input type="hidden" name="round_id" value={round.id} />

		<fieldset class="space-y-2">
			<legend class="sr-only">Choose at most one film to veto</legend>

			{#each round.finalists ?? [] as movie (movie.id)}
				<label
					class="flex cursor-pointer items-center gap-3 rounded-xl border p-2 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-500 {selected ===
					movie.id
						? 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
						: 'border-neutral-200 dark:border-neutral-800'}"
				>
					<input
						type="radio"
						name="movie_id"
						value={movie.id}
						bind:group={selected}
						class="size-5 shrink-0 accent-rose-600"
					/>
					<div class="h-16 w-11 shrink-0 overflow-hidden rounded">
						<Poster path={movie.posterPath} title={movie.title} size="w92" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold">{movie.title}</p>
						<p class="text-xs text-neutral-500 dark:text-neutral-400">
							{movie.year ?? ''} · {formatRuntime(movie.runtimeMin)}
						</p>
					</div>
					{#if selected === movie.id}
						<span class="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-400">VETO</span>
					{/if}
				</label>
			{/each}

			<label
				class="flex cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-500 {selected ===
				''
					? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
					: 'border-neutral-200 dark:border-neutral-800'}"
			>
				<input
					type="radio"
					name="movie_id"
					value=""
					bind:group={selected}
					class="size-5 shrink-0 accent-indigo-600"
				/>
				<span class="text-sm font-semibold">I'm fine with all of them</span>
			</label>
		</fieldset>

		<button
			class="w-full rounded-xl bg-indigo-600 px-4 py-4 text-base font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
		>
			{selected === '' ? 'Submit — no veto' : 'Submit veto'}
		</button>
		<p class="text-center text-xs text-neutral-500 dark:text-neutral-400">
			A veto also sets your standing swipe on that film to "no". It only affects future nights,
			never this one.
		</p>
	</form>
</div>
