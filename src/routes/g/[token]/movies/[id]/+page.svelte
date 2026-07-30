<!--
	Movie detail: revise the standing vote at any time, or remove the film.
	The only vote shown is the viewer's own.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Confirm from '$lib/components/Confirm.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import VoteBadge from '$lib/components/VoteBadge.svelte';
	import { formatDate, movieMeta } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	const vote = $derived(form && 'myVote' in form && form.myVote ? form.myVote : data.myVote);
</script>

<div class="space-y-5">
	<a
		href="/g/{data.token}/pool"
		class="inline-block text-sm text-neutral-500 underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-neutral-400"
		>Back to the pool</a
	>

	<div class="flex gap-4">
		<div class="h-44 w-30 shrink-0 overflow-hidden rounded-xl shadow">
			<Poster path={data.movie.posterPath} title={data.movie.title} size="w342" eager />
		</div>
		<div class="min-w-0 flex-1 space-y-2">
			<h2 class="text-xl leading-tight font-bold tracking-tight">{data.movie.title}</h2>
			<p class="text-sm text-neutral-500 dark:text-neutral-400">
				{movieMeta(data.movie.year, data.movie.runtimeMin)}
			</p>
			{#if data.movie.suggestedBy}
				<p class="text-sm text-neutral-500 dark:text-neutral-400">
					Suggested by {data.movie.suggestedBy}
				</p>
			{/if}
			{#if data.movie.status === 'watched'}
				<p class="text-sm font-medium text-emerald-700 dark:text-emerald-400">
					Watched {formatDate(data.movie.watchedAt)}
				</p>
			{:else if data.movie.status === 'removed'}
				<p class="text-sm font-medium text-neutral-500">
					Removed from the pool — re-suggesting it brings it back with all swipes intact.
				</p>
			{/if}
			<VoteBadge {vote} />
		</div>
	</div>

	{#if form?.message}
		<p role="alert" class="text-sm font-medium text-rose-600 dark:text-rose-400">{form.message}</p>
	{/if}

	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Would you watch this?</h3>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			This is a standing answer, not a vote for tonight. Change it whenever you like.
		</p>
		<form method="POST" action="?/vote" use:enhance class="flex gap-2">
			<button
				name="value"
				value="no"
				aria-pressed={vote === 'no'}
				class="flex-1 rounded-xl px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 {vote ===
				'no'
					? 'bg-rose-600 text-white'
					: 'border border-neutral-300 dark:border-neutral-700'}"
			>
				No
			</button>
			<button
				name="value"
				value="yes"
				aria-pressed={vote === 'yes'}
				class="flex-1 rounded-xl px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 {vote ===
				'yes'
					? 'bg-emerald-600 text-white'
					: 'border border-neutral-300 dark:border-neutral-700'}"
			>
				Yes
			</button>
		</form>
	</section>

	{#if data.movie.status === 'pool'}
		<form method="POST" action="?/remove" use:enhance>
			<Confirm
				label="Remove from the pool"
				confirmLabel="Remove it"
				question="Duplicate, joke, or already seen? Everyone's swipes are kept, so re-suggesting restores it."
				variant="quiet"
			/>
		</form>
	{/if}
</div>
