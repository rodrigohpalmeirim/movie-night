<!--
	Veto screen: "One screen, five rows, one optional tap. Skippable."

	The one screen in the app that is allowed to shout. The veto is the only
	unilateral power anyone has, so it arrives as the red card: a bright cherry
	plate across the top, and the film you strike gets the cherry plate too, with
	the VETOED seal slammed across it. Everything else on the screen stays kraft
	and quiet, which is what makes the one red row land.

	Radio buttons rather than tap-to-submit, because the choice is exclusive and
	the submit must be explicit: "done, vetoed nothing" is a recorded answer, not
	an absence. But there is no radio *dot* to look at: the rows are latched
	board tokens, so the row you picked is the one held pressed flush into the
	table, inked with its state's colour, while the rest keep their lift. The
	whole thing is driven by `:has(input:checked)` on the row, which means the
	browser does the latching from the native radio's own state — the marked row
	is marked with JavaScript off, and there is no second indicator to keep in
	sync. Pre-filled from last round when that film is a finalist again, so the
	person who genuinely cannot watch horror spends one tap instead of five.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import Ban from '$lib/icons/Ban.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatRuntime } from '$lib/images.js';
	import { createLatch } from '$lib/latch.svelte.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const round = $derived(data.round);
	const me = $derived(round.me);
	const prefilled = $derived(me.myVetoMovieId ?? me.vetoPrefillMovieId ?? '');
	/**
	 * The rows latch off their own radio in CSS, so `bind:group` IS the latch
	 * here — anything that writes to it mid-flight pops the marked row back up.
	 * Which is what the pre-fill sync would do: submitting invalidates `load`
	 * (and so does anyone else's action arriving over SSE), and a new server
	 * pre-fill would then overwrite the member's own choice while their POST is
	 * still travelling. So the sync only runs when nothing is in flight — the
	 * latch stays where the finger left it and the reconcile happens after.
	 */
	let selected = $state('');
	const submission = createLatch<string>((body) => String(body.get('movie_id') ?? ''));
	$effect(() => {
		if (submission.isPending()) return;
		selected = prefilled;
	});

	/**
	 * The radio still exists, still owns the exclusivity and still takes focus —
	 * it just has nothing to draw, because the latched row is the mark. The row
	 * carries the focus ring on its behalf.
	 */
	const radio = 'sr-only';
	/**
	 * Row: raised, because tapping anywhere on it marks the film, and latched
	 * once its radio is checked. `group` so the pieces inside can read the same
	 * checked state.
	 */
	const row =
		'group tile tile-press tile-latch flex cursor-pointer items-center gap-3 p-2 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-brass has-[input:focus-visible]:outline-offset-2';
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

	<form method="POST" action="?/submit" use:enhance={submission.submit} class="space-y-4">
		<input type="hidden" name="round_id" value={round.id} />

		<fieldset class="space-y-2.5">
			<legend class="eyebrow mb-2.5 text-chalk">Tonight's finalists</legend>

			<!-- Finalists deal in top to bottom. Keyed by movie id, so marking a
			     row (or an SSE refresh) reuses the nodes and never re-deals. -->
			{#each round.finalists ?? [] as movie, i (movie.id)}
				<label class="deal-in {row} tile-latch-cherry" style="--deal:{i}">
					<input type="radio" name="movie_id" value={movie.id} bind:group={selected} class={radio} />
					<span class="block h-16 w-11 shrink-0 overflow-hidden rounded-[3px] border-2 border-ink">
						<Poster path={movie.posterPath} title={movie.title} size="w92" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-semibold text-ink">{movie.title}</span>
						<!-- Ink-soft is a kraft-only grey; on the cherry plate it drops under
						     AA, so a struck row prints its meta in full ink. -->
						<span
							class="stencil block text-[0.7rem] text-ink-soft uppercase group-has-[input:checked]:text-ink"
						>
							{movie.year ?? ''} · {formatRuntime(movie.runtimeMin)}
						</span>
					</span>
					<!-- The seal is shown by the same checked state that latches the row, so
					     it lands with JavaScript off too. -->
					<span class="hidden shrink-0 pr-1 group-has-[input:checked]:block">
						<Stamp word="Vetoed" tone="cherry" size="0.78rem" rotate={-7} />
						<span class="sr-only">vetoed</span>
					</span>
				</label>
			{/each}

			<!-- The no-veto answer. Deliberately the same kind of row, so choosing it
			     feels like an answer rather than a way out — and it latches the same
			     way, in jade instead of cherry. -->
			<label class="{row} tile-latch-jade py-3">
				<input type="radio" name="movie_id" value="" bind:group={selected} class={radio} />
				<span class="flex-1 text-sm font-semibold text-ink">I'm fine with all of them</span>
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
