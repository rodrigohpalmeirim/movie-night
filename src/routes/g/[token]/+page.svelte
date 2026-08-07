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
	import Check from '$lib/icons/Check.svelte';
	import ChevronRight from '$lib/icons/ChevronRight.svelte';
	import Dice5 from '$lib/icons/Dice5.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatDate, formatStampDate, movieMeta } from '$lib/images.js';
	import { createLatch } from '$lib/latch.svelte.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const token = $derived(data.token);
	const round = $derived(data.round);
	const me = $derived(round?.me);
	const revealed = $derived(round?.reveal ?? null);

	/**
	 * The standing pool, counted — served only to the screens with no round to
	 * describe (see the load), which is where it is the whole point.
	 */
	const lobby = $derived(data.lobby);
	/**
	 * THE LOBBY'S ONE LOUD MOVE. Whichever the table leaves you: a hand of cards
	 * gets swiped, an empty hand gets filled. Only one of the two pool doors wears
	 * brass, so a screen with no round still has exactly one obvious next tap
	 * instead of two shouting over each other.
	 */
	const lobbyPrimary = $derived(lobby && lobby.unswipedCount > 0 ? 'swipe' : 'suggest');

	/**
	 * My own RSVP, latched optimistically: the ticket's two tokens are one
	 * control group, so pressing either one latches it and raises the other
	 * immediately instead of after the round trip.
	 */
	const rsvp = createLatch<boolean | null>((data) => data.get('attending') === 'true');
	const myAttending = $derived(rsvp.value(me?.attending ?? null));

	const waitingCount = $derived(data.unsubmittedAttendeeIds.length);
	/**
	 * Where I am in tonight's runoff. The veto is a step only where the round was
	 * frozen with one (`round.vetoesEnabled`) — otherwise the flow is the pairs and
	 * nothing else, and there is no veto to change once they are done.
	 */
	const vetoStep = $derived(round?.vetoesEnabled === true);
	const myRunoffStep = $derived(
		!me
			? null
			: vetoStep && !me.vetoSubmitted
				? 'veto'
				: me.pairsDone < me.pairsTotal
					? 'pairs'
					: 'done'
	);

	/**
	 * THE HAND — how the finalists are fanned out, per finalist count.
	 *
	 * A group can ask for 2 to 5 finalists (`n_finalists`, capped at 5 in
	 * groups.ts), so the fan has to look deliberate across that whole range
	 * rather than at one count. Fewer finalists get BIGGER cards turned FURTHER,
	 * so a hand of two reads as two cards crossed on the felt instead of a sparse
	 * pair; five get smaller cards and a tighter overlap, so the whole hand still
	 * fits a phone in one glance instead of running off the side into a scroller,
	 * which is what the old rack did at exactly five. Every hand ends up spanning
	 * roughly the same two thirds of the column.
	 *
	 * `width` is a share of the COLUMN with a rem cap, so the fan scales with the
	 * screen and cannot overflow it: everything else is expressed as a fraction of
	 * that one number. `overlap` is how much of a card the next one covers, and
	 * `tilt` the degrees between neighbours (the fan is centred on 0°, so a card's
	 * own angle is its distance from the middle of the hand times this).
	 */
	const HANDS: Record<number, { width: string; overlap: number; tilt: number }> = {
		1: { width: 'min(42%, 8rem)', overlap: 0, tilt: 0 },
		2: { width: 'min(38%, 6.75rem)', overlap: 0.42, tilt: 12 },
		3: { width: 'min(32%, 6rem)', overlap: 0.44, tilt: 10 },
		4: { width: 'min(26%, 5.5rem)', overlap: 0.46, tilt: 9 },
		5: { width: 'min(23%, 5rem)', overlap: 0.5, tilt: 8 }
	};
	const finalistCount = $derived(round?.finalists?.length ?? 0);
	/** Tightest hand for anything unexpectedly larger; the table covers 1–5. */
	const hand = $derived(HANDS[Math.min(finalistCount, 5)] ?? HANDS[5]);
	/** A card's own angle: its distance from the middle of the hand, in tilts. */
	const tiltOf = (i: number) => ((i - (finalistCount - 1) / 2) * hand.tilt).toFixed(2);
</script>

