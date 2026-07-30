<!--
	Round screen (home tab) — state-dependent, per app-spec's phase-by-phase
	behaviour. Every transition is a single labelled button with a confirm step,
	because transitions are one-way.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import AttendeeStrip from '$lib/components/AttendeeStrip.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import RevealTally from '$lib/components/RevealTally.svelte';
	import { formatDate, movieMeta } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const token = $derived(data.token);
	const round = $derived(data.round);
	const me = $derived(round?.me);
	const revealed = $derived(round?.reveal ?? null);

	const waitingCount = $derived(data.unsubmittedAttendeeIds.length);
	const myRunoffStep = $derived(
		!me ? null : !me.vetoSubmitted ? 'veto' : me.pairsDone < me.pairsTotal ? 'pairs' : 'done'
	);
</script>

{#if form?.message}
	<p
		role="alert"
		class="mb-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
	>
		{form.message}
	</p>
{/if}

{#if !round || round.state === 'abandoned'}
	<!-- ── No active round ─────────────────────────────────────────── -->
	<div class="space-y-6 py-6 text-center">
		<div class="space-y-2">
			<p class="text-5xl" aria-hidden="true">🍿</p>
			<h2 class="text-xl font-bold tracking-tight">
				{round?.state === 'abandoned' ? 'That night got cancelled' : 'No movie night yet'}
			</h2>
			<p class="text-sm text-neutral-600 dark:text-neutral-300">
				Start one when you know you're watching something. Suggestions and swipes carry over —
				nothing is lost between nights.
			</p>
		</div>
		<form method="POST" action="?/createRound" use:enhance>
			<button
				class="w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
			>
				Start a movie night
			</button>
		</form>
	</div>
{:else if round.state === 'open'}
	<!-- ── OPEN: RSVP, suggest, swipe ───────────────────────────────── -->
	<div class="space-y-6">
		<div class="flex items-start justify-between gap-2">
			<div>
				<h2 class="text-xl font-bold tracking-tight">Tonight's the night</h2>
				<p class="text-sm text-neutral-500 dark:text-neutral-400">
					Started {formatDate(round.createdAt)} by {round.createdBy?.displayName ?? 'someone'}
				</p>
			</div>
			<Menu label="Round options">
				<form method="POST" action="?/abandon" use:enhance>
					<input type="hidden" name="round_id" value={round.id} />
					<Confirm
						label="Abandon this round"
						confirmLabel="Yes, cancel the night"
						question="This discards tonight's vetoes and pair votes. Standing swipes are kept."
						variant="danger"
					/>
				</form>
			</Menu>
		</div>

		<!-- My own RSVP, front and centre; default is out. -->
		<section class="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
			<h3 class="text-sm font-semibold">Are you in?</h3>
			<form method="POST" action="?/rsvp" use:enhance class="flex gap-2">
				<input type="hidden" name="round_id" value={round.id} />
				<input type="hidden" name="member_id" value={me?.memberId} />
				<button
					name="attending"
					value="true"
					aria-pressed={me?.attending === true}
					class="flex-1 rounded-xl px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 {me?.attending ===
					true
						? 'bg-emerald-600 text-white'
						: 'border border-neutral-300 dark:border-neutral-700'}"
				>
					I'm in
				</button>
				<button
					name="attending"
					value="false"
					aria-pressed={me?.attending === false}
					class="flex-1 rounded-xl px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 {me?.attending ===
					false
						? 'bg-neutral-600 text-white'
						: 'border border-neutral-300 dark:border-neutral-700'}"
				>
					Can't make it
				</button>
			</form>
			{#if me?.attending === null}
				<p class="text-xs text-neutral-500 dark:text-neutral-400">
					Nobody is counted as attending until they say so — your swipes only shape the night if
					you're in.
				</p>
			{/if}
		</section>

		{#if me && me.unswipedMovieIds.length > 0}
			<a
				href="/g/{token}/swipe"
				class="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
			>
				<span>{me.unswipedMovieIds.length} to swipe</span>
				<span aria-hidden="true">→</span>
			</a>
		{/if}

		<AttendeeStrip
			participants={round.participants}
			participation={round.participation}
			meId={me?.memberId ?? ''}
			roundId={round.id}
			editable
		/>

		<section class="space-y-2">
			<p class="text-sm text-neutral-600 dark:text-neutral-300">
				{#if round.readiness.attendeesWithGaps > 0}
					{round.readiness.attendeesWithGaps} of {round.readiness.attendeeCount} attendees still have
					unswiped films. You can close anyway — films nobody has seen simply wait for next time.
				{:else if round.readiness.attendeeCount > 0}
					Everyone attending has swiped the whole pool.
				{/if}
			</p>
			<form method="POST" action="?/advance" use:enhance>
				<input type="hidden" name="round_id" value={round.id} />
				{#if round.transitions.canAdvance}
					<Confirm
						label="Close swiping & pick finalists"
						confirmLabel="Pick the finalists"
						question="This freezes tonight's finalists and the swipes behind them. There's no going back."
					/>
				{:else}
					<p
						class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
					>
						{round.transitions.advanceBlockedReason}
					</p>
				{/if}
			</form>
		</section>
	</div>
{:else if round.state === 'runoff'}
	<!-- ── RUNOFF: veto, then pairs ─────────────────────────────────── -->
	<div class="space-y-6">
		<div class="flex items-start justify-between gap-2">
			<div>
				<h2 class="text-xl font-bold tracking-tight">The finalists are in</h2>
				<p class="text-sm text-neutral-500 dark:text-neutral-400">
					{round.finalists?.length ?? 0} films. Results stay hidden until someone reveals them.
				</p>
			</div>
			<Menu label="Round options">
				<form method="POST" action="?/abandon" use:enhance>
					<input type="hidden" name="round_id" value={round.id} />
					<Confirm
						label="Abandon this round"
						confirmLabel="Yes, cancel the night"
						question="This discards tonight's vetoes and pair votes. Standing swipes are kept."
						variant="danger"
					/>
				</form>
			</Menu>
		</div>

		{#if round.finalists}
			<ul class="flex gap-2 overflow-x-auto pb-1">
				{#each round.finalists as movie (movie.id)}
					<li class="w-20 shrink-0">
						<div class="aspect-[2/3] overflow-hidden rounded-lg">
							<Poster path={movie.posterPath} title={movie.title} size="w185" />
						</div>
						<p class="mt-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
							{movie.title}
						</p>
					</li>
				{/each}
			</ul>
		{/if}

		{#if me?.attending !== true}
			<p
				class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
			>
				You're not marked as attending, so you can't vote in the runoff. Ask someone to mark you
				in — your standing swipes already count.
			</p>
		{:else if myRunoffStep === 'veto'}
			<a
				href="/g/{token}/veto"
				class="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-4 py-4 text-base font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
			>
				<span>Veto a film — or skip</span>
				<span aria-hidden="true">→</span>
			</a>
		{:else if myRunoffStep === 'pairs'}
			<a
				href="/g/{token}/pairs"
				class="flex items-center justify-between gap-3 rounded-xl bg-indigo-600 px-4 py-4 text-base font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
			>
				<span>Compare the films ({me?.pairsDone} of {me?.pairsTotal})</span>
				<span aria-hidden="true">→</span>
			</a>
		{:else}
			<div class="space-y-2 rounded-xl border border-emerald-300 p-3 dark:border-emerald-800">
				<p class="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
					You're done — thanks.
				</p>
				<div class="flex gap-3 text-sm">
					<a href="/g/{token}/veto" class="underline">Change your veto</a>
					<a href="/g/{token}/pairs" class="underline">Change your picks</a>
				</div>
			</div>
		{/if}

		<AttendeeStrip
			participants={round.participants}
			participation={round.participation}
			meId={me?.memberId ?? ''}
			roundId={round.id}
			editable
			showProgress
		/>

		<form method="POST" action="?/advance" use:enhance>
			<input type="hidden" name="round_id" value={round.id} />
			<Confirm
				label="Reveal the winner"
				confirmLabel="Reveal it"
				question={waitingCount > 0
					? `${waitingCount} attendee${waitingCount === 1 ? " hasn't" : "s haven't"} voted — reveal anyway?`
					: 'Everyone has voted. Ready?'}
			/>
		</form>
	</div>
{:else if revealed}
	<!-- ── DECIDED / WATCHED: the reveal ────────────────────────────── -->
	<div class="space-y-6">
		{#if revealed.outcome === 'no_clear_favourite'}
			<div class="space-y-3 py-4 text-center">
				<p class="text-5xl" aria-hidden="true">🤷</p>
				<h2 class="text-xl font-bold tracking-tight">No clear favourite</h2>
				<p class="text-sm text-neutral-600 dark:text-neutral-300">
					Nothing in the pool cleared the approval bar tonight. That's a real answer, not a
					failure — the pool needs fresh blood.
				</p>
				<a
					href="/g/{token}/pool"
					class="inline-block rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
				>
					Add some suggestions
				</a>
			</div>
		{:else if revealed.winner}
			<!-- The winner moment: poster first, big. -->
			<div class="space-y-3 text-center">
				<p
					class="text-sm font-semibold tracking-wide text-indigo-600 uppercase dark:text-indigo-400"
				>
					Tonight you're watching
				</p>
				<div class="mx-auto w-full max-w-64 overflow-hidden rounded-2xl shadow-lg">
					<div class="aspect-[2/3]">
						<Poster
							path={revealed.winner.posterPath}
							title={revealed.winner.title}
							size="w500"
							eager
						/>
					</div>
				</div>
				<div>
					<h2 class="text-2xl font-bold tracking-tight">{revealed.winner.title}</h2>
					<p class="text-sm text-neutral-500 dark:text-neutral-400">
						{movieMeta(revealed.winner.year, revealed.winner.runtimeMin)}
						{#if revealed.winner.suggestedBy}
							· suggested by {revealed.winner.suggestedBy.displayName}
						{/if}
					</p>
				</div>
			</div>
		{/if}

		{#if round.state === 'decided' && round.transitions.canMarkWatched}
			<form method="POST" action="?/watched" use:enhance>
				<input type="hidden" name="round_id" value={round.id} />
				<Confirm
					label="We watched it 🎬"
					confirmLabel="Yes, we watched it"
					question="This retires the film and gives its suggester their turn. Do it after the night, not before."
				/>
			</form>
		{:else if round.state === 'watched'}
			<p
				class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
			>
				Watched {formatDate(revealed.watchedAt)}. It's in your history now.
			</p>
		{/if}

		<details class="rounded-xl border border-neutral-200 dark:border-neutral-800" open>
			<summary
				class="cursor-pointer px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500"
			>
				How the vote went
			</summary>
			<div class="border-t border-neutral-200 p-3 dark:border-neutral-800">
				<RevealTally reveal={revealed} />
			</div>
		</details>

		<form method="POST" action="?/createRound" use:enhance>
			<button
				class="w-full rounded-xl border border-neutral-300 px-4 py-3 font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
			>
				Start the next night
			</button>
		</form>
	</div>
{/if}
