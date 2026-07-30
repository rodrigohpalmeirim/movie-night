<!--
	Member picker — "A list of existing member names — tap yours to claim it" plus
	"I'm new here".

	Big tap targets, one form, no JavaScript required. There is deliberately no
	credential: app-spec lists "a friend can pick someone else's name" as an
	accepted risk in exchange for zero-friction entry.
-->
<script lang="ts">
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let addingNew = $state(false);
</script>

<div class="space-y-6">
	<div class="space-y-1">
		<h2 class="text-xl font-bold tracking-tight">Who are you?</h2>
		<p class="text-sm text-neutral-600 dark:text-neutral-300">
			Tap your name to sign in on this device. It'll remember you.
		</p>
	</div>

	{#if form?.message}
		<p role="alert" class="text-sm font-medium text-rose-600 dark:text-rose-400">{form.message}</p>
	{/if}

	<form method="POST" action="?/claim" class="space-y-3">
		{#if data.members.length > 0}
			<ul class="space-y-2">
				{#each data.members as member (member.id)}
					<li>
						<button
							name="member_id"
							value={member.id}
							class="w-full rounded-xl border border-neutral-300 px-4 py-4 text-left text-lg font-semibold hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
						>
							{member.displayName}
							{#if member.id === data.currentMemberId}
								<span class="ml-1 text-xs font-normal text-neutral-500">· currently signed in</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-neutral-500 dark:text-neutral-400">
				Nobody has joined yet — you're first.
			</p>
		{/if}

		{#if addingNew || data.members.length === 0}
			<div class="space-y-2 rounded-xl border border-indigo-300 p-3 dark:border-indigo-800">
				<label for="new-name" class="block text-sm font-medium">Your name</label>
				<input
					id="new-name"
					name="name"
					required
					maxlength="80"
					autocomplete="nickname"
					class="w-full rounded-xl border border-neutral-300 px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
				/>
				<button
					class="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
				>
					Join the group
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={() => (addingNew = true)}
				class="w-full rounded-xl border border-dashed border-neutral-400 px-4 py-4 text-base font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
			>
				I'm new here
			</button>
		{/if}
	</form>
</div>
