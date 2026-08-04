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
	import {
		COOLDOWN_FIELD,
		COOLDOWN_LADDER,
		cooldownIndex,
		cooldownLabel
	} from '$lib/cooldown.js';
	import Confirm from '$lib/components/Confirm.svelte';
	import Check from '$lib/icons/Check.svelte';
	import ChevronRight from '$lib/icons/ChevronRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import { formatDate } from '$lib/images.js';
	import { createLatch } from '$lib/latch.svelte.js';
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

	/**
	 * Removal and restore are one form per person, so each needs its own control
	 * group: taking Ana off the roster must not stiffen the token next to Ben.
	 *
	 * Only the pending half of the latch is used here. There is no held-down state
	 * to draw optimistically — the outcome of these two forms is a row moving from
	 * one list to the other, and the row is not the thing under the finger. So the
	 * press just goes inert until the action settles, at which point `update()` has
	 * re-run `load` and the lists already say what happened.
	 */
	const byMember = (data: FormData) => String(data.get('member_id'));
	const removal = createLatch<true>(() => true, byMember);
	const restore = createLatch<true>(() => true, byMember);

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

	/** The two knobs that are a SHARE of something, printed as a percentage. */
	const SHARE_KNOBS = ['approval_floor', 'coverage_floor'];
	/** The one knob whose rail walks a ladder of labels instead of its own units. */
	const LADDER_KNOB = 'rewatch_cooldown';

	type ConfigKey = keyof PageServerData['settings']['config'];

	/**
	 * What each slider currently reads, so the number beside its label can move with
	 * the thumb. Seeded ONCE from the loaded settings and then owned by the thumb.
	 *
	 * Deliberately not `$derived`: `load` re-runs on every save and on every SSE ping
	 * the group emits, and a value recomputed from `data` would yank the thumb back
	 * to the stored number mid-drag because somebody else swiped a card. Seeding once
	 * is also what `keepValues` below asks for — after a successful save this state
	 * and the server agree, and after a refused one it still shows what the member
	 * typed, exactly like the text fields that keep their value.
	 *
	 * Two knobs are seeded through a translation, and both translations are the same
	 * promise: A RAIL SHOWS WHAT IT CAN REACH. The cooldown's stored days become the
	 * nearest rung of its ladder, and every other knob is clamped into its own range,
	 * because a stored number outside it (a `veto_threshold` of 12, saved when the
	 * ceiling was 50) would otherwise print beside a thumb parked somewhere else —
	 * the browser clamps the input, not the label. Saving then writes what the rail
	 * shows, which is the one place such a value is ever rounded.
	 */
	// svelte-ignore state_referenced_locally
	let knobValues = $state<Record<string, number>>(
		Object.fromEntries(
			Object.entries(data.knobRanges).map(([knob, range]) => [
				knob,
				knob === LADDER_KNOB
					? cooldownIndex(data.settings.config.rewatch_cooldown)
					: Math.min(
							Math.max(Number(data.settings.config[knob as ConfigKey]), range.min),
							range.max
						)
			])
		)
	);

	/**
	 * What a knob prints beside its label. A share prints as the percentage everybody
	 * says out loud — "40%", not "0.40" — while the field still posts the 0–1 the
	 * server has always stored; the step is 0.05, so every stop is a whole 5%. The
	 * cooldown prints its rung's words. Everything else is the count it is.
	 */
	function printed(knob: string, value: number) {
		if (knob === LADDER_KNOB) return cooldownLabel(value);
		if (SHARE_KNOBS.includes(knob)) return `${Math.round(value * 100)}%`;
		return String(value);
	}

	/** The range in the help line, in the same units the number above it prints. */
	function allowed(knob: string, range: { min: number; max: number }) {
		// The ladder IS its range: every wait it allows is written on the rail.
		if (knob === LADDER_KNOB) return '';
		if (SHARE_KNOBS.includes(knob)) return ' Allowed: 0–100%.';
		return ` Allowed: ${range.min}–${range.max}.`;
	}

	/**
	 * How many gaps to rule along a rail — see `--rail-steps`. A count knob marks
	 * every stop it has, and the ladder marks every rung, because those are the
	 * numbers a group is choosing BETWEEN. The shares would come to twenty-one marks
	 * on a phone's width, which is hatching rather than a scale, so they are ruled at
	 * every tenth: ten gaps, a mark every 10%, and the odd 5% stops sit between two.
	 */
	function railSteps(knob: string, range: { min: number; max: number }) {
		if (knob === LADDER_KNOB) return COOLDOWN_LADDER.length - 1;
		if (SHARE_KNOBS.includes(knob)) return 10;
		return range.max - range.min;
	}

	/**
	 * Vetoes off, in CSS alone: the switch is a native radio, so `:has()` on the row
	 * around it can read which side is held down and take the threshold rail away
	 * without a line of JavaScript — the same terms the switch itself is latched on.
	 */
	const WHEN_VETOES_OFF = 'group-has-[input[value=false]:checked]/veto:hidden';

	const KNOB_HELP: Record<string, string> = {
		n_finalists: 'How many films reach the head-to-head round. Max 5, so it stays 10 taps.',
		approval_floor: 'Minimum share of yes-votes for a film to be promotable.',
		coverage_floor: 'Minimum share of attendees who must have swiped a film.',
		veto_threshold:
			'How many vetoes disqualify a finalist. 1 suits five friends, more suits twenty. Off removes the step entirely: nobody is asked to strike a film, and the runoff is the head-to-heads alone.',
		rewatch_cooldown:
			'How long a watched film waits before it can be suggested again, with its standing votes restored. Forever keeps it out for good.'
	};
	const KNOB_LABELS: Record<string, string> = {
		n_finalists: 'Finalists',
		approval_floor: 'Approval floor',
		coverage_floor: 'Coverage floor',
		veto_threshold: 'Veto threshold',
		rewatch_cooldown: 'Re-watch cooldown'
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
	{#if form && 'removed' in form && form.removed}
		<p role="status" class="notice notice-jade">
			<Check size={17} class="mt-px shrink-0" />
			{form.removed} is off the roster. Nothing they added is gone — restore them under Removed
			whenever.
		</p>
	{/if}
	{#if form && 'restored' in form && form.restored}
		<p role="status" class="notice notice-jade">
			<Check size={17} class="mt-px shrink-0" />
			{form.restored} is back. Every vote, star and suggestion they made counts again.
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
				{@const isVeto = knob === 'veto_threshold'}
				{@const isLadder = knob === LADDER_KNOB}
				<!-- The veto row is the one that carries its own switch, so it is the one
				     that is a `group`: everything inside it that only exists while vetoes
				     do says so with `WHEN_VETOES_OFF`. -->
				<div class={isVeto ? 'group/veto min-w-0' : 'min-w-0'}>
					<!-- A slider hides its number, so the number is printed on the label
					     line and moves with the thumb. `<output>` is the element for a
					     value the page calculates, and it is rendered server-side from the
					     stored setting: with scripting off it simply stays put while the
					     thumb moves, which is a static number rather than a broken one.

					     Every knob but the veto prints it at the far end of that line. The
					     veto prints it INLINE, right after the label — "Veto threshold · 3" —
					     because the end of ITS line belongs to the switch, and read in that
					     order the row says the setting in the order it is decided: what it
					     is, how many, whether at all. -->
					<div class="mb-1 flex items-center justify-between gap-2">
						<span class="flex min-w-0 items-center gap-1.5">
							<label for="knob-{knob}" class="field-label mb-0 text-ink">{KNOB_LABELS[knob]}</label>
							{#if isVeto}
								<!-- Leaves with the rail: struck out, there is no threshold to
								     print, and the label on its own still names the row. -->
								<span class="flex items-center gap-1.5 {WHEN_VETOES_OFF}">
									<span aria-hidden="true" class="text-ink-soft">·</span>
									<output
										for="knob-{knob}"
										class="stencil text-sm font-semibold text-ink tabular-nums"
									>
										{printed(knob, knobValues[knob])}
									</output>
								</span>
							{/if}
						</span>
						{#if isVeto}
							<!-- The one knob that is a rule rather than a quantity, so the one
							     drawn as a pair of latched tokens instead of a slider — and drawn
							     at the end of the threshold's own label line, because the rule and
							     the number it governs are one setting. Sized like the roster's
							     IN/OUT pair, which is the same gesture at the same weight. Two
							     native radios do the latching through `.token-latch`, so the marked
							     option is marked with JavaScript off, and it posts as an ordinary
							     field in this same form, saved by the same button. -->
							<fieldset class="flex shrink-0 gap-1.5">
								<legend class="sr-only">Vetoes</legend>
								{#each [{ value: 'true', label: 'On', ink: 'token-latch-jade' }, { value: 'false', label: 'Off', ink: 'token-latch-cherry' }] as option (option.value)}
									<label
										class="token token-sm token-latch {option.ink} cursor-pointer has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-brass has-[input:focus-visible]:outline-offset-2"
									>
										<input
											type="radio"
											name="vetoes_enabled"
											value={option.value}
											checked={String(data.settings.config.vetoes_enabled) === option.value}
											class="sr-only"
										/>
										{option.label}
									</label>
								{/each}
							</fieldset>
						{:else}
							<output
								for="knob-{knob}"
								class="stencil shrink-0 text-sm font-semibold text-ink tabular-nums"
							>
								{printed(knob, knobValues[knob])}
							</output>
						{/if}
					</div>
					<!-- The cooldown's rail is the one that does not slide along its own
					     units. Days are unslidable (one day per pixel, and no position at
					     all for "never"), so it walks the ladder in `$lib/cooldown.ts` and
					     posts the RUNG; the save action turns that back into days through
					     the same array. Everything else posts the number it shows — a share
					     included, which prints as a percentage but travels as its 0–1.

					     Where the rail's own number is not the answer, the answer is said out
					     loud too: rung 11 is "Forever", not eleven of anything, and 0.4 is
					     announced as the 40% the label prints. -->
					<input
						id="knob-{knob}"
						name={isLadder ? COOLDOWN_FIELD : knob}
						type="range"
						min={isLadder ? 0 : range.min}
						max={isLadder ? COOLDOWN_LADDER.length - 1 : range.max}
						step={isLadder || range.integer ? 1 : 0.05}
						value={knobValues[knob]}
						oninput={(event) => (knobValues[knob] = event.currentTarget.valueAsNumber)}
						aria-describedby="help-{knob}"
						aria-valuetext={isLadder || SHARE_KNOBS.includes(knob)
							? printed(knob, knobValues[knob])
							: undefined}
						style="--rail-steps:{railSteps(knob, range)}"
						class="rail {isVeto ? WHEN_VETOES_OFF : ''}"
					/>
					<!-- The help text stays put when vetoes go off — it is the line that says
					     what Off does — but the range it quotes belongs to the rail, so that
					     half leaves with it. -->
					<p id="help-{knob}" class="mt-1 text-xs leading-relaxed text-ink-soft">
						{KNOB_HELP[knob]}<span class={isVeto ? WHEN_VETOES_OFF : ''}
							>{allowed(knob, range)}</span
						>
					</p>
				</div>
			{/each}
			<button class="token token-lg token-brass w-full">Save settings</button>
		</section>
	</form>

	<!-- ── Members ───────────────────────────────────────────────────── -->
	<section class="tile space-y-3 px-3 py-3">
		<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Members</h3>
		<!-- The roster, ruled like the round screen's: same pad, same tear lines.
		     Keyed by member id, so the live refresh (someone joins, someone is taken
		     off, someone is let back in) only deals genuinely new lines. -->
		<ul class="divide-y-2 divide-dashed divide-board-shade border-y-2 border-dashed border-board-shade">
			{#each data.settings.members as member, i (member.id)}
				{@const isMe = member.id === data.settings.me.id}
				<!-- A line reads name first: the name in ink, the date it was signed in
				     stencilled underneath it like the removed pile's, and the guard at the
				     end of the same line — two lines of print instead of three, so a roster
				     of eight is a paragraph rather than a screen. -->
				<li class="deal-in flex flex-wrap items-center gap-x-2 gap-y-2 py-1.5" style="--deal:{i}">
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium text-ink"
							>{member.displayName}{#if isMe}<span
									class="stencil ml-1 text-[0.65rem] tracking-[0.1em] text-ink-soft uppercase"
									>(you)</span
								>{/if}</span
						>
						<span class="stencil block text-[0.7rem] text-ink-soft uppercase">
							joined {formatDate(member.joinedAt)}
						</span>
					</span>
					<!-- Guarded, like every other move that changes who the group is: the
					     closed face is a small token at the end of the line, and the torn
					     question card opens across the full width of the row, because that
					     is where the consequences are spelled out. Hence the wrap: the form
					     is a shrink-wrapped item until its disclosure is open, at which point
					     it claims the whole line and drops below the name. -->
					<form
						method="POST"
						action="?/removeMember"
						use:enhance={removal.submit}
						class="shrink-0 has-[details[open]]:w-full"
					>
						<input type="hidden" name="member_id" value={member.id} />
						<Confirm
							label={isMe ? 'Leave the group' : `Remove ${member.displayName}`}
							confirmLabel={isMe ? 'Yes, remove me' : `Yes, remove ${member.displayName}`}
							question={isMe
								? 'You come off the roster and your votes stop counting, and this device signs out to the name picker. Your films stay in the pool, history still names you, and anyone here can put you back.'
								: `${member.displayName} comes off the roster and their votes stop counting. Their films stay in the pool, history still names them, and you can restore them here.`}
							variant="quiet"
							size="sm"
							disabled={removal.isPending(member.id)}
						/>
					</form>
				</li>
			{/each}
		</ul>
		<p class="text-xs leading-relaxed text-ink-soft">
			Removing someone takes them off the roster and out of tonight's coverage and count. Nobody is
			ever deleted — history refers to them.
		</p>

		{#if data.settings.removedMembers.length > 0}
			<!-- The other pile: names that are out of the group's present but still all
			     over its past. Quieter than the roster — no rules, no dates in ink —
			     and one tap back in, because restore is the undo and asking twice
			     before undoing something is asking twice for nothing.

			     Folded shut, in the app's own expander: this pile is the exception, so
			     it costs one summary line until somebody actually wants it. The count is
			     on that line, because a folded list that does not say how much it is
			     hiding is a list you have to open to learn nothing. -->
			<details class="group/removed expand -mx-1">
				<summary
					class="eyebrow row-press flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1.5 text-ink-soft select-none hover:text-ink focus-visible:outline-offset-[-3px]"
				>
					<ChevronRight
						size={14}
						class="transition-transform group-open/removed:rotate-90 motion-reduce:transition-none"
					/>
					Removed <span aria-hidden="true">·</span> {data.settings.removedMembers.length}
				</summary>
				<div class="space-y-2 px-1 pt-2">
					<ul class="space-y-2">
						{#each data.settings.removedMembers as member (member.id)}
							<li class="flex items-center justify-between gap-2">
								<span class="min-w-0">
									<span class="block truncate text-sm font-medium text-ink-soft">
										{member.displayName}
									</span>
									<span class="stencil block text-[0.7rem] text-ink-soft uppercase">
										removed {formatDate(member.removedAt)}
									</span>
								</span>
								<form
									method="POST"
									action="?/restoreMember"
									use:enhance={restore.submit}
									class="shrink-0"
								>
									<input type="hidden" name="member_id" value={member.id} />
									<button class="token token-sm" disabled={restore.isPending(member.id)}>
										Restore<span class="sr-only"> {member.displayName}</span>
									</button>
								</form>
							</li>
						{/each}
					</ul>
					<p class="text-xs leading-relaxed text-ink-soft">
						Restoring brings back everything they voted, starred and suggested. Their name cannot be
						taken by anyone else in the meantime.
					</p>
				</div>
			</details>
		{/if}

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
