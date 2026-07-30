<!--
	Landing — "Create a group; nothing else."

	A plain form action, so it works with JavaScript off. The invite link that
	comes back is the whole authentication story, which the copy says out loud.
-->
<script lang="ts">
	import type { ActionData } from './$types';
	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Movie Night</title>
	<meta name="description" content="Pick what to watch, together." />
</svelte:head>

<main class="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-8 px-6 py-12">
	<div class="space-y-2">
		<h1 class="text-3xl font-bold tracking-tight">Movie Night</h1>
		<p class="text-neutral-600 dark:text-neutral-300">
			Keep a shared pool of film suggestions. On the night, everyone swipes, vetoes once, and
			picks between the finalists. The app works out what you all actually want to watch.
		</p>
	</div>

	<form method="POST" action="?/createGroup" class="space-y-4">
		<div class="space-y-1">
			<label for="name" class="block text-sm font-medium">What's the group called?</label>
			<input
				id="name"
				name="name"
				required
				maxlength="80"
				autocomplete="off"
				placeholder="Thursday Films"
				class="w-full rounded-xl border border-neutral-300 px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
			/>
		</div>

		<div class="space-y-1">
			<label for="member_name" class="block text-sm font-medium">And your name?</label>
			<input
				id="member_name"
				name="member_name"
				required
				maxlength="80"
				autocomplete="nickname"
				placeholder="Ana"
				class="w-full rounded-xl border border-neutral-300 px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
			/>
		</div>

		{#if form?.message}
			<p role="alert" class="text-sm font-medium text-rose-600 dark:text-rose-400">{form.message}</p>
		{/if}

		<button
			class="w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
		>
			Create the group
		</button>
	</form>

	<p class="text-xs text-neutral-500 dark:text-neutral-400">
		You'll get a secret link to share. Anyone with the link can join and vote — there are no
		accounts or passwords, so keep it to the group chat.
	</p>
</main>
