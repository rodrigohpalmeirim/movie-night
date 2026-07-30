<!--
	Settings — any member can edit everything here (app-spec design principle 1).

	Includes the TMDB attribution line, which is a condition of their free API.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Confirm from '$lib/components/Confirm.svelte';
	import { formatDate } from '$lib/images.js';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const inviteUrl = $derived(
		`${typeof location === 'undefined' ? '' : location.origin}/g/${data.settings.inviteToken}`
	);
	let copied = $state(false);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	const KNOB_HELP: Record<string, string> = {
		n_finalists: 'How many films reach the head-to-head round. Max 5, so it stays 10 taps.',
		approval_floor: 'Minimum share of yes-votes for a film to be promotable (0–1).',
		coverage_floor: 'Minimum share of attendees who must have swiped a film (0–1).',
		veto_threshold: 'How many vetoes disqualify a finalist. 1 suits five friends, more suits twenty.',
		rewatch_cooldown: 'Days before a watched film can return. Leave blank for never.',
		min_attendee_votes: 'Minimum swipes on a film for it to be eligible at all.'
	};
	const KNOB_LABELS: Record<string, string> = {
		n_finalists: 'Finalists',
		approval_floor: 'Approval floor',
		coverage_floor: 'Coverage floor',
		veto_threshold: 'Veto threshold',
		rewatch_cooldown: 'Re-watch cooldown (days)',
		min_attendee_votes: 'Minimum swipes'
	};
</script>

<div class="space-y-8">
	<h2 class="text-xl font-bold tracking-tight">Settings</h2>

	{#if form?.message}
		<p role="alert" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
			{form.message}
		</p>
	{/if}
	{#if form && 'saved' in form && form.saved}
		<p role="status" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
			Saved. Changes apply from the next time finalists are picked — never to a round already in
			progress.
		</p>
	{/if}

	<!-- ── Invite link ───────────────────────────────────────────────── -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">Invite link</h3>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Anyone with this link can join and vote. It is the only credential — share it in the group
			chat, not in public.
		</p>
		<div class="flex gap-2">
			<input
				readonly
				value={inviteUrl}
				aria-label="Invite link"
				class="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
			/>
			<button
				type="button"
				onclick={copyLink}
				class="shrink-0 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700"
			>
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
		<form method="POST" action="?/regenerateLink">
			<Confirm
				label="Regenerate invite link"
				confirmLabel="Yes, replace the link"
				question="The old link stops working immediately. Everyone will need the new one — but devices already signed in stay signed in."
				variant="quiet"
			/>
		</form>
	</section>

	<!-- ── Group name + knobs ────────────────────────────────────────── -->
	<form method="POST" action="?/save" use:enhance class="space-y-5">
		<section class="space-y-2">
			<label for="group-name" class="block text-sm font-semibold">Group name</label>
			<input
				id="group-name"
				name="name"
				value={data.settings.name}
				maxlength="80"
				class="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
			/>
		</section>

		<section class="space-y-3">
			<h3 class="text-sm font-semibold">Voting knobs</h3>
			{#each Object.entries(data.knobRanges) as [knob, range] (knob)}
				<div class="space-y-1">
					<label for="knob-{knob}" class="block text-sm font-medium">{KNOB_LABELS[knob]}</label>
					<input
						id="knob-{knob}"
						name={knob}
						type="number"
						inputmode="decimal"
						min={range.min}
						max={range.max}
						step={range.integer ? 1 : 0.05}
						value={data.settings.config[knob as keyof typeof data.settings.config] ?? ''}
						aria-describedby="help-{knob}"
						class="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-base tabular-nums focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
					/>
					<p id="help-{knob}" class="text-xs text-neutral-500 dark:text-neutral-400">
						{KNOB_HELP[knob]} Allowed: {range.min}–{range.max}{range.nullable ? ', or blank' : ''}.
					</p>
				</div>
			{/each}
		</section>

		<button
			class="w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
		>
			Save settings
		</button>
	</form>

	<!-- ── Members ───────────────────────────────────────────────────── -->
	<section class="space-y-3">
		<h3 class="text-sm font-semibold">Members</h3>
		<ul class="divide-y divide-neutral-200 rounded-xl border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
			{#each data.settings.members as member (member.id)}
				<li class="flex items-center justify-between gap-2 px-3 py-2">
					<span class="truncate">{member.displayName}</span>
					<span class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
						joined {formatDate(member.joinedAt)}
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Members are never deleted — history refers to them.
		</p>

		<form method="POST" action="?/renameSelf" use:enhance class="space-y-2">
			<label for="display-name" class="block text-sm font-medium">Your display name</label>
			<div class="flex gap-2">
				<input
					id="display-name"
					name="display_name"
					value={data.settings.me.displayName}
					maxlength="80"
					class="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 text-base focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
				/>
				<button
					class="shrink-0 rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-neutral-700"
					>Rename</button
				>
			</div>
		</form>
	</section>

	<!-- ── This device ───────────────────────────────────────────────── -->
	<section class="space-y-2">
		<h3 class="text-sm font-semibold">This device</h3>
		<p class="text-xs text-neutral-500 dark:text-neutral-400">
			Signed in as {data.settings.me.displayName}.
		</p>
		<form method="POST" action="?/forget">
			<Confirm
				label="Not you?"
				confirmLabel="Sign out on this device"
				question="This forgets who you are on this device and returns to the name picker. Your votes stay."
				variant="quiet"
			/>
		</form>
	</section>

	<!-- TMDB attribution lives in the app-wide footer (src/routes/+layout.svelte),
	     so it is on every screen rather than only this one. -->
</div>
