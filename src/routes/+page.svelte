<!--
	Landing — "Create a group; nothing else", and the switchboard for a device
	that already belongs somewhere.

	The app's first impression, so it is the box lid: the title in wood-type
	slab, the three steps printed on the side of the box (genuinely a sequence —
	a film is suggested, then swiped, then run against the others, in that
	order), and a certification seal seated in the corner stating the one thing
	people need to know before they start, which is that the link is the only
	credential.

	The veto is not on the lid, and that is deliberate: it is a house rule the
	group can switch off in Settings, so it is not one of the three things that
	always happen.

	Its second job: `/` is where the one installed app starts, so it is also the
	page that says which tables this device has a seat at. With one group the load
	redirects and this screen is never seen; the groups only print when there are
	several, or when `?all` asked for them — and they print ABOVE the lid, because
	a returning member came to walk into a room, not to read the box again. With
	none, this is the lid and nothing else.

	The form is a plain action, so it works with JavaScript off, the rows are plain
	links, and the two fields are punched blanks in the lid rather than components
	sitting on it.
-->
<script lang="ts">
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import TriangleAlert from '$lib/icons/TriangleAlert.svelte';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	/** The three phases of a night, in the order they happen. */
	const steps = [
		{ n: '1', title: 'Suggest films', note: 'Anyone can add one to the shared pool, any time' },
		{ n: '2', title: 'Swipe the pool', note: 'Yes or no, once per film, whenever' },
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
			<p class="eyebrow text-ink-soft">Pick what to watch, together</p>
			<h1 class="display mt-1.5 text-[2.6rem] leading-[0.95] text-ink">
				Movie<br />Night
			</h1>
			<div class="mt-3 h-[3px] bg-ink"></div>
			<div class="mt-[3px] border-t-2 border-dashed border-board-shade"></div>
			<p class="mt-3 max-w-[21rem] text-sm leading-relaxed text-ink">
				Keep one shared pool of film suggestions. On the night the group swipes and picks
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
				<Stamp word="No logins" note="the link is the key" tone="brass" size="1.2rem" rotate={7} />
			</div>
		</section>

		{#if data.groups.length > 0}
			<!-- ── Your groups ───────────────────────────────────────────────
			     A switchboard, so rows and not seats: each one is the group's name
			     with the name you go by there stencilled under it, pressed IN under
			     the finger like every other tappable row inside a flat tile. Plain
			     anchors — the whole screen works with JavaScript off. Seated between
			     the lid and the create form: what the box is, where you already sit,
			     then how to start another table.

			     A row with no name under it is a group this device knows where nobody
			     has claimed one — what "Not you?" leaves behind when the phone is
			     handed on. It still belongs on the switchboard, since it may be the
			     only way back to a group whose link nobody kept; it just leads to the
			     picker rather than to the table.
			-->
			<section class="tile px-4 pt-4 pb-3">
				<h2 class="eyebrow border-b-2 border-ink pb-1.5 text-ink">Your groups</h2>
				<ul class="mt-1 divide-y-2 divide-dashed divide-board-shade">
					{#each data.groups as group, i (group.inviteToken)}
						<li class="deal-in" style="--deal:{i}">
							<a
								href="/g/{group.inviteToken}{group.memberName === null ? '/picker' : ''}"
								class="row-press -mx-1 flex items-center gap-2 rounded px-1 py-2.5 focus-visible:outline-offset-[-3px]"
							>
								<span class="min-w-0 flex-1">
									<span class="display block truncate text-[1.05rem] text-ink">{group.groupName}</span>
									<span class="stencil block text-[0.7rem] tracking-[0.06em] text-ink-soft uppercase">
										{#if group.memberName === null}
											Nobody signed in — pick a name
										{:else}
											You're {group.memberName}
										{/if}
									</span>
								</span>
								<ArrowRight size={18} class="shrink-0 text-ink-soft" />
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

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
