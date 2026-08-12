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
	import { settingsDraft, type SettingsValues } from '$lib/settings-draft.svelte.js';
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
	/**
	 * How far a share's thumb moves in one stop: a whole 5%, so every stop prints as
	 * a round number. Named because the rail's step and the ruler's mark count are
	 * the same fact said twice, and a scale that marks stops the input cannot land
	 * on is a lying scale.
	 */
	const SHARE_STEP = 0.05;
	/** The one knob whose rail walks a ladder of labels instead of its own units. */
	const LADDER_KNOB = 'rewatch_cooldown';

	type ConfigKey = keyof PageServerData['settings']['config'];

	/**
	 * The save form as the SERVER currently has it, in the units the controls speak.
	 *
	 * Two knobs are read through a translation, and both translations are the same
	 * promise: A RAIL SHOWS WHAT IT CAN REACH. The cooldown's stored days become the
	 * nearest rung of its ladder, and every other knob is clamped into its own range,
	 * because a stored number outside it (a `veto_threshold` of 12, saved when the
	 * ceiling was 50) would otherwise print beside a thumb parked somewhere else —
	 * the browser clamps the input, not the label. Saving then writes what the rail
	 * shows, which is the one place such a value is ever rounded.
	 *
	 * A function rather than a `$derived`, because it is wanted at two quite
	 * different moments: once to seed the controls, and again on every load after
	 * that to tell the draft store what it is being compared against.
	 */
	function serverValues(): SettingsValues {
		return {
			name: data.settings.name,
			knobs: Object.fromEntries(
				Object.entries(data.knobRanges).map(([knob, range]) => [
					knob,
					knob === LADDER_KNOB
						? cooldownIndex(data.settings.config.rewatch_cooldown)
						: Math.min(
								Math.max(Number(data.settings.config[knob as ConfigKey]), range.min),
								range.max
							)
				])
			),
			vetoesEnabled: data.settings.config.vetoes_enabled
		};
	}

	/**
	 * Where this form starts: the edits left behind last time this screen was open,
	 * if the member never saved them, and otherwise what the server says.
	 *
	 * Unsaved edits surviving a tab hop is the whole point of `$lib/settings-draft` —
	 * the page's own runes die on a client-side navigation, the module's do not. See
	 * that file for the lifetime and for why it is not a SvelteKit snapshot.
	 */
	// svelte-ignore state_referenced_locally
	const seed = settingsDraft.read(data.settings.inviteToken) ?? serverValues();

	/**
	 * What each control currently reads: the name in its field, the number beside
	 * each label as the thumb moves it, and which side of the veto switch is down.
	 * Seeded ONCE, and then owned by the controls.
	 *
	 * Deliberately not `$derived`: `load` re-runs on every save and on every SSE ping
	 * the group emits, and a value recomputed from `data` would yank the thumb back
	 * to the stored number mid-drag because somebody else swiped a card. Seeding once
	 * is also what `keepValues` above asks for — after a successful save this state
	 * and the server agree, and after a refused one it still shows what the member
	 * typed, exactly like the text fields that keep their value.
	 */
	let name = $state(seed.name);
	let knobValues = $state<Record<string, number>>({ ...seed.knobs });
	let vetoesEnabled = $state(seed.vetoesEnabled);

	/**
	 * Every load, including the one after our own save, tells the draft store what
	 * the stored settings now are. That is what keeps the tab bar's dot honest: it
	 * lights only while these controls differ from what is actually saved, so a
	 * change somebody else makes to match yours puts it out again.
	 */
	$effect(() => settingsDraft.observe(data.settings.inviteToken, serverValues()));

	/**
	 * One line at the end of every control's own handler, rather than an effect
	 * mirroring the state: a draft is a record of somebody EDITING, and an effect
	 * would also file the untouched form the moment this page mounts.
	 */
	function noteEdit() {
		settingsDraft.write(data.settings.inviteToken, {
			name,
			knobs: { ...knobValues },
			vetoesEnabled
		});
	}

	/**
	 * `keepValues`, plus the one thing only this form knows: a save that the server
	 * accepted means there is nothing unsaved left to remember. A refused one keeps
	 * the draft, because the edits are still only on this screen.
	 */
	const saveSettings: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success') settingsDraft.clear();
		await update({ reset: false });
	};

	/**
	 * Is there anything to save? Asked of the same store the tab bar's dot is drawn
	 * from, so the two readings cannot disagree: while the gear wears a dot the Save
	 * button is live, and the moment the dot goes out — a save landing, another
	 * member saving the same change, or a knob nudged back to where it started, since
	 * the store compares values rather than counting edits — the button goes with it.
	 */
	const dirty = $derived(settingsDraft.isDirty(data.settings.inviteToken));

	/**
	 * False on the server, false through hydration, true from the first effect on —
	 * `Poster`'s gate, put to a different job. NOTHING BELOW MAY DISABLE OR HIDE A
	 * CONTROL WITHOUT IT.
	 *
	 * The draft store is script, and an untouched form is never dirty, so the server
	 * renders this page with `dirty` false every single time. Bake that into the
	 * markup and the HTML shipped to a member with no JavaScript carries a Save
	 * button that is disabled on arrival and has nothing to un-disable it — the one
	 * button this whole screen saves through, dead in the only browser that cannot
	 * work around it. So the disabled state and the discard button both wait for the
	 * client to prove it is running: the served HTML always has a live Save and no
	 * discard, which is exactly right for a page where every edit posts natively.
	 */
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	/**
	 * Every control back to what the server says, and the draft dropped with it, so
	 * the dot goes out. Nothing is posted: this is the same seeding the form does on
	 * load, asked for again — the stored settings never moved, only this screen did.
	 *
	 * No confirm step, unlike the one-way moves above. What it throws away is a
	 * minute of nudging that costs a minute to do again, and a guard on an undo is a
	 * guard on nothing.
	 */
	function discardChanges() {
		const server = serverValues();
		name = server.name;
		knobValues = { ...server.knobs };
		vetoesEnabled = server.vetoesEnabled;
		settingsDraft.clear();
	}

	/**
	 * What each rail read when the finger landed on it, so a touch that turns out to be
	 * a scroll can be given its number back.
	 *
	 * `.rail` is `touch-action: pan-y` (see app.css), so a vertical drag that starts on
	 * a rail scrolls the page — but a native range has already jumped its thumb to the
	 * touch point by then, and the browser ends the gesture with `pointercancel` rather
	 * than undoing it. So the value is recorded on the way down and put back on cancel,
	 * on the INPUT and on `knobValues` both: the printed `<output>` reads from the
	 * latter, and restoring only one of them leaves the label lying about the thumb.
	 *
	 * A deliberate tap or a sideways drag ends in `pointerup`, which is untouched. With
	 * scripting off the rail is simply a rail again — this is enhancement, like the rest
	 * of the app. Keyed per knob because all five rails share the two handlers.
	 */
	const preTouch: Record<string, number> = {};

	function recordKnob(knob: string, input: HTMLInputElement) {
		preTouch[knob] = input.valueAsNumber;
	}

	function restoreKnob(knob: string, input: HTMLInputElement) {
		if (!(knob in preTouch)) return;
		input.valueAsNumber = preTouch[knob];
		knobValues[knob] = preTouch[knob];
		noteEdit();
	}

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

	/**
	 * What a finalist count costs: every pair meets once in the runoff, so n
	 * finalists are n(n-1)/2 taps per attendee. Printed soft beside the number,
	 * because the count is really chosen by the evening it buys.
	 */
	function runoffTaps(n: number) {
		return (n * (n - 1)) / 2;
	}

	/**
	 * How many GAPS to rule along a rail's ruler — see `--rail-steps`; there is
	 * always one more mark than gap. Every rail marks every stop it has, because
	 * every stop is a number the group is choosing BETWEEN, and the scale hangs
	 * below the groove in a soft pencil rather than being ruled through the channel:
	 * twenty-one faint marks under a share read as a scale, where twenty-one marks
	 * across the groove read as grit in it.
	 *
	 * So: a count knob's own stops (four for the finalists, five for the veto), a
	 * rung per wait on the ladder, and every 5% of a share — the step the input
	 * actually moves in, not the tenths the old ruling settled for.
	 */
	function railSteps(knob: string, range: { min: number; max: number }) {
		if (knob === LADDER_KNOB) return COOLDOWN_LADDER.length - 1;
		if (SHARE_KNOBS.includes(knob)) return Math.round((range.max - range.min) / SHARE_STEP);
		return range.max - range.min;
	}

	/**
	 * Vetoes off, in CSS alone: the switch is a native radio, so `:has()` on the row
	 * around it can read which side is held down and take the threshold rail away
	 * without a line of JavaScript — the same terms the switch itself is latched on.
	 */
	const WHEN_VETOES_OFF = 'group-has-[input[value=false]:checked]/veto:hidden';

	const KNOB_HELP: Record<string, string> = {
		n_finalists:
			'How many films reach the head-to-head round.',
		approval_floor: 'Minimum share of yes-votes for a film to be promotable.',
		coverage_floor: 'Minimum share of attendees who must have swiped a film for it to be promotable.',
		veto_threshold:
			'How many vetoes disqualify a finalist. 1 suits five friends, more suits twenty. Off removes the veto step entirely.',
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
				question="The old link stops working immediately. Everyone will need the new one."
				variant="quiet"
			size="md"
			/>
		</form>
	</section>

	<!-- ── Group name + knobs ────────────────────────────────────────── -->
	<form method="POST" action="?/save" use:enhance={saveSettings} class="space-y-5">
		<section class="tile space-y-3 px-3 py-3">
			<h3 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">The group</h3>
			<div>
				<label for="group-name" class="field-label text-ink">Group name</label>
				<!-- Held by the page rather than left to the DOM, like every other control
				     in this form: it is what lets an unsaved name survive a tab hop. The
				     handler sets the value and then files it, in that order, which is why
				     this is not a `bind:` — the draft has to be written from the new text,
				     not from whatever the binding has got round to yet. -->
				<input
					id="group-name"
					name="name"
					value={name}
					oninput={(event) => {
						name = event.currentTarget.value;
						noteEdit();
					}}
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
					     is, how many, whether at all.

					     The finalists' number alone carries a rider — "4 · 6 taps" — since
					     what the group is actually choosing is the length of the runoff. -->
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
											checked={String(vetoesEnabled) === option.value}
											onchange={() => {
												vetoesEnabled = option.value === 'true';
												noteEdit();
											}}
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
								<!-- The {' '} is explicit: whitespace at an {#if} boundary is
								     trimmed by the compiler, and "4· 6 taps" reads glued. -->
								{printed(knob, knobValues[knob])}{#if knob === 'n_finalists'}{@const taps =
										runoffTaps(knobValues[knob])}{' '}<span
										class="font-normal text-ink-soft">· {taps} {taps === 1 ? 'tap' : 'taps'}</span
									>{/if}
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
						step={isLadder || range.integer ? 1 : SHARE_STEP}
						value={knobValues[knob]}
						oninput={(event) => {
							knobValues[knob] = event.currentTarget.valueAsNumber;
							noteEdit();
						}}
						onpointerdown={(event) => recordKnob(knob, event.currentTarget)}
						onpointercancel={(event) => restoreKnob(knob, event.currentTarget)}
						aria-describedby="help-{knob}"
						aria-valuetext={isLadder || SHARE_KNOBS.includes(knob)
							? printed(knob, knobValues[knob])
							: undefined}
						style="--rail-steps:{railSteps(knob, range)}"
						class="rail {isVeto ? WHEN_VETOES_OFF : ''}"
					/>
					<!-- The help line says what a knob MEANS, never what it may be set to:
					     the rail's own ends already say that, and a sentence repeating them
					     only asks to be read twice. It stays put when vetoes go off, too —
					     it is the line that says what Off does. -->
					<p id="help-{knob}" class="mt-1 text-xs leading-relaxed text-ink-soft">
						{KNOB_HELP[knob]}
					</p>
				</div>
			{/each}
			<!-- Save keeps the pad's full width and its brass, because it is the move
			     this whole screen is for; discard is the way back out of an edit, so it
			     is board stock at the standard size directly under it — full width too,
			     with the pairing carried by ink and weight rather than by placement.
			     The reveal screen stacks its two endings the same way ("We watched it"
			     over "We didn't watch it"), and it is the face Confirm gives its `md`
			     size: housekeeping that must not out-shout the move above it.

			     A Save with nothing to save goes inert and says so with opacity, the
			     one exception `.token` makes for something unpressable (see app.css);
			     it keeps its lift rather than sitting flush, since flush is the pose a
			     LATCHED token holds and an inert button is not a held press.

			     Discard leaves entirely when there is nothing to discard: a disabled
			     token under a disabled token is two dimmed shapes saying one thing.
			     Both are gated on `hydrated` — see above, it is what keeps this form
			     saveable with scripting off. -->
			<div class="space-y-2.5">
				<button disabled={hydrated && !dirty} class="token token-lg token-brass w-full">
					Save settings
				</button>
				{#if hydrated && dirty}
					<button type="button" onclick={discardChanges} class="token w-full">
						Discard changes
					</button>
				{/if}
			</div>
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
			ever deleted — you can restore them later.
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
				Signed in as {data.settings.me.displayName}. Handing the phone on? Go back to the name picker. Your votes stay where they are.
			</p>
		</div>
		<!-- No confirm step, unlike the regenerate above: nothing is spent by taking
		     this door. It clears the cookie and lands on the picker, where picking a
		     name — the same one, even — is the way back. The guarded two-stage
		     pattern is for the one-way moves only, and the picker is not one. -->
		<form method="POST" action="?/forget">
			<button class="token w-full">Not you?</button>
		</form>
		<p class="mt-6 text-xs leading-relaxed text-ink-soft">
			Want to switch groups? See your previously joined groups or create a new one.
		</p>
		<!-- The door out to the other tables, and the only way back to the create
		     form once this device belongs to a group: `/` walks a one-group device
		     straight back in here, so `?all` is what asks it to show the list
		     instead. A full token at the same weight as "Not you?", because it is
		     one of this pad's two moves — and the label names the half people
		     actually come for, since nothing else on this screen says where a
		     second group gets made. -->
		<a href="/?all" class="token w-full">Other groups</a>
	</section>

	<!-- The credit's permanent home: printed on the felt below the pads, in the
	     dim chalk the app uses for small print on the table. -->
	<p class="px-1 text-[11px] leading-relaxed text-chalk-dim">
		This app uses the TMDB API but is not endorsed or certified by TMDB. Film data and posters
		courtesy of
		<a href="https://www.themoviedb.org/" rel="noreferrer" class="underline">The Movie Database</a>.
	</p>

	<!-- The maker's line, same small print. `noreferrer` on every outbound link
	     down here, as always: the page URL carries the invite token. -->
	<p class="px-1 text-[11px] leading-relaxed text-chalk-dim">
		Made with ❤️ by
		<a href="https://github.com/rodrigohpalmeirim" rel="noreferrer" class="underline"
			>Rodrigo Palmeirim</a
		>. Free and open source under
		<a
			href="https://github.com/rodrigohpalmeirim/movie-night/blob/main/LICENSE"
			rel="noreferrer"
			class="underline">AGPL-3.0</a
		>
		—
		<a href="https://github.com/rodrigohpalmeirim/movie-night" rel="noreferrer" class="underline"
			>source on GitHub</a
		>.
	</p>
</div>
