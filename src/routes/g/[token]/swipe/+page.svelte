<!--
	Swipe screen: full-screen card stack.

	voting-spec's effort budget is one swipe per movie, ever. The gesture is an
	enhancement: right = yes, left = no via pointer events, but the Yes/No buttons
	are always visible and are the accessible and desktop path, so the whole stack
	is operable without ever touching the drag handler. Arrow keys and `U` (undo)
	drive the same commit path as the buttons and the gesture.

	Two cards are always mounted — the top one and the one under it — so the next
	poster is decoded before it is needed and nothing pops in. A committed card
	stays mounted while it flies off screen (same DOM node, so the poster is never
	re-fetched) and the cursor moves on immediately, which keeps rapid swiping
	responsive instead of gating on an animation.

	The cursor is *by movie id*, not by array position: the group's SSE stream
	calls `invalidateAll()` on every write — including our own vote — so the
	server-provided stack rebuilds mid-session, and a numeric index into it would
	silently skip cards.

	All motion is CSS transitions on inline transforms; `prefers-reduced-motion`
	drops the fly-out and the spring entirely (app.css also zeroes durations
	globally, so this is belt and braces).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { flushSync } from 'svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import Check from '$lib/icons/Check.svelte';
	import StampIcon from '$lib/icons/Stamp.svelte';
	import Undo2 from '$lib/icons/Undo2.svelte';
	import X from '$lib/icons/X.svelte';
	import { movieMeta, posterUrl } from '$lib/images.js';
	import {
		EXIT_EASE,
		EXIT_MS,
		EXIT_ROTATION_DEG,
		PROMOTE_EASE,
		PROMOTE_MS,
		SPRING_EASE,
		SPRING_MS,
		commitProgress,
		createVelocityTracker,
		decideRelease,
		rotationFor,
		stampOpacity,
		type SwipeChoice
	} from '$lib/swipe.js';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	type Card = PageServerData['stack'][number];
	/** One rendered layer of the stack. `exit` set = committed, on its way out. */
	type Entry = { card: Card; depth: number; exit: SwipeChoice | null };

	/** Answers this session, newest last — powers Undo and drives the cursor. */
	let answered = $state<Array<{ card: Card; value: SwipeChoice }>>([]);
	/**
	 * Cards an Undo pulled back. They carry a server-side vote by then, so the
	 * rebuilt stack no longer lists them; pinning them at the front of the queue
	 * is what makes Undo survive a live invalidation.
	 */
	let restored = $state<Card[]>([]);
	/** Committed cards still animating away. Keyed by id, never overlapping the queue. */
	let exits = $state<Array<{ card: Card; dir: SwipeChoice }>>([]);
	/**
	 * Ink left behind by a card that has already gone: the seal stays put for
	 * SEAL_RESIDUE_MS while the card flies off, so somebody swiping fast sees
	 * their marks land and pile up instead of watching cards vanish silently.
	 * `x`/`deg` record the card's drag transform at the moment of commit — the
	 * mark must fade exactly where the gesture left it, not where the card was
	 * at rest. Purely presentational — nothing here reaches the vote.
	 */
	let residue = $state<Array<{ id: number; dir: SwipeChoice; x: number; deg: number }>>([]);
	let residueSeq = 0;

	let dragX = $state(0);
	let dragging = $state(false);
	let cardWidth = $state(0);
	let reduceMotion = $state(false);
	/** Describes the vote currently being posted; the form reads only this. */
	let pending = $state<{ movieId: string; value: SwipeChoice }>({ movieId: '', value: 'yes' });
	let form = $state<HTMLFormElement | undefined>(undefined);

	// Plain locals: the gesture reads them every pointermove, nothing renders them.
	let pointerId: number | null = null;
	let startX = 0;
	const velocity = createVelocityTracker();
	const exitTimers = new Set<ReturnType<typeof setTimeout>>();

	/** How long a committed card's seal stays inked on the stack. */
	const SEAL_RESIDUE_MS = 200;

	const answeredIds = $derived(new Set(answered.map((a) => a.card.id)));
	const restoredIds = $derived(new Set(restored.map((c) => c.id)));
	/** What is left to swipe, undone cards first. */
	const queue = $derived([
		...restored,
		...data.stack.filter((card) => !answeredIds.has(card.id) && !restoredIds.has(card.id))
	]);
	const current: Card | null = $derived(queue[0] ?? null);
	const total = $derived(answered.length + queue.length);
	const position = $derived(Math.min(answered.length + 1, total));

	const progress = $derived(commitProgress(dragX, cardWidth));
	const rotation = $derived(rotationFor(dragX, cardWidth));
	const yesHint = $derived(dragX > 0 ? stampOpacity(progress) : 0);
	const noHint = $derived(dragX < 0 ? stampOpacity(progress) : 0);

	/**
	 * Leaving cards, then the top card, then the one beneath it. Order is stable
	 * per movie id so the keyed `each` reuses DOM nodes: a card is promoted by a
	 * style change, never by a remount.
	 */
	const entries: Entry[] = $derived([
		...exits.map((exit) => ({ card: exit.card, depth: 0, exit: exit.dir })),
		...queue.slice(0, 2).map((card, i) => ({ card, depth: i, exit: null }))
	]);

	// Warm the two posters after the one on screen: the card under the top card is
	// already mounted, this covers the one after it so a fast swiper never waits.
	$effect(() => {
		for (const card of queue.slice(1, 3)) {
			const url = posterUrl(card.posterPath, 'w500');
			if (!url) continue;
			const image = new Image();
			image.decoding = 'async';
			image.src = url;
		}
	});

	$effect(() => {
		const query = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduceMotion = query.matches;
		const sync = () => (reduceMotion = query.matches);
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

	$effect(() => () => cancelExitTimers());

	function cancelExitTimers() {
		for (const timer of exitTimers) clearTimeout(timer);
		exitTimers.clear();
	}

	/** The one path to a vote: gesture, buttons and keys all land here. */
	function commit(value: SwipeChoice) {
		const card = current;
		if (!card) return;

		pending = { movieId: card.id, value };
		// Hand the card to the exit layer *before* the cursor moves, so the keyed
		// `each` sees it move slot rather than disappear: same DOM node, poster
		// already decoded, and a CSS transition from wherever the thumb left it.
		if (!reduceMotion) {
			exits = [...exits, { card, dir: value }];
			const timer = setTimeout(() => {
				exitTimers.delete(timer);
				exits = exits.filter((exit) => exit.card.id !== card.id);
			}, EXIT_MS + 60);
			exitTimers.add(timer);

			// The seal the card was carrying stays behind for a beat, frozen at the
			// card's transform as the thumb released it (`dragX`/`rotation` are
			// still live here — they are reset below). Under prefers-reduced-motion
			// there is no fly-out at all, so there is nothing for the ink to lag
			// behind and none of this runs.
			const mark = { id: ++residueSeq, dir: value, x: dragX, deg: rotation };
			residue = [...residue, mark];
			const inkTimer = setTimeout(() => {
				exitTimers.delete(inkTimer);
				residue = residue.filter((entry) => entry.id !== mark.id);
			}, SEAL_RESIDUE_MS);
			exitTimers.add(inkTimer);
		}
		restored = restored.filter((c) => c.id !== card.id);
		answered = [...answered, { card, value }];
		dragX = 0;

		// One paint for the whole handover, and the hidden inputs describe *this*
		// card before the request leaves — so flush deliberately rather than
		// racing Svelte's own microtask.
		flushSync();
		form?.requestSubmit();
	}

	function undo() {
		const last = answered[answered.length - 1];
		if (!last) return;
		answered = answered.slice(0, -1);
		restored = [last.card, ...restored.filter((c) => c.id !== last.card.id)];
		dragX = 0;
		// A card on its way out is coming back: drop it from the exit layer now, or
		// the keyed stack would hold the same movie twice. If it is still on screen
		// the node survives and slides back in.
		cancelExitTimers();
		exits = [];
		residue = [];
	}

	/* ── pointer gesture (enhancement only) ───────────────────────── */
	function onPointerDown(event: PointerEvent, card: Card) {
		// Only the top card drags, and only ever one pointer. A card mid-flight
		// still owns its handler, hence the identity check rather than a lock.
		if (!event.isPrimary || pointerId !== null || card.id !== current?.id) return;
		pointerId = event.pointerId;
		dragging = true;
		startX = event.clientX;
		dragX = 0;
		velocity.reset(event.clientX, event.timeStamp);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return;
		// clientX against the down position, not movementX: no accumulated drift.
		dragX = event.clientX - startX;
		velocity.sample(event.clientX, event.timeStamp);
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		dragging = false;
		const choice = decideRelease({
			dx: dragX,
			vx: velocity.velocity(event.timeStamp),
			width: cardWidth
		});
		if (choice) commit(choice);
		else dragX = 0; // springs back
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		// The browser took the gesture over (scroll, system edge swipe). Never
		// turn that into a vote.
		pointerId = null;
		dragging = false;
		dragX = 0;
	}

	/* ── keyboard (same commit path as the buttons) ────────────────── */
	function onKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		// A thumb is mid-gesture; let it finish rather than voting underneath it.
		if (dragging) return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable) return;
		if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

		if (event.key === 'ArrowRight') commit('yes');
		else if (event.key === 'ArrowLeft') commit('no');
		else if (event.key === 'u' || event.key === 'U') undo();
		else return;
		event.preventDefault();
	}

	/* ── inline styles ────────────────────────────────────────────── */
	/** Outer layer: depth in the stack. Transitioning it is what promotes a card. */
	function layerStyle(entry: Entry): string {
		const settle = dragging || reduceMotion ? 'none' : `all ${PROMOTE_MS}ms ${PROMOTE_EASE}`;
		if (entry.exit) return `z-index:30;transform:scale(1) translateY(0px);opacity:1`;
		if (entry.depth === 0) {
			return `z-index:20;transform:scale(1) translateY(0px);opacity:1;transition:${settle}`;
		}
		// The card underneath rises towards the top slot as the drag approaches a
		// commit, so a swipe reveals where it is going.
		const scale = 0.94 + 0.06 * progress;
		const lift = 8 - 8 * progress;
		const fade = 0.7 + 0.3 * progress;
		return `z-index:10;transform:scale(${scale.toFixed(3)}) translateY(${lift.toFixed(2)}px);opacity:${fade.toFixed(3)};transition:${settle}`;
	}

	/** Inner layer: the drag itself, and the flight off screen. */
	function cardStyle(entry: Entry): string {
		if (entry.exit) {
			// Percentages are of the card's own width, so this clears any viewport.
			const x = entry.exit === 'yes' ? 'calc(110% + 50vw)' : 'calc(-110% - 50vw)';
			const deg = entry.exit === 'yes' ? EXIT_ROTATION_DEG : -EXIT_ROTATION_DEG;
			const fade = Math.round(EXIT_MS * 0.4);
			// `will-change` stays set so the compositor layer survives the flight.
			return `transform:translate3d(${x},0,0) rotate(${deg}deg);opacity:0;transition:transform ${EXIT_MS}ms ${EXIT_EASE},opacity ${fade}ms linear ${EXIT_MS - fade}ms;will-change:transform`;
		}
		if (entry.depth > 0) return 'transform:translate3d(0px,0,0) rotate(0deg)';
		const spring = dragging || reduceMotion ? 'none' : `transform ${SPRING_MS}ms ${SPRING_EASE}`;
		return `transform:translate3d(${dragX.toFixed(1)}px,0,0) rotate(${rotation.toFixed(2)}deg);transition:${spring};will-change:transform`;
	}

	/** Stamp/tint strength for a layer: full on a committed card, live on the top one. */
	function hints(entry: Entry): { yes: number; no: number } {
		if (entry.exit) return { yes: entry.exit === 'yes' ? 1 : 0, no: entry.exit === 'no' ? 1 : 0 };
		if (entry.depth > 0) return { yes: 0, no: 0 };
		return { yes: yesHint, no: noHint };
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet face(card: Card, yes: number, no: number)}
	<Poster path={card.posterPath} title={card.title} size="w500" eager />

	<!-- Direction hint: a wash of ink plus the seal that names the vote. Same
	     stamp component the reveal slams onto the winner — dragging the card is
	     literally inking it. -->
	<div
		class="pointer-events-none absolute inset-0 bg-jade"
		style="opacity:{(yes * 0.3).toFixed(3)}"
		aria-hidden="true"
	></div>
	<div
		class="pointer-events-none absolute inset-0 bg-cherry"
		style="opacity:{(no * 0.3).toFixed(3)}"
		aria-hidden="true"
	></div>
	<div class="pointer-events-none absolute top-4 left-3">
		<Stamp
			word="Yes"
			tone="jade"
			size="1.85rem"
			rotate={-13}
			opacity={yes}
			scale={0.82 + 0.18 * yes}
		/>
	</div>
	<div class="pointer-events-none absolute top-4 right-3">
		<Stamp
			word="Nope"
			tone="cherry"
			size="1.85rem"
			rotate={12}
			opacity={no}
			scale={0.82 + 0.18 * no}
		/>
	</div>
{/snippet}

