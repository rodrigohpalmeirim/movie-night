<!--
	Round screen (home tab) — state-dependent, per app-spec's phase-by-phase
	behaviour. Every transition is a single labelled button with a confirm step,
	because transitions are one-way.

	Visually this is the board itself: the state headline is printed straight on
	the felt, and each thing you can do is a separate die-cut component laid on
	top — a ticket for your seat, a chunky token for every move, the roster pad,
	and at the end the winner's stub with the seal slammed across it.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import AttendeeStrip from '$lib/components/AttendeeStrip.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import RevealTally from '$lib/components/RevealTally.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import Ban from '$lib/icons/Ban.svelte';
	import Check from '$lib/icons/Check.svelte';
	import ChevronRight from '$lib/icons/ChevronRight.svelte';
	import Dice5 from '$lib/icons/Dice5.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatDate, formatStampDate, movieMeta } from '$lib/images.js';
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
	<p role="alert" class="notice notice-cherry mb-5">
		<TriangleAlert size={18} class="mt-px shrink-0" />
		{form.message}
	</p>
{/if}

{#if !round || round.state === 'abandoned'}
	<!-- ── No active round: an empty slot on the board ──────────────── -->
	<div class="space-y-5">
		<!-- An empty slot on the board. A cancelled night gets the seal, because
		     something did happen to it; a first night gets the dice, because
		     nothing has. -->
		<div class="tile-slot space-y-3 px-4 py-8 text-center">
			{#if round?.state === 'abandoned'}
				<Stamp word="Cancelled" tone="cherry" size="1.1rem" rotate={-6} />
			{:else}
				<Dice5 size={40} class="mx-auto text-brass" />
			{/if}
			<h2 class="display text-[1.6rem] text-board">
				{round?.state === 'abandoned' ? 'That night got cancelled' : 'No movie night yet'}
			</h2>
			<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
				{#if round?.state === 'abandoned'}
					Tonight's vetoes and pair votes are gone. Standing swipes are kept, so starting again picks
					up where the pool left off.
				{:else}
					Start one when you know you're watching something. Suggestions and swipes carry over —
					nothing is lost between nights.
				{/if}
			</p>
		</div>
		<form method="POST" action="?/createRound" use:enhance>
			<button class="token token-lg token-brass w-full">
				Start a movie night
				<ArrowRight size={18} />
			</button>
		</form>
	</div>
{:else if round.state === 'open'}
	<!-- ── OPEN: RSVP, suggest, swipe ───────────────────────────────── -->
	<div class="space-y-5">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="eyebrow text-brass">Round open</p>
				<h2 class="display mt-1 text-[1.75rem] text-board">Tonight's the night</h2>
				<p class="stencil mt-1.5 text-xs text-chalk-dim uppercase">
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

		<!-- My own RSVP, as a ticket you tear one half off. Default is out.
		     Three pieces (top / perf / bottom), so the perf's notches are true
		     cutouts and the felt shows through them. -->
		<section>
			<div class="ticket-top px-3 pt-2.5 pb-0.5">
				<h3 class="eyebrow text-ink-soft">Your seat</h3>
			</div>
			<div class="perf"></div>
			<div class="ticket-bottom px-3 pt-0.5 pb-3">
			<p class="mb-2.5 text-base font-semibold text-ink">Are you in?</p>
			<form method="POST" action="?/rsvp" use:enhance class="flex gap-2.5">
				<input type="hidden" name="round_id" value={round.id} />
				<input type="hidden" name="member_id" value={me?.memberId} />
				<!-- Your standing, as two latched buttons: the one that is true is held
				     down and inked, the other stays raised. The pressed silhouette is
				     the indicator, so neither one needs a tick — and nothing shifts
				     sideways when you change your mind. -->
				<button
					name="attending"
					value="true"
					aria-pressed={me?.attending === true}
					class="token flex-1 {me?.attending === true ? 'token-jade token-latched' : ''}"
				>
					I'm in
				</button>
				<button
					name="attending"
					value="false"
					aria-pressed={me?.attending === false}
					class="token flex-1 {me?.attending === false ? 'token-cherry token-latched' : ''}"
				>
					Can't make it
				</button>
			</form>
			{#if me?.attending === null}
				<p class="mt-2.5 text-xs leading-relaxed text-ink-soft">
					Nobody is counted as attending until they say so — your swipes only shape the night if
					you're in.
				</p>
			{/if}
			</div>
		</section>

		{#if me && me.unswipedMovieIds.length > 0}
			<!-- Your own stack, as a numbered ticket: the count is the stub.
			     deal-in also covers the top-up arriving over SSE: when new
			     suggestions land mid-session the ticket settles in, and a count
			     that merely changes keeps the node and stays still. -->
			<a href="/g/{token}/swipe" class="deal-in token token-lg token-brass w-full justify-between">
				<span class="flex items-center gap-2.5">
					<span
						class="display flex h-7 min-w-7 items-center justify-center rounded-sm border-2 border-ink bg-board px-1 text-base leading-none"
						aria-hidden="true">{me.unswipedMovieIds.length}</span
					>
					{me.unswipedMovieIds.length === 1 ? 'card to swipe' : 'cards to swipe'}
				</span>
				<ArrowRight size={20} />
			</a>
		{/if}

		<AttendeeStrip
			participants={round.participants}
			participation={round.participation}
			meId={me?.memberId ?? ''}
			roundId={round.id}
			editable
		/>

		<section class="space-y-3 border-t-2 border-dashed border-felt-line pt-4">
			<p class="text-sm leading-relaxed text-chalk-dim">
				{#if round.readiness.attendeesWithGaps > 0}
					<span class="font-semibold text-chalk"
						>{round.readiness.attendeesWithGaps} of {round.readiness.attendeeCount} attendees</span
					> still have unswiped films. You can close anyway — films nobody has seen simply wait for next
					time.
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
					<p class="notice notice-brass">
						<TriangleAlert size={17} class="mt-px shrink-0" />
						{round.transitions.advanceBlockedReason}
					</p>
				{/if}
			</form>
		</section>
	</div>
{:else if round.state === 'runoff'}
	<!-- ── RUNOFF: veto, then pairs ─────────────────────────────────── -->
	<div class="space-y-5">
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="eyebrow text-brass">Runoff</p>
				<h2 class="display mt-1 text-[1.75rem] text-board">The finalists are in</h2>
				<p class="mt-1.5 text-xs leading-relaxed text-chalk-dim">
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
			<!-- The finalists racked up like cards in a holder — dealt into the
			     rack left to right on arrival. Keyed by movie id, so the SSE
			     refresh reuses these nodes and never re-deals them. -->
			<ul class="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2">
				{#each round.finalists as movie, i (movie.id)}
					<li class="deal-in w-[4.75rem] shrink-0" style="--deal:{i}">
						<div class="tile p-1">
							<div class="aspect-[2/3] overflow-hidden rounded-[3px] border border-ink">
								<Poster path={movie.posterPath} title={movie.title} size="w185" />
							</div>
						</div>
						<p class="stencil mt-2.5 truncate text-[0.7rem] text-chalk-dim uppercase">
							{movie.title}
						</p>
					</li>
				{/each}
			</ul>
		{/if}

		{#if me?.attending !== true}
			<p class="notice notice-brass">
				<TriangleAlert size={17} class="mt-px shrink-0" />
				<span
					>You're not marked as attending, so you can't vote in the runoff. Ask someone to mark you
					in — your standing swipes already count.</span
				>
			</p>
		{:else if myRunoffStep === 'veto'}
			<a href="/g/{token}/veto" class="token token-lg token-cherry w-full justify-between">
				<span class="flex items-center gap-2"><Ban size={18} /> Veto a film — or skip</span>
				<ArrowRight size={20} />
			</a>
		{:else if myRunoffStep === 'pairs'}
			<a href="/g/{token}/pairs" class="token token-lg token-brass w-full justify-between">
				<span>Compare the films ({me?.pairsDone} of {me?.pairsTotal})</span>
				<ArrowRight size={20} />
			</a>
		{:else}
			<div class="tile flex items-center gap-3 px-3 py-3">
				<Stamp word="Done" tone="jade" size="0.95rem" rotate={-7} />
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold text-ink">You're done — thanks.</p>
					<div class="mt-0.5 flex gap-3 text-xs">
						<a href="/g/{token}/veto" class="font-semibold text-ink-soft underline"
							>Change your veto</a
						>
						<!-- `?review` opens the pair deck at pair one with every answer
						     already marked, so reviewing and changing are one door rather
						     than two: a member steps through and re-taps only what they
						     meant to change. -->
						<a href="/g/{token}/pairs?review" class="font-semibold text-ink-soft underline"
							>Review my picks</a
						>
					</div>
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

		<div class="border-t-2 border-dashed border-felt-line pt-4">
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
	</div>
{:else if revealed}
	<!-- ── DECIDED / WATCHED: the reveal ────────────────────────────── -->
	<div class="space-y-5">
		{#if revealed.outcome === 'no_clear_favourite'}
			<div class="tile-slot space-y-3 px-4 py-7 text-center">
				<Stamp word="No pick" tone="cherry" size="1.35rem" rotate={-6} slam class="mb-1" />
				<h2 class="display text-[1.6rem] text-board">No clear favourite</h2>
				<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
					Nothing in the pool cleared the approval bar tonight. That's a real answer, not a failure —
					the pool needs fresh blood.
				</p>
				<a href="/g/{token}/pool" class="token token-brass mx-auto mt-1 w-auto px-5">
					Add some suggestions
					<ArrowRight size={17} />
				</a>
			</div>
		{:else if revealed.winner}
			<!--
				The winner moment. A marquee plate announces it, and the film arrives
				as a ticket stub with the round's seal slammed across the artwork —
				the same stamp the swipe screen uses, in brass, once.
			-->
			<!-- The reveal is a two-beat deal: the marquee lands, then the stub —
			     and the PICKED seal's own slam lands last, on top of both. -->
			<div class="deal-in marquee px-4 py-2.5 text-center">
				<p class="eyebrow text-[0.72rem] tracking-[0.26em]">Tonight you're watching</p>
			</div>

			<div class="deal-in mx-auto max-w-[18.5rem] pt-1" style="--deal:2">
				<!-- The stub lies flat. It is the night's receipt, not a button.
				     Three pieces (top / perf / bottom), so the tear line's notches
				     are punched clean through and the felt shows in them. -->
				<div>
					<div class="ticket-top p-2.5 pb-0.5">
					<!-- The seal straddles the artwork's corner and the tear line, which is
					     where a ticket actually gets stamped. -->
					<div class="relative">
						<div class="aspect-[2/3] overflow-hidden rounded-[3px] border-2 border-ink">
							<Poster
								path={revealed.winner.posterPath}
								title={revealed.winner.title}
								size="w500"
								eager
							/>
						</div>
						<!-- z-10: the seal straddles the tear line, and the perf row is a
						     positioned later sibling that would otherwise paint over it. -->
						<div class="pointer-events-none absolute -right-2 -bottom-5 z-10">
							<Stamp
								word="Picked"
								note={formatStampDate(revealed.decidedAt)}
								tone="brass"
								size="1.35rem"
								rotate={-9}
								slam
							/>
						</div>
					</div>
					</div>
					<div class="perf"></div>
					<div class="ticket-bottom px-2.5 pt-0.5 pb-2.5">
					<h2 class="display px-0.5 text-[1.5rem] leading-[1.05] text-ink">
						{revealed.winner.title}
					</h2>
					<p class="stencil mt-1.5 px-0.5 text-[0.72rem] text-ink-soft uppercase">
						{movieMeta(revealed.winner.year, revealed.winner.runtimeMin)}
						{#if revealed.winner.suggestedBy}
							· suggested by {revealed.winner.suggestedBy.displayName}
						{/if}
					</p>
					</div>
				</div>
			</div>
		{/if}

		{#if round.state === 'decided' && round.transitions.canMarkWatched}
			<form method="POST" action="?/watched" use:enhance>
				<input type="hidden" name="round_id" value={round.id} />
				<!-- Bookkeeping after the fact, not part of the celebration: board stock,
				     so the marquee and the seal keep the brass to themselves. -->
				<Confirm
					label="We watched it"
					confirmLabel="Yes, we watched it"
					question="This retires the film and gives its suggester their turn. Do it after the night, not before."
					variant="quiet"
				/>
			</form>
		{:else if round.state === 'watched'}
			<p class="tile flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
				<Check size={17} class="shrink-0 text-jade-deep" />
				Watched {formatDate(revealed.watchedAt)}. It's in your history now.
			</p>
		{/if}

		<details class="tile group/tally expand overflow-hidden" open>
			<summary
				class="eyebrow row-press flex cursor-pointer list-none items-center gap-1.5 px-3 py-3 text-ink select-none focus-visible:outline-offset-[-3px]"
			>
				<ChevronRight
					size={14}
					class="transition-transform group-open/tally:rotate-90 motion-reduce:transition-none"
				/>
				How the vote went
			</summary>
			<div class="border-t-2 border-dashed border-board-shade p-3">
				<RevealTally reveal={revealed} />
			</div>
		</details>

		<form method="POST" action="?/createRound" use:enhance>
			<button class="token token-slot w-full">Start the next night</button>
		</form>
	</div>
{/if}
