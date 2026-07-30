<!--
	RSVP status plus the proxy-RSVP affordance.

	app-spec: "the round screen shows RSVP status prominently ('4 in, 3 no
	answer')" and "any member can RSVP anyone (trust-based, like everything else)
	... Proxy RSVPs record who set them ('in — marked by Ana') so mistakes are
	visible and reversible."

	Everything shown here is *participation*, never a tally: who is coming, and in
	RUNOFF who has finished. Nothing about how anyone voted.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
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
</script>

<section class="space-y-3">
	<h2 class="flex items-baseline justify-between text-sm font-semibold">
		<span>Who's coming</span>
		<span class="text-neutral-500 dark:text-neutral-400">{summary}</span>
	</h2>

	{#if showProgress}
		<p class="text-sm text-neutral-500 dark:text-neutral-400">
			{#if waitingOn.length === 0}
				Everyone attending has finished voting.
			{:else}
				Waiting on {waitingOn.join(', ')}.
			{/if}
		</p>
	{/if}

	<ul class="divide-y divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
		{#each participants as person (person.memberId)}
			<li class="flex items-center gap-3 px-3 py-2">
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">
						{person.displayName}{#if person.memberId === meId}<span
								class="ml-1 text-xs font-normal text-neutral-500">(you)</span
							>{/if}
					</p>
					<p class="text-xs text-neutral-500 dark:text-neutral-400">
						{#if person.attending === null}
							No answer yet
						{:else if person.attending}
							In{#if person.markedBy && person.markedBy.id !== person.memberId}
								— marked by {person.markedBy.displayName}{/if}
						{:else}
							Out{#if person.markedBy && person.markedBy.id !== person.memberId}
								— marked by {person.markedBy.displayName}{/if}
						{/if}
						{#if showProgress && person.attending}
							· {person.submitted ? 'voted' : 'not voted yet'}
						{/if}
					</p>
				</div>

				{#if editable}
					<form method="POST" action="?/rsvp" use:enhance class="flex shrink-0 gap-1">
						<input type="hidden" name="round_id" value={roundId} />
						<input type="hidden" name="member_id" value={person.memberId} />
						<button
							name="attending"
							value="true"
							aria-pressed={person.attending === true}
							class="rounded-lg px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 {person.attending ===
							true
								? 'bg-emerald-600 text-white'
								: 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'}"
						>
							In<span class="sr-only"> — mark {person.displayName} as attending</span>
						</button>
						<button
							name="attending"
							value="false"
							aria-pressed={person.attending === false}
							class="rounded-lg px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 {person.attending ===
							false
								? 'bg-neutral-600 text-white'
								: 'border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'}"
						>
							Out<span class="sr-only"> — mark {person.displayName} as not attending</span>
						</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</section>