<!--
	`overflow-x: clip` and not `hidden`: a committed card flies a full viewport
	past the stack's right edge, which grows the document and lets the page be
	dragged sideways for the length of the animation. Clipping contains it without
	making this a scroll container, so nothing inside gains a scrollbar and the
	fixed tab bar is unaffected.
-->
<div class="space-y-4 overflow-x-clip">
	<div class="space-y-2">
		<div class="flex items-baseline justify-between gap-3">
			<a
				href="/g/{data.token}/pool"
				class="stencil flex items-center gap-1.5 text-xs text-chalk-dim uppercase hover:text-brass"
			>
				<ArrowLeft size={14} /> Back to the pool
			</a>
			{#if total > 0}
				<p class="eyebrow text-brass" aria-live="polite">
					Card {position} <span class="text-chalk-dim">of {total}</span>
				</p>
			{/if}
		</div>
		{#if total > 0}
			<!-- The deck you have got through: a punched rail filling with brass. -->
			<div
				class="h-2.5 overflow-hidden rounded-full border-2 border-board-shade bg-felt-deep"
				role="presentation"
			>
				<div
					class="h-full rounded-full bg-brass transition-[width] duration-200"
					style="width:{total === 0 ? 0 : (answered.length / total) * 100}%"
				></div>
			</div>
		{/if}
	</div>

	<!--
		The vote is posted by this form, which stays mounted for the whole session:
		it describes `pending`, not the card on screen, so advancing the cursor (or
		emptying the stack) can never pull a request's own data out from under it.
	-->
	<form
		class="contents"
		method="POST"
		action="?/vote"
		bind:this={form}
		use:enhance={() => async ({ update }) => {
			// Keep the local cursor: re-running the load would rebuild the stack
			// under our feet.
			await update({ reset: false, invalidateAll: false });
		}}
	>
		<input type="hidden" name="movie_id" value={pending.movieId} />
		<input type="hidden" name="value" value={pending.value} />
	</form>

	{#if !current && exits.length === 0}
		<div class="tile-slot space-y-3.5 px-4 py-8 text-center">
			<StampIcon size={38} class="mx-auto text-brass" />
			<h2 class="display text-[1.6rem] text-board">
				{total === 0 ? 'Nothing to swipe' : "That's the lot"}
			</h2>
			<p class="mx-auto max-w-[19rem] text-sm leading-relaxed text-chalk-dim">
				You've answered every film in the pool. New suggestions will show up here as a short top-up —
				never the whole pool again.
			</p>
			<a href="/g/{data.token}" class="token token-brass mx-auto mt-1 w-auto px-5">
				Back to the round
				<ArrowRight size={17} />
			</a>
		</div>
	{:else}
		<!-- One block, so the card/title/button rhythm is set by the margins below. -->
		<div>
			<div class="relative mx-auto aspect-[2/3] w-full max-w-[16.5rem]" bind:clientWidth={cardWidth}>
				{#each entries as entry (entry.card.id)}
					{@const hint = hints(entry)}
					<div class="absolute inset-0" style={layerStyle(entry)}>
						<!--
							The card is not a control — the buttons below are, and the arrow
							keys are handled on the window. It carries the drag gesture only,
							hence the presentation role and no keyboard handler.
						-->
						<!--
							Board stock, ink edge, artwork inset in its own frame: the card in
							your hand is the same component as everything else on the table,
							but it is the one thing lifted off it — hence the single soft
							shadow under the hard two-ply edge.
						-->
						<div
							class="swipe-card relative h-full w-full rounded-md border-2 border-ink bg-board p-2 shadow-[0_6px_0_0_var(--color-board-shade),0_6px_0_2px_var(--color-ink),0_16px_24px_rgb(0_0_0/0.32)] select-none {entry.exit ||
							entry.depth > 0
								? 'pointer-events-none'
								: 'touch-pan-y'}"
							style={cardStyle(entry)}
							onpointerdown={(event) => onPointerDown(event, entry.card)}
							onpointermove={onPointerMove}
							onpointerup={onPointerUp}
							onpointercancel={onPointerCancel}
							ondragstart={(event) => event.preventDefault()}
							aria-hidden={entry.exit !== null || entry.depth > 0}
							role="presentation"
						>
							<div
								class="relative h-full w-full overflow-hidden rounded-[3px] border-2 border-ink bg-felt-deep"
							>
								{@render face(entry.card, hint.yes, hint.no)}
							</div>
						</div>
					</div>
				{/each}

				<!--
					Ink left behind. A committed card carries its seal off screen with it,
					so a copy stays pressed on for a beat and then fades: swipe fast and
					you watch your marks accumulate instead of watching cards vanish.

					Each mark sits in a full-size layer frozen at the card's drag
					transform from the moment of commit — same box, same centre of
					rotation, and the stamp offsets inside match the on-card stamp's
					(border 2 + padding 8 + frame border 2 + top-4/left-3), so the copy
					lands pixel-for-pixel where the gesture left the seal rather than
					snapping back to the stack's resting position. Decorative — the card
					counter above is what actually reports progress, and none of this runs
					under prefers-reduced-motion, where there is no fly-out for the ink to
					lag behind.
				-->
				{#each residue as mark (mark.id)}
					<div
						class="pointer-events-none absolute inset-0 z-40"
						style="transform:translate3d({mark.x.toFixed(1)}px,0,0) rotate({mark.deg.toFixed(2)}deg)"
						aria-hidden="true"
					>
						<div class="seal-residue absolute {mark.dir === 'yes' ? 'top-7 left-6' : 'top-7 right-6'}">
							<Stamp
								word={mark.dir === 'yes' ? 'Yes' : 'Nope'}
								tone={mark.dir === 'yes' ? 'jade' : 'cherry'}
								size="1.85rem"
								rotate={mark.dir === 'yes' ? -13 : 12}
							/>
						</div>
					</div>
				{/each}
			</div>

			{#if current}
				<div class="mt-4 text-center">
					<h2 class="display text-[1.3rem] text-board">{current.title}</h2>
					<p class="stencil mt-1 text-[0.72rem] text-chalk-dim uppercase">
						{movieMeta(current.year, current.runtimeMin)}
						{#if current.suggestedBy}· suggested by {current.suggestedBy.displayName}{/if}
					</p>
				</div>

				<!-- Always-visible tokens: the accessible and desktop path. -->
				<div class="mt-4 flex gap-3">
					<button type="button" onclick={() => commit('no')} class="token token-lg token-cherry flex-1">
						<X size={18} />
						No<span class="sr-only"> — I wouldn't watch {current.title}</span>
					</button>
					<button type="button" onclick={() => commit('yes')} class="token token-lg token-jade flex-1">
						<Check size={18} />
						Yes<span class="sr-only"> — I'd happily watch {current.title}</span>
					</button>
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between gap-3 pt-1">
			<button
				type="button"
				onclick={undo}
				disabled={answered.length === 0}
				class="token token-sm token-slot"
			>
				<Undo2 size={14} />
				Undo last<span class="sr-only"> answer (keyboard: U)</span>
			</button>
			<p class="max-w-44 text-right text-[0.7rem] leading-snug text-chalk-dim">
				Swipe right for yes, left for no —
				<span class="inline-flex items-center gap-0.5 align-[-2px]" aria-hidden="true">
					<ArrowLeft size={12} /> / <ArrowRight size={12} />
				</span><span class="sr-only">the left and right arrow keys</span> work too
			</p>
		</div>
	{/if}
</div>

<style>
	/* Desktop: dragging a poster must move the card, not start a native image drag. */
	.swipe-card :global(img) {
		-webkit-user-drag: none;
		user-select: none;
	}

	/* The mark a departed card leaves behind: it holds for most of its short life,
	   then lifts off cleanly. Slightly translucent, because this is ink on the
	   stack rather than a stamp on a card. */
	.seal-residue {
		animation: seal-residue 200ms linear both;
	}

	@keyframes seal-residue {
		0%,
		45% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