{#if form?.message}
	<p role="alert" class="notice notice-cherry mb-5">
		<TriangleAlert size={18} class="mt-px shrink-0" />
		{form.message}
	</p>
{/if}

{#if !round || round.state === 'abandoned'}
	<!-- ── No active round: the lobby, not a dead end ────────────────
	     Nothing on this screen is waiting for a night to be started. The pool is
	     standing — films can be suggested and swiped at any hour of any day —
	     so the empty slot is followed by the two doors that are always open, and
	     the night comes after them: it is what you start when the group is in
	     the room, not the thing that unlocks the rest of the app. -->
	<div class="space-y-5">
		<!-- An empty slot on the board, and ONE face for it: an abandoned round
		     lands here too, deliberately unmarked. The cancellation was group-chat
		     news the evening it happened; a seal that keeps announcing it weeks
		     later reads as a scolding, and the confirm step already told whoever
		     cancelled what was discarded. The last line counts the table, so the
		     slot says what is missing AND what is already dealt. -->
		<div class="tile-slot space-y-3 px-4 py-8 text-center">
			<Dice5 size={40} class="mx-auto text-brass" />
			<h2 class="display text-[1.6rem] text-board">No movie night yet</h2>
			<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
				The pool doesn't wait for a night. Suggest films and swipe them whenever you like — a round
				plays whatever is on the table when it starts.
			</p>
			{#if lobby}
				<p class="stencil text-xs text-chalk-dim uppercase">
					{lobby.poolSize > 0
						? `${lobby.poolSize} ${lobby.poolSize === 1 ? 'film' : 'films'} on the table`
						: 'Nothing on the table yet'}
				</p>
			{/if}
		</div>

		<!-- Your own stack, the same numbered ticket the open round deals: the
		     swipe screen reads the standing pool and nothing else, so between
		     nights it works exactly as it does during one. -->
		{#if lobby && lobby.unswipedCount > 0}
			<a href="/g/{token}/swipe" class="deal-in token token-lg token-brass w-full justify-between">
				<span class="flex items-center gap-2.5">
					<span
						class="display flex h-7 min-w-7 items-center justify-center rounded-sm border-2 border-ink bg-board px-1 text-base leading-none"
						aria-hidden="true">{lobby.unswipedCount}</span
					>
					{lobby.unswipedCount === 1 ? 'card to swipe' : 'cards to swipe'}
				</span>
				<ArrowRight size={20} />
			</a>
		{/if}

		<!-- The other door, straight to the suggest pad rather than to the top of
		     the Pool tab. Brass only when there is nothing to swipe — see
		     `lobbyPrimary` — which is the state an empty table is always in. -->
		<a
			href="/g/{token}/pool?suggest"
			class="token w-full justify-between {lobbyPrimary === 'suggest' ? 'token-lg token-brass' : ''}"
		>
			Add a film to the pool
			<ArrowRight size={lobbyPrimary === 'suggest' ? 20 : 18} />
		</a>

		<!-- The night itself, second, in the same ruled-off footer the open state
		     gives "Pick finalists": a transition is not a door, so it gets a line
		     of print saying what it is for and one token under it. Board stock,
		     like "Start the next night" on the reveal — the brass above belongs
		     to whatever you can do this minute. -->
		<section class="space-y-3 border-t-2 border-dashed border-felt-line pt-4">
			<p class="text-sm leading-relaxed text-chalk-dim">
				Start a night when you're together and ready to pick. Suggestions and swipes carry over —
				nothing is lost between nights.
			</p>
			<form method="POST" action="?/createRound" use:enhance>
				<button class="token token-lg token-slot w-full">Start a movie night</button>
			</form>
		</section>
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
			<form method="POST" action="?/rsvp" use:enhance={rsvp.submit} class="flex gap-2.5">
				<input type="hidden" name="round_id" value={round.id} />
				<input type="hidden" name="member_id" value={me?.memberId} />
				<!-- Your standing, as two latched buttons: the one that is true is held
				     down and inked, the other stays raised. The pressed silhouette is
				     the indicator, so neither one needs a tick — and nothing shifts
				     sideways when you change your mind. Latched from the optimistic
				     value, so the press holds through the round trip. -->
				<button
					name="attending"
					value="true"
					aria-pressed={myAttending === true}
					class="token flex-1 {myAttending === true ? 'token-jade token-latched' : ''}"
				>
					I'm in
				</button>
				<button
					name="attending"
					value="false"
					aria-pressed={myAttending === false}
					class="token flex-1 {myAttending === false ? 'token-cherry token-latched' : ''}"
				>
					Can't make it
				</button>
			</form>
			{#if myAttending === null}
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

		<!-- The pool is open all through a round, and a film added now enters this
		     one via top-up — so the screen that funnels to RSVP and swiping says
		     so. Board stock at the standard size, deliberately quieter than the
		     brass ticket above it: swiping is still tonight's move. Outside that
		     ticket's `{#if}` on purpose — a member with an empty stack is exactly
		     the member for whom suggesting is the useful act. -->
		<a href="/g/{token}/pool?suggest" class="token w-full justify-between">
			Add a film to the pool
			<ArrowRight size={18} />
		</a>

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
						label="Pick finalists"
						confirmLabel="Pick the finalists"
						question="This freezes tonight's finalists and the swipes behind them."
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

		{#if round.finalists && round.finalists.length > 0}
			<!--
				THE FINALISTS, AS A HAND FANNED OUT ON THE FELT.

				Not a rack of framed thumbnails: the same flat card the swipe screen
				deals — poster to the very edge, one hairline of ink for the cut, and
				the soft shadow it casts on the table. No lip, because a raised edge on
				this table means pressable and these are not controls; nothing here is
				a link, exactly as before.

				They overlap and turn about a pivot below the bottom edge, which is
				where a hand of cards is actually held, so the tops fan apart and the
				outer cards settle a little lower. Widths, overlap and turn all come
				from `HANDS` above, so two finalists and five both look dealt.

				Dealt left to right on arrival — the existing `.deal-in`, and the
				per-card angle rides the separate `rotate` property so the entrance's
				own transform cannot overwrite it. Keyed by movie id, so the SSE
				refresh reuses these nodes and never re-deals them.
			-->
			<div class="pb-1.5">
				<ul class="flex justify-center" style="--fan-w:{hand.width}">
					{#each round.finalists as movie, i (movie.id)}
						<li
							class="fan-card deal-in"
							style="--deal:{i};--tilt:{tiltOf(i)}deg;z-index:{i}{i > 0
								? `;margin-left:calc(var(--fan-w) * -${hand.overlap})`
								: ''}"
						>
							<Poster path={movie.posterPath} title={movie.title} size="w185" />
						</li>
					{/each}
				</ul>

				<!-- The hand read out in print, left to right, so the titles the old
				     rack captioned are still on the screen — a fanned card only shows
				     a strip of its neighbour, and none of them shows its spine. Hidden
				     from assistive tech on purpose: every poster above already carries
				     its film's title in its alt text, in this same order, so reading
				     this too would say the whole hand twice. -->
				<p
					class="stencil mx-auto mt-2.5 max-w-[21rem] text-center text-[0.72rem] leading-snug text-chalk-dim uppercase"
					aria-hidden="true"
				>
					{round.finalists.map((movie) => movie.title).join(' · ')}
				</p>
			</div>
		{/if}

		{#if me?.attending !== true}
			<p class="notice notice-brass">
				<TriangleAlert size={17} class="mt-px shrink-0" />
				<!-- The roster right below this is editable through the runoff (the RSVP
				     action takes `open` and `runoff` alike, from anyone, for anyone), so
				     the way out of this state is one tap on this same screen. The old copy
				     sent people looking for someone else to do it for them. -->
				<span
					>You're not marked as attending, so you can't vote in the runoff. Tap IN next to your name
					in the list below if you'd like to join.</span
				>
			</p>
		{:else if myRunoffStep === 'veto'}
			<!-- Brass, like the pairs step below it, and NOT cherry: the red card
			     belongs to the veto screen itself. On the board this is simply the
			     next thing you do, and a red plate labelled "or skip" read as an
			     optional extra you were free to ignore — so people who didn't want to
			     veto never went in, and never recorded the answer that lets them
			     through to the pairs. Both moves live behind this one button, so it
			     names them both. -->
			<a href="/g/{token}/veto" class="token token-lg token-brass w-full justify-between">
				<span class="flex items-center gap-2">Veto a film, or pass</span>
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
						{#if vetoStep}
							<a href="/g/{token}/veto" class="font-semibold text-ink-soft underline"
								>Change your veto</a
							>
						{/if}
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
				<!-- Straight to the pad, like every other "add a film" in the app. -->
				<a href="/g/{token}/pool?suggest" class="token token-brass mx-auto mt-1 w-auto px-5">
					Add some suggestions
					<ArrowRight size={17} />
				</a>
			</div>
		{:else if revealed.winner}
			<!--
				The winner moment. The night is announced on the felt, and the film
				arrives under it as a ticket stub with the round's seal slammed across
				the artwork — the same stamp the swipe screen uses, in brass, once.

				THE ANNOUNCEMENT. What the night decided is a NAME, so the name gets the
				big face. The other two states of this page already announce themselves
				exactly this way — brass stencil eyebrow over a slab headline — and this
				is that same sentence at full volume: "tonight you're watching" is the
				words you say BEFORE a title, so they stay small, and the title itself is
				struck straight onto the felt at display size, centred over the stub it
				belongs to, with a brass tack ruled under it.

				It used to be the other way round: the boilerplate had an inked marquee
				plate to itself and the film — the payoff of the whole app — was 1.5rem of
				caption at the bottom of the ticket. The stub keeps the poster, the seal
				and the small print; the title has moved up here, so it is said once.
			-->
			<!-- The reveal is a two-beat deal: the announcement lands, then the stub —
			     and the PICKED seal's own slam lands last, on top of both. -->
			<div class="deal-in text-center">
				<p class="eyebrow text-brass">Tonight you're watching</p>
				<h2 class="display mx-auto mt-1.5 max-w-[19rem] text-[1.95rem] leading-[0.98] text-balance text-board">
					{revealed.winner.title}
				</h2>
				<div class="mx-auto mt-3 h-[3px] w-14 rounded-full bg-brass"></div>
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
					<!-- Small print on the receipt. The title is not repeated here: it is
					     the announcement above, and the poster's alt text carries it for
					     anyone reading the stub on its own. -->
					<p class="stencil px-0.5 text-[0.72rem] text-ink-soft uppercase">
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

		{#if round.state === 'watched' && lobby}
			<!-- The film is bookkept, so this screen is the between-nights surface
			     now and the lobby's two doors open here too: the same numbered
			     stack, and the suggest pad. The suggest door stays board stock —
			     on this screen the winner's seal keeps the brass of celebration,
			     and the stack's brass is the standing "you have cards" call it is
			     everywhere else. -->
			{#if lobby.unswipedCount > 0}
				<a href="/g/{token}/swipe" class="deal-in token token-lg token-brass w-full justify-between">
					<span class="flex items-center gap-2.5">
						<span
							class="display flex h-7 min-w-7 items-center justify-center rounded-sm border-2 border-ink bg-board px-1 text-base leading-none"
							aria-hidden="true">{lobby.unswipedCount}</span
						>
						{lobby.unswipedCount === 1 ? 'card to swipe' : 'cards to swipe'}
					</span>
					<ArrowRight size={20} />
				</a>
			{/if}
			<a href="/g/{token}/pool?suggest" class="token w-full justify-between">
				Add a film to the pool
				<ArrowRight size={18} />
			</a>
		{/if}

		<form method="POST" action="?/createRound" use:enhance>
			<button class="token token-slot w-full">Start the next night</button>
		</form>
	</div>
{/if}

<style>
	/*
		ONE CARD IN THE FANNED HAND (see the markup above for what the hand is).

		Geometry is all derived from `--fan-w`, the one width the script hands down:
		the card's own width, its 2:3 stock, and how far the next card covers it
		(that one is an inline margin, because it is per card). Written here rather
		than as five arbitrary utilities so the whole shape of a card is in one
		place and reads as a card.

		The turn is the `rotate` PROPERTY, not a transform: `.deal-in` animates
		`transform`, and the two compose instead of fighting — so a card's angle
		survives its own entrance, and under prefers-reduced-motion (which zeroes
		the animation globally in app.css) the fan is simply already fanned.

		The pivot is below the bottom edge — where a hand of cards is held between
		finger and thumb — so turning a card sweeps its top corner outwards and
		drops it slightly, which is what makes five of these read as one arc rather
		than five tilted rectangles.

		FLAT, like the swipe screen's card: poster to the very edge, one hairline of
		ink for the die-cut, and no lip — a raised edge here means pressable. What
		it does own is the soft shadow it casts on the felt, which is also what
		separates the overlap: each card's shadow falls across the one it covers.
	*/
	.fan-card {
		position: relative;
		width: var(--fan-w);
		aspect-ratio: 2 / 3;
		flex-shrink: 0;
		overflow: hidden;
		border: 1px solid var(--color-ink);
		border-radius: 4px;
		background-color: var(--color-felt-deep);
		transform-origin: 50% 120%;
		rotate: var(--tilt, 0deg);
		box-shadow: 0 5px 12px rgb(0 0 0 / 0.4);
	}
</style>
