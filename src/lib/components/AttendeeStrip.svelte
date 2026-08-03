<!--
	RSVP status plus the proxy-RSVP affordance.

	app-spec: "the round screen shows RSVP status prominently ('4 in, 3 no
	answer')" and "any member can RSVP anyone (trust-based, like everything else)
	... Proxy RSVPs record who set them ('in — marked by Ana') so mistakes are
	visible and reversible."

	Drawn as the game's player roster: a board-stock pad with one ruled line per
	person, their standing stamped at the end of the line, and the two small
	tokens that change it. In RUNOFF a finished ballot gets the DONE seal — the
	same ink stamp every other mark in the app is made with.

	Everything shown here is *participation*, never a tally: who is coming, and in
	RUNOFF who has finished. Nothing about how anyone voted.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Stamp from '$lib/components/Stamp.svelte';
	import { createLatch } from '$lib/latch.svelte.js';
	import type { ParticipantView } from '$lib/server/services/views.js';

	let {
		participants,
		participation,
		meId,
		roundId,
		editable,
		showProgress = false
	}: {
		participants: ParticipantView[];
		participation: { attending: number; out: number; noAnswer: number; submitted: number };
		meId: string;
		roundId: string;
		/** RSVPs are open until the round is decided. */
		editable: boolean;
		/** In RUNOFF, also show who has finished voting. */
		showProgress?: boolean;
	} = $props();

	const summary = $derived(
		[
			`${participation.attending} in`,
			participation.out > 0 ? `${participation.out} out` : null,
			participation.noAnswer > 0 ? `${participation.noAnswer} no answer` : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	const waitingOn = $derived(
		participants.filter((p) => p.attending === true && !p.submitted).map((p) => p.displayName)
	);

	const chip =
		'stencil shrink-0 rounded border-2 px-1.5 py-px text-[0.68rem] font-semibold uppercase tracking-[0.08em]';

	/**
	 * One control group per person — each row posts its own form, so marking Ana
	 * must not disturb a tap on Ben still in flight. The row's own standing is
	 * drawn from the pending value while there is one; the summary and the
	 * "waiting on" line stay on server truth, because they are the group's
	 * count rather than this row's press.
	 */
	const rsvp = createLatch<boolean | null>(
		(data) => data.get('attending') === 'true',
		(data) => String(data.get('member_id'))
	);
</script>

<section class="space-y-2.5">
	<h2 class="flex items-baseline justify-between gap-2">
		<span class="eyebrow text-chalk">Who's coming</span>
		<span class="stencil text-xs text-brass uppercase">{summary}</span>
	</h2>

	{#if showProgress}
		<p class="text-xs text-chalk-dim">
			{#if waitingOn.length === 0}
				Everyone attending has finished voting.
			{:else}
				Waiting on {waitingOn.join(', ')}.
			{/if}
		</p>
	{/if}

	<!-- Rows deal in top to bottom on first render; keyed by member id, so the
	     SSE refresh (someone RSVPs, someone finishes voting) reuses the nodes
	     and only genuinely new members get dealt. -->
	<ul class="tile divide-y-2 divide-dashed divide-board-shade">
		{#each participants as person, i (person.memberId)}
			{@const attending = rsvp.value(person.attending, person.memberId)}
			{@const proxied =
				!rsvp.isPending(person.memberId) &&
				!!person.markedBy &&
				person.markedBy.id !== person.memberId}
			<!-- Whether the line under the name has anything the token can't carry.
			     It is always *set*, never conditionally mounted — see below. -->
			{@const detail =
				!editable || attending === null || proxied || (showProgress && attending === true)}
			<li class="deal-in flex items-center gap-2 px-3 py-2.5" style="--deal:{i}">
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium text-ink">
						{person.displayName}{#if person.memberId === meId}<span
								class="stencil ml-1 text-[0.65rem] tracking-[0.1em] text-ink-soft uppercase"
								>(you)</span
							>{/if}
					</p>
					<!--
						The pressed token already says in-or-out, so the line under the name
						only reads when it has something the token cannot carry: no answer
						yet, who set a proxy RSVP, or the runoff progress.

						But it is always THERE, hidden rather than unmounted, because the
						line is what sets the row's height: mounting it on the press (and
						again when the server confirms a proxy RSVP over SSE) made the row
						grow and shrink under the finger. Hidden, the standing still holds
						the space open, so the roster is a ruled pad with fixed lines and
						nothing reflows. `visibility` and not `opacity`, so the hidden text
						is gone from the accessibility tree too — the tokens' own
						`aria-pressed` already says in-or-out there.
					-->
					<p
						class="stencil text-[0.7rem] tracking-[0.02em] text-ink-soft {detail ? '' : 'invisible'}"
					>
						{#if attending === null}
							No answer yet
						{:else if attending}
							In{#if proxied} — marked by {person.markedBy?.displayName}{/if}
						{:else}
							Out{#if proxied} — marked by {person.markedBy?.displayName}{/if}
						{/if}
						{#if showProgress && attending}
							· {person.submitted ? 'voted' : 'not voted yet'}
						{/if}
					</p>
				</div>

				{#if showProgress && person.submitted && attending}
					<!-- A finished ballot gets stamped, in the app's one seal grammar and
					     at the pool list's compact size — the same object the runoff's own
					     "you're done" card and the pairs screen already print. Nothing
					     marks an unfinished ballot: the absence is the state, and the line
					     under the name spells it out. The seal comes and goes with the
					     standing, but it is shorter than the name-and-line block beside it,
					     so it is never what the row's height is measured from. -->
					<span class="shrink-0">
						<Stamp word="Done" tone="jade" size="0.72rem" rotate={-7} />
						<span class="sr-only">has finished voting</span>
					</span>
				{/if}

				{#if editable}
					<form method="POST" action="?/rsvp" use:enhance={rsvp.submit} class="flex shrink-0 gap-1.5">
						<input type="hidden" name="round_id" value={roundId} />
						<input type="hidden" name="member_id" value={person.memberId} />
						<!-- Latched, exactly like the round screen's own RSVP pair: whichever
						     standing is true is held down and inked, the other stays raised —
						     from the moment of the press, not the moment the server answers. -->
						<button
							name="attending"
							value="true"
							aria-pressed={attending === true}
							class="token token-sm {attending === true ? 'token-jade token-latched' : ''}"
						>
							In<span class="sr-only"> — mark {person.displayName} as attending</span>
						</button>
						<button
							name="attending"
							value="false"
							aria-pressed={attending === false}
							class="token token-sm {attending === false ? 'token-cherry token-latched' : ''}"
						>
							Out<span class="sr-only"> — mark {person.displayName} as not attending</span>
						</button>
					</form>
				{:else}
					<!-- RSVPs are closed: the standing is a stamp, not a control. -->
					<span
						class="{chip} {attending === true
							? 'border-ink bg-jade text-ink'
							: attending === false
								? 'border-ink bg-ink text-board'
								: 'border-dashed border-ink-soft text-ink-soft'}"
						aria-hidden="true"
					>
						{attending === true ? 'in' : attending === false ? 'out' : 'no answer'}
					</span>
				{/if}
			</li>
		{/each}
	</ul>
</section>
