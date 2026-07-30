<!--
	Veto screen: "One screen, five rows, one optional tap. Skippable."

	The one screen in the app that is allowed to shout. The veto is the only
	unilateral power anyone has, so it arrives as the red card: a bright cherry
	plate across the top, and the film you strike gets the cherry plate too, with
	the VETOED seal slammed across it. Everything else on the screen stays kraft
	and quiet, which is what makes the one red row land.

	Radio buttons rather than tap-to-submit, because the choice is exclusive and
	the submit must be explicit: "done, vetoed nothing" is a recorded answer, not
	an absence. The radios are native and styled with `checked:` alone, so the
	marked row is still visibly marked with JavaScript off. Pre-filled from last
	round when that film is a finalist again, so the person who genuinely cannot
	watch horror spends one tap instead of five.
-->
<script lang="ts">
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import Ban from '$lib/icons/Ban.svelte';
	import Check from '$lib/icons/Check.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
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

	/** The punched token a radio becomes: light hole, thick ink ring when marked. */
	const radio =
		'size-5 shrink-0 appearance-none rounded-full border-2 border-ink bg-[#fbf4e4] checked:border-[6px] focus-visible:outline-3';
	/** Row: raised, because tapping anywhere on it marks the film. */
	const row =
		'tile tile-press flex cursor-pointer items-center gap-3 p-2 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-brass has-[input:focus-visible]:outline-offset-2';
</script>

<div class="space-y-5">
	<a
		href="/g/{data.token}"
		class="stencil inline-flex items-center gap-1.5 text-xs text-chalk-dim uppercase hover:text-brass"
	>
		<ArrowLeft size={14} /> Back to the round
	</a>

	<!-- The red card. -->
	<div class="relative rounded-md border-2 border-ink bg-cherry px-4 pt-3 pb-3.5 text-ink">
		<p class="eyebrow flex items-center gap-1.5">
			<Ban size={14} /> Your one veto
		</p>
		<h2 class="display mt-1.5 text-[1.6rem] leading-[1.02]">
			Anything you<br />can't sit through?
		</h2>
		<div class="mt-2.5 border-t-2 border-dashed border-ink/40"></div>
		<p class="mt-2.5 text-sm leading-relaxed">
			One film, struck out. Spend it on something you genuinely can't watch — not on one you merely
			like less. Skipping is completely normal.
		</p>
	</div>

	{#if me.vetoPrefillMovieId && !me.vetoSubmitted}
		<p class="notice notice-brass">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			Filled in with your veto from last time, since it's a finalist again.
		</p>
	{/if}

	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/submit" class="space-y-4">
		<input type="hidden" name="round_id" value={round.id} />

		<fieldset class="space-y-2.5">
			<legend class="eyebrow mb-2.5 text-chalk">Tonight's finalists</legend>

			{#each round.finalists ?? [] as movie (movie.id)}
				{@const struck = selected === movie.id}
				<label class="{row} {struck ? 'bg-cherry' : ''}">
					<input type="radio" name="movie_id" value={movie.id} bind:group={selected} class={radio} />
					<span class="block h-16 w-11 shrink-0 overflow-hidden rounded-[3px] border-2 border-ink">
						<Poster path={movie.posterPath} title={movie.title} size="w92" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-semibold text-ink">{movie.title}</span>
						<!-- Ink-soft is a kraft-only grey; on the cherry plate it drops under
						     AA, so a struck row prints its meta in full ink. -->
						<span
							class="stencil block text-[0.7rem] uppercase {struck ? 'text-ink' : 'text-ink-soft'}"
						>
							{movie.year ?? ''} · {formatRuntime(movie.runtimeMin)}
						</span>
					</span>
					{#if struck}
						<span class="shrink-0 pr-1">
							<Stamp word="Vetoed" tone="cherry" size="0.78rem" rotate={-7} />
						</span>
						<span class="sr-only">vetoed</span>
					{/if}
				</label>
			{/each}

			<!-- The no-veto answer. Deliberately the same kind of row, so choosing it
			     feels like an answer rather than a way out. -->
			<label class="{row} py-3 {selected === '' ? 'bg-jade' : ''}">
				<input type="radio" name="movie_id" value="" bind:group={selected} class={radio} />
				<span class="flex-1 text-sm font-semibold text-ink">I'm fine with all of them</span>
				{#if selected === ''}
					<Check size={17} class="shrink-0 text-ink" />
				{/if}
			</label>
		</fieldset>

		<button class="token token-lg w-full {selected === '' ? 'token-brass' : 'token-cherry'}">
			{selected === '' ? 'Submit — no veto' : 'Submit my veto'}
		</button>
		<p class="text-center text-xs leading-relaxed text-chalk-dim">
			A veto also sets your standing swipe on that film to "no". That only affects future nights,
			never this one.
		</p>
	</form>
</div>
