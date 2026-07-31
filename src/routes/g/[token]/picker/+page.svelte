<!--
	Member picker — "A list of existing member names — tap yours to claim it" plus
	"I'm new here".

	Taking a name is taking a seat at the table, so each name is a whole-row
	control: raised board stock that presses down when tapped. Adding yourself is
	the empty seat next to them — a slot, not a component, until you fill it in.

	Big tap targets, one form, no JavaScript required. There is deliberately no
	credential: app-spec lists "a friend can pick someone else's name" as an
	accepted risk in exchange for zero-friction entry.
-->
<script lang="ts">
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let addingNew = $state(false);
</script>

<div class="space-y-5">
	<div>
		<p class="eyebrow text-brass">Take a seat</p>
		<h2 class="display mt-1 text-[1.75rem] text-board">Who are you?</h2>
		<p class="mt-1.5 text-sm leading-relaxed text-chalk-dim">
			Tap your name to sign in on this device. It'll remember you.
		</p>
	</div>

	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}

	<form method="POST" action="?/claim" class="space-y-2.5">
		{#if data.members.length > 0}
			<!-- The seats deal in top to bottom; keyed by member id, so a live
			     refresh (someone else joining) only deals the new arrival. -->
			<ul class="space-y-2.5">
				{#each data.members as member, i (member.id)}
					<li class="deal-in" style="--deal:{i}">
						<button
							name="member_id"
							value={member.id}
							class="tile tile-press flex w-full items-center gap-2 px-3.5 py-3.5 text-left"
						>
							<span class="min-w-0 flex-1">
								<span class="display block truncate text-[1.15rem] text-ink">
									{member.displayName}
								</span>
								{#if member.id === data.currentMemberId}
									<span class="stencil block text-[0.7rem] tracking-[0.06em] text-ink-soft uppercase">
										Signed in on this device
									</span>
								{/if}
							</span>
							<ArrowRight size={18} class="shrink-0 text-ink-soft" />
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="tile-slot px-4 py-7 text-center text-sm text-chalk-dim">
				Nobody has joined yet — you're first. Put your name in below.
			</p>
		{/if}

		{#if addingNew || data.members.length === 0}
			<div class="pop-settle tile space-y-3 px-3.5 py-3.5">
				<div>
					<label for="new-name" class="field-label text-ink">Your name</label>
					<input
						id="new-name"
						name="name"
						required
						maxlength="80"
						autocomplete="nickname"
						placeholder="Ana"
						class="field"
					/>
				</div>
				<button class="token token-lg token-brass w-full">
					Join the group
					<ArrowRight size={18} />
				</button>
			</div>
		{:else}
			<button
				type="button"
				onclick={() => (addingNew = true)}
				class="token token-lg token-slot w-full"
			>
				I'm new here
			</button>
		{/if}
	</form>
</div>
