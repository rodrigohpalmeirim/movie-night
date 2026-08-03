<!--
	Settings — any member can edit everything here (app-spec design principle 1).

	The rules insert that ships in the box: four flat pads, each with a stencilled
	header ruled off in ink, holding punched blanks you write into. Nothing here is
	raised except the buttons, because nothing here is pressable except the
	buttons — this screen is where the old lift-everything treatment read worst.

	Ends with the TMDB attribution, which is a condition of their free API. This
	is its permanent home — a colophon at the foot of the rules insert — while the
	suggest sheet carries it where the data is actually used.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import Confirm from '$lib/components/Confirm.svelte';
	import Check from '$lib/icons/Check.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatDate } from '$lib/images.js';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	/**
	 * Every field on this screen is a *current value*, not a blank to fill in, so a
	 * successful save must leave the value on screen — never wipe the form.
	 *
	 * `use:enhance`'s default is `reset: true`, which calls `form.reset()`. That
	 * restores each input's `defaultValue`, i.e. its `value` **content attribute** —
	 * and Svelte sets `value` as a DOM *property*, so on a client-side navigation
	 * (arriving here via the tab bar) the attribute was never written and every
	 * field resets to empty. Even on a hydrated load it would restore the
	 * pre-edit text. Either way the fields lie until a reload.
	 *
	 * So: keep the values, and let the (default) `invalidateAll` re-run `load` so
	 * what stays on screen is what the server actually stored.
	 */
	const keepValues: SubmitFunction = () => async ({ update }) => update({ reset: false });

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
		rewatch_cooldown: 'Days before a watched film can return. Leave blank for never.'
	};
	const KNOB_LABELS: Record<string, string> = {
		n_finalists: 'Finalists',
		approval_floor: 'Approval floor',
		coverage_floor: 'Coverage floor',
		veto_threshold: 'Veto threshold',
		rewatch_cooldown: 'Re-watch cooldown (days)'
	};
</script>

<div class="space-y-5">
	<div>
		<p class="eyebrow text-brass">House rules</p>
		<h2 class="display mt-1 text-[1.75rem] text-board">Settings</h2>
	</div>

	{#if form?.message}
		<p role="alert" class="notice notice-cherry">
			<TriangleAlert size={17} class="mt-px shrink-0" />
			{form.message}
		</p>
	{/if}
	{#if form && 'saved' in form && form.saved}
		<p role="status" class="notice notice-jade">
			<Check size={17} class="mt-px shrink-0" />
			Saved. Changes apply from the next time finalists are picked — never to a round already in
			progress.
		</p>
	{/if}

	<!-- ── Invite link ───────────────────────────────────────────────── -->
	<section class="tile space-y-3 px-3 py-3">
		<div>
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Invite link</h3>
			<p class="mt-2 text-xs leading-relaxed text-ink-soft">
				Anyone with this link can join and vote. It is the only credential — share it in the group
				chat, not in public.
			</p>
		</div>
		<div class="flex gap-2">
			<input
				readonly
				value={inviteUrl}
				aria-label="Invite link"
				class="field min-w-0 flex-1 font-mono text-xs"
			/>
			<button type="button" onclick={copyLink} class="token shrink-0">
				{copied ? 'Copied' : 'Copy'}
			</button>
		</div>
		<form method="POST" action="?/regenerateLink">
			<Confirm
				label="Regenerate invite link"
				confirmLabel="Yes, replace the link"
				question="The old link stops working immediately. Everyone will need the new one — but devices already signed in stay signed in."
				variant="quiet"
			size="md"
			/>
		</form>
	</section>

	<!-- ── Group name + knobs ────────────────────────────────────────── -->
	<form method="POST" action="?/save" use:enhance={keepValues} class="space-y-5">
		<section class="tile space-y-3 px-3 py-3">
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">The group</h3>
			<div>
				<label for="group-name" class="field-label text-ink">Group name</label>
				<input
					id="group-name"
					name="name"
					value={data.settings.name}
					maxlength="80"
					class="field"
				/>
			</div>
		</section>

		<section class="tile space-y-3.5 px-3 py-3">
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Voting knobs</h3>
			{#each Object.entries(data.knobRanges) as [knob, range] (knob)}
				<div>
					<label for="knob-{knob}" class="field-label text-ink">{KNOB_LABELS[knob]}</label>
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
						class="field tabular-nums"
					/>
					<p id="help-{knob}" class="mt-1 text-xs leading-relaxed text-ink-soft">
						{KNOB_HELP[knob]} Allowed: {range.min}–{range.max}{range.nullable ? ', or blank' : ''}.
					</p>
				</div>
			{/each}
			<button class="token token-lg token-brass w-full">Save settings</button>
		</section>
	</form>

	<!-- ── Members ───────────────────────────────────────────────────── -->
	<section class="tile space-y-3 px-3 py-3">
		<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Members</h3>
		<!-- The roster, ruled like the round screen's: same pad, same tear lines. -->
		<ul class="divide-y-2 divide-dashed divide-board-shade border-y-2 border-dashed border-board-shade">
			{#each data.settings.members as member, i (member.id)}
				<li class="deal-in flex items-baseline justify-between gap-2 py-2" style="--deal:{i}">
					<span class="truncate text-sm font-medium text-ink">{member.displayName}</span>
					<span class="stencil shrink-0 text-[0.7rem] text-ink-soft uppercase">
						joined {formatDate(member.joinedAt)}
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-xs leading-relaxed text-ink-soft">
			Members are never deleted — history refers to them.
		</p>

		<form method="POST" action="?/renameSelf" use:enhance={keepValues}>
			<label for="display-name" class="field-label text-ink">Your display name</label>
			<div class="flex gap-2">
				<input
					id="display-name"
					name="display_name"
					value={data.settings.me.displayName}
					maxlength="80"
					class="field min-w-0 flex-1"
				/>
				<button class="token shrink-0">Rename</button>
			</div>
		</form>
	</section>

	<!-- ── This device ───────────────────────────────────────────────── -->
	<section class="tile space-y-3 px-3 py-3">
		<div>
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">This device</h3>
			<p class="mt-2 text-xs leading-relaxed text-ink-soft">
				Signed in as {data.settings.me.displayName}. Handing the phone on? This forgets who you are on
				this device and goes back to the name picker. Your votes stay where they are.
			</p>
		</div>
		<!-- No confirm step, unlike the regenerate above: nothing is spent by taking
		     this door. It clears the cookie and lands on the picker, where picking a
		     name — the same one, even — is the way back. The guarded two-stage
		     pattern is for the one-way moves only, and the picker is not one. -->
		<form method="POST" action="?/forget">
			<button class="token w-full">Not you?</button>
		</form>
	</section>

	<!-- The credit's permanent home: printed on the felt below the pads, in the
	     dim chalk the app uses for small print on the table. -->
	<p class="px-1 text-[11px] leading-relaxed text-chalk-dim">
		This product uses the TMDB API but is not endorsed or certified by TMDB. Film data and posters
		courtesy of
		<a href="https://www.themoviedb.org/" rel="noreferrer" class="underline">The Movie Database</a>.
	</p>
</div>
