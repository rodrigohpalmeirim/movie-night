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
			{@const proxied = !!person.markedBy && person.markedBy.id !== person.memberId}
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
						only appears when it has something the token cannot carry: no answer
						yet, who set a proxy RSVP, or the runoff progress.
					-->
					{#if !editable || person.attending === null || proxied || (showProgress && person.attending)}
						<p class="stencil text-[0.7rem] tracking-[0.02em] text-ink-soft">
							{#if person.attending === null}
								No answer yet
							{:else if person.attending}
								In{#if proxied} — marked by {person.markedBy?.displayName}{/if}
							{:else}
								Out{#if proxied} — marked by {person.markedBy?.displayName}{/if}
							{/if}
							{#if showProgress && person.attending}
								· {person.submitted ? 'voted' : 'not voted yet'}
							{/if}
						</p>
					{/if}
				</div>

				{#if showProgress && person.submitted && person.attending}
					<!-- A finished ballot gets stamped, in the app's one seal grammar and
					     at the pool list's compact size — the same object the runoff's own
					     "you're done" card and the pairs screen already print. Nothing
					     marks an unfinished ballot: the absence is the state, and the line
					     under the name spells it out. -->
					<span class="shrink-0">
						<Stamp word="Done" tone="jade" size="0.72rem" rotate={-7} />
						<span class="sr-only">has finished voting</span>
					</span>
				{/if}

				{#if editable}
					<form method="POST" action="?/rsvp" use:enhance class="flex shrink-0 gap-1.5">
						<input type="hidden" name="round_id" value={roundId} />
						<input type="hidden" name="member_id" value={person.memberId} />
						<button
							name="attending"
							value="true"
							aria-pressed={person.attending === true}
							class="token token-sm {person.attending === true ? 'token-jade' : ''}"
						>
							In<span class="sr-only"> — mark {person.displayName} as attending</span>
						</button>
						<button
							name="attending"
							value="false"
							aria-pressed={person.attending === false}
							class="token token-sm {person.attending === false ? 'token-cherry' : ''}"
						>
							Out<span class="sr-only"> — mark {person.displayName} as not attending</span>
						</button>
					</form>
				{:else}
					<!-- RSVPs are closed: the standing is a stamp, not a control. -->
					<span
						class="{chip} {person.attending === true
							? 'border-ink bg-jade text-ink'
							: person.attending === false
								? 'border-ink bg-ink text-board'
								: 'border-dashed border-ink-soft text-ink-soft'}"
						aria-hidden="true"
					>
						{person.attending === true ? 'in' : person.attending === false ? 'out' : 'no answer'}
					</span>
				{/if}
			</li>
		{/each}
	</ul>
</section>
