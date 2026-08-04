<!--
	Landing — "Create a group; nothing else."

	The app's first impression, so it is the box lid: the title in wood-type
	slab, the rules of play printed on the side of the box in three steps
	(genuinely a sequence — swiping, vetoing and comparing happen in that
	order), and a certification seal seated in the corner stating the one thing
	people need to know before they start, which is that the link is the only
	credential.

	The form is a plain action, so it works with JavaScript off, and the two
	fields are punched blanks in the lid rather than components sitting on it.
-->
<script lang="ts">
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	/** The three phases of a night, in the order they happen. */
	const steps = [
		{ n: '1', title: 'Swipe the pool', note: 'Yes or no, once per film, whenever' },
		{ n: '2', title: 'Veto one film', note: 'The one you genuinely cannot sit through' },
		{ n: '3', title: 'Pick the winner', note: 'Finalists go head to head, two at a time' }
	];
</script>

<svelte:head>
	<title>Movie Night</title>
	<meta name="description" content="Pick what to watch, together." />
</svelte:head>

<!--
	The document itself cannot scroll (see app.css), so this screen carries its own
	scroll region — it is the one page outside the group shell, which has one of
	its own. `min-h-full` rather than `h-full`: the lid is centred on a phone that
	has room for it, and on one that has not the column simply grows past the
	region and scrolls, instead of centring itself and cutting off the top.
-->
<div class="h-full overflow-x-clip overflow-y-auto overscroll-contain">
	<main class="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-5 px-4 py-8">
		<!-- ── The lid ───────────────────────────────────────────────────── -->
		<section class="tile relative px-4 pt-4 pb-4">
			<p class="eyebrow text-ink-soft">A game for the group chat</p>
			<h1 class="display mt-1.5 text-[2.6rem] leading-[0.95] text-ink">
				Movie<br />Night
			</h1>
			<div class="mt-3 h-[3px] bg-ink"></div>
			<div class="mt-[3px] border-t-2 border-dashed border-board-shade"></div>
			<p class="mt-3 max-w-[21rem] text-sm leading-relaxed text-ink">
				Keep one shared pool of film suggestions. On the night the group swipes, vetoes once, and picks
				between the finalists — and the app works out what everyone actually wants to watch.
			</p>

			<!-- Rules of play, printed on the box. -->
			<ol class="mt-4 space-y-2 border-t-2 border-dashed border-board-shade pt-3.5">
				{#each steps as step (step.n)}
					<li class="flex items-baseline gap-2.5">
						<span
							class="display flex size-6 shrink-0 items-center justify-center rounded-sm border-2 border-ink bg-brass text-[0.8rem] leading-none text-ink"
							aria-hidden="true">{step.n}</span
						>
						<span class="min-w-0">
							<span class="stencil block text-sm font-semibold text-ink uppercase">{step.title}</span>
							<span class="block text-xs leading-snug text-ink-soft">{step.note}</span>
						</span>
					</li>
				{/each}
			</ol>

			<!-- The screen's one seal: the certification mark on the lid. -->
			<div class="pointer-events-none absolute -top-3 -right-2">
				<Stamp word="No logins" note="the link is the key" tone="brass" size="0.9rem" rotate={7} />
			</div>
		</section>

		<!-- ── Set up ────────────────────────────────────────────────────── -->
		<form method="POST" action="?/createGroup" class="tile space-y-3.5 px-4 py-4">
			<h2 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Set up a group</h2>

			<div>
				<label for="name" class="field-label text-ink">What's the group called?</label>
				<input
					id="name"
					name="name"
					required
					maxlength="80"
					autocomplete="off"
					placeholder="Thursday Films"
					class="field"
				/>
			</div>

			<div>
				<label for="member_name" class="field-label text-ink">And your name?</label>
				<input
					id="member_name"
					name="member_name"
					required
					maxlength="80"
					autocomplete="nickname"
					placeholder="Ana"
					class="field"
				/>
			</div>

			{#if form?.message}
				<p role="alert" class="notice notice-cherry">
					<TriangleAlert size={17} class="mt-px shrink-0" />
					{form.message}
				</p>
			{/if}

			<button class="token token-lg token-brass w-full">
				Create the group
				<ArrowRight size={18} />
			</button>
		</form>

		<p class="px-1 text-xs leading-relaxed text-chalk-dim">
			You'll get a secret link to share. Anyone with the link can join and vote — there are no accounts
			and no passwords, so keep it to the group chat.
		</p>
	</main>
</div>
