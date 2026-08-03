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

	The seal lives INSIDE the card, so it is carried off with the poster it was
	pressed onto: one object leaves the screen, never a stamp that unsticks itself
	at the moment of release.

	The card is flat: poster edge to edge on the front, kraft print edge to edge on
	the back, no lip on either. A raised edge on this table means pressable, and
	the card is not a control — the tokens under it are. What it does own is the
	soft shadow it casts on the felt, which is lift, not an invitation to press.

	The WHOLE card turns over — stock, print and all, one object rotating about its
	vertical axis, not a panel swapped inside a frame. A ⓘ token in the corner of
	the face turns it to a printed kraft back — what the film is about, who is in
	it, and a link out to the trailer — and a matching token in the back's own
	header turns it face up again. The flip never fights the gesture: it rides a
	layer inside the element the drag transforms, and the first few pixels of a
	drag turn the card face up mid-drag, without interrupting it, so a vote is
	always stamped onto the poster. Without JavaScript that corner is simply a
	link to the movie's own page, which prints the same facts.

	The cursor is *by movie id*, not by array position: the group's SSE stream
	calls `invalidateAll()` on every write — including our own vote — so the
	server-provided stack rebuilds mid-session, and a numeric index into it would
	silently skip cards.

	Which card is in front is stated as a number on every layer, and that number is
	never animated: a deck whose paint order is left to document order, to mount
	order, or to an interpolation shows the wrong card in front on the frame it
	advances. Every card also asks for its compositor layer from the frame it mounts
	rather than from the frame it is promoted, so the hand-over never has to create
	one — a commit moves a card and repaints it, and changes nothing about what it is.

	Which is why every card in the stack is BUILT the same, whether it is on top,
	behind, or on its way off screen: both faces and the ⓘ corner are there for the
	whole of a card's life, and the ones a card's current role has no use for are
	hidden with style rather than left out. A part printed on promotion and thrown
	away on commit is a layer tree rebuilt on the very frame the deck hands over.

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
	import Info from '$lib/icons/Info.svelte';
	import Play from '$lib/icons/Play.svelte';
	import StampIcon from '$lib/icons/Stamp.svelte';
	import Undo2 from '$lib/icons/Undo2.svelte';
	import X from '$lib/icons/X.svelte';
	import { genreLine, movieMeta, posterUrl, trailerUrl } from '$lib/images.js';
	import {
		EXIT_EASE,
		EXIT_MS,
		EXIT_ROTATION_DEG,
		PROMOTE_EASE,
		PROMOTE_MS,
		SPRING_EASE,
		SPRING_MS,
		TAP_SLOP,
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
	/**
	 * One rendered layer of the stack. `exit` set = committed, on its way out; `z`
	 * is where the layer sits in the pile (see `STACK_TOP_Z`/`EXIT_Z`).
	 */
	type Entry = { card: Card; depth: number; exit: SwipeChoice | null; z: number };

	/**
	 * WHO IS IN FRONT OF WHOM, and the only place it is decided.
	 *
	 * The live deck descends from the top slot — one value per depth, never two
	 * slots sharing one — and every card in flight sits above the whole of it,
	 * newest in front. Both are plain numbers on the entry, so paint order is
	 * DATA: it does not depend on the order the layers happen to sit in the DOM
	 * (which runs the wrong way — leaving cards are emitted first, so by default
	 * they paint first, i.e. UNDERNEATH the deck they are leaving), and it does
	 * not depend on when a layer was mounted.
	 *
	 * `STACK_TOP_Z` is 20 so the top card's relationship to the fixed tab bar
	 * (`z-20`, later in the document, therefore in front) is exactly as before,
	 * and `EXIT_Z` is above both: a card thrown across the screen passes over the
	 * chrome, as it always has.
	 */
	const STACK_TOP_Z = 20;
	const EXIT_Z = 30;

	/** Answers this session, newest last — powers Undo and drives the cursor. */
	let answered = $state<Array<{ card: Card; value: SwipeChoice }>>([]);
	/**
	 * Cards an Undo pulled back. They carry a server-side vote by then, so the
	 * rebuilt stack no longer lists them; pinning them at the front of the queue
	 * is what makes Undo survive a live invalidation.
	 */
	let restored = $state<Card[]>([]);
	/**
	 * Committed cards still animating away. Keyed by id, never overlapping the
	 * queue. The seal the card was stamped with is a child of this same node, so
	 * it rides the fly-out: the mark leaves with the poster it was pressed onto,
	 * exactly as a stamp on a card would.
	 */
	let exits = $state<Array<{ card: Card; dir: SwipeChoice }>>([]);

	let dragX = $state(0);
	let dragging = $state(false);
	/**
	 * Which card is showing its back, BY MOVIE ID — like every other cursor on
	 * this screen. That is what makes the flip reset itself when the deck
	 * advances: the id stops matching the top card, so the next film always
	 * arrives face up without anyone having to remember to clear a flag.
	 */
	let flippedId = $state<string | null>(null);
	let cardWidth = $state(0);
	let reduceMotion = $state(false);
	/**
	 * How much room the back's synopsis actually has, and how tall one of its
	 * lines is — both measured, never assumed. The back is a flex column: the
	 * header, the credits and the trailer button take what they need and the
	 * synopsis box takes the rest, so the only honest clamp is that box's height
	 * in whole lines. Measuring it is what stops the overview from stopping short
	 * of the bottom of the card on a tall phone, or being sliced mid-line on a
	 * short one — and it keeps the print CUT rather than scrolled, because a
	 * scrolling panel inside a swipe target fights the gesture.
	 *
	 * The room is measured PER MOVIE ID, because every card in the stack carries a
	 * back now (see the invariant in `cardStyle`) and the room left over is
	 * genuinely a per-card fact: a film with no tagline, no trailer or one line of
	 * cast leaves its synopsis more space than one with all three. Keying it by id
	 * is also what makes promotion free — a card measures its own box on the frame
	 * it mounts, at the BACK of the deck, where nothing is watching, so by the time
	 * it is on top the clamp is already right and the hand-over frame has no
	 * measuring left to do.
	 *
	 * The line box is not a per-card fact — one class, one font, one document — so
	 * it is read once, off whichever back is currently on top.
	 */
	let overviewBoxHeights = $state<Record<string, number>>({});
	let overviewEls = $state<Record<string, HTMLParagraphElement | null>>({});
	let overviewLineHeight = $state(0);
	/** Describes the vote currently being posted; the form reads only this. */
	let pending = $state<{ movieId: string; value: SwipeChoice }>({ movieId: '', value: 'yes' });
	let form = $state<HTMLFormElement | undefined>(undefined);

	// Plain locals: the gesture reads them every pointermove, nothing renders them.
	let pointerId: number | null = null;
	let startX = 0;
	/**
	 * Has this gesture travelled far enough to be a drag rather than a tap?
	 * Deliberately NOT state: it decides what a release means, and nothing
	 * renders it.
	 */
	let dragMoved = false;
	/**
	 * The control inside the card the press landed on, if any.
	 *
	 * The card captures the pointer for the length of a drag, and a captured
	 * pointer's click is dispatched at the CAPTURING element — so a tap on a link
	 * inside the card cannot be relied upon to reach that link at all. Taps are
	 * therefore resolved here, on release, from where the press started: it is the
	 * only place that knows both what was pressed and whether the finger then
	 * dragged. Pointer clicks are cancelled in the handler below so a browser that
	 * does deliver them cannot act a second time.
	 */
	let tapTarget: HTMLAnchorElement | null = null;
	const velocity = createVelocityTracker();
	const exitTimers = new Set<ReturnType<typeof setTimeout>>();

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

	/** The back on top: the one paragraph the line box is ever read from. */
	const topOverviewEl = $derived(current ? (overviewEls[current.id] ?? null) : null);
	const topOverviewBoxHeight = $derived(current ? (overviewBoxHeights[current.id] ?? 0) : 0);

	/**
	 * The clamp one card's overview gets: as many whole lines as fit the space left
	 * for it ON THAT CARD. Falls back to six — what the markup ships with, so the
	 * server-rendered card and the first client frame agree — until that card's box
	 * has been measured.
	 */
	function overviewLines(card: Card): number {
		const box = overviewBoxHeights[card.id] ?? 0;
		if (box <= 0 || overviewLineHeight <= 0) return 6;
		return Math.max(1, Math.floor(box / overviewLineHeight));
	}

	const progress = $derived(commitProgress(dragX, cardWidth));
	const rotation = $derived(rotationFor(dragX, cardWidth));
	const yesHint = $derived(dragX > 0 ? stampOpacity(progress) : 0);
	const noHint = $derived(dragX < 0 ? stampOpacity(progress) : 0);

	/**
	 * Leaving cards, then the top card, then the one beneath it. Order is stable
	 * per movie id so the keyed `each` reuses DOM nodes: a card is promoted by a
	 * style change, never by a remount. A commit appends to `exits` as the queue
	 * advances, so every entry keeps its index and the `each` never has to MOVE a
	 * layer either — which is also why this order cannot be the paint order. It is
	 * the mount order, and it runs front-to-back: each entry says outright, in
	 * `z`, where it is painted.
	 */
	const entries: Entry[] = $derived([
		...exits.map((exit, i) => ({ card: exit.card, depth: 0, exit: exit.dir, z: EXIT_Z + i })),
		...queue.slice(0, 2).map((card, i) => ({ card, depth: i, exit: null, z: STACK_TOP_Z - i }))
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

	// The synopsis's line box, read off the paragraph itself rather than derived
	// from a font size written down twice. Re-read whenever the box resizes: the
	// reader's own text scaling moves the card and the line together.
	$effect(() => {
		const el = topOverviewEl;
		void topOverviewBoxHeight;
		if (!el) return;
		const measured = parseFloat(getComputedStyle(el).lineHeight);
		if (measured > 0) overviewLineHeight = measured;
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

		// A vote is stamped on the artwork, so a card never leaves back-first. The
		// gesture has usually flipped it already; this covers the buttons and keys.
		flippedId = null;
		pending = { movieId: card.id, value };
		// Hand the card to the exit layer *before* the cursor moves, so the keyed
		// `each` sees it move slot rather than disappear: same DOM node, poster
		// already decoded, seal still stamped on it, and a CSS transition from
		// wherever the thumb left it.
		if (!reduceMotion) {
			exits = [...exits, { card, dir: value }];
			const timer = setTimeout(() => {
				exitTimers.delete(timer);
				exits = exits.filter((exit) => exit.card.id !== card.id);
			}, EXIT_MS + 60);
			exitTimers.add(timer);
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
	}

	/* ── pointer gesture (enhancement only) ───────────────────────── */
	function onPointerDown(event: PointerEvent, card: Card) {
		// Only the top card drags, and only ever one pointer. A card mid-flight
		// still owns its handler, hence the identity check rather than a lock.
		if (!event.isPrimary || pointerId !== null || card.id !== current?.id) return;
		pointerId = event.pointerId;
		dragging = true;
		dragMoved = false;
		tapTarget = (event.target as HTMLElement | null)?.closest('a[data-card-tap]') ?? null;
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
		if (!dragMoved && Math.abs(dragX) >= TAP_SLOP) {
			dragMoved = true;
			// The thumb has started a vote: turn the card face up under it, without
			// touching the drag. `dragX` is untouched, the pointer is still captured,
			// and the same gesture carries straight on to its commit — the poster
			// simply arrives in time to be stamped.
			flippedId = null;
		}
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		pointerId = null;
		dragging = false;
		const tapped = tapTarget;
		tapTarget = null;
		const choice = decideRelease({
			dx: dragX,
			vx: velocity.velocity(event.timeStamp),
			width: cardWidth
		});
		if (choice) {
			commit(choice);
			return;
		}
		dragX = 0; // springs back
		// It never travelled: it was a tap on something, so do what that something says.
		if (!dragMoved && tapped) activateCardTap(tapped);
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		// The browser took the gesture over (scroll, system edge swipe). Never
		// turn that into a vote.
		pointerId = null;
		dragging = false;
		tapTarget = null;
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

		// Escape turns a card that is showing its back face up again — the same
		// thing the corner token does, from the keyboard.
		if (event.key === 'Escape' && flippedId !== null) flippedId = null;
		else if (event.key === 'ArrowRight') commit('yes');
		else if (event.key === 'ArrowLeft') commit('no');
		else if (event.key === 'u' || event.key === 'U') undo();
		else return;
		event.preventDefault();
	}

	/* ── inline styles ────────────────────────────────────────────── */
	/**
	 * Outer layer: depth in the stack, and the slot the layer is painted in.
	 * Transitioning the depth is what promotes a card; the slot is APPLIED, never
	 * transitioned.
	 *
	 * Hence `transform` and `opacity` by name rather than `all`: `z-index` is an
	 * animatable integer, so `transition: all` hands the deck's paint order to an
	 * interpolation. A promoted card then spends the frame the deck advances in
	 * still wearing the value of the slot it has just LEFT — and a card that is
	 * only as far forward as the card behind it loses to that card, because a tie
	 * is broken by document order and the card behind comes later. One frame of
	 * the wrong card in front, on every single commit.
	 */
	function layerStyle(entry: Entry): string {
		const settle =
			dragging || reduceMotion
				? 'none'
				: `transform ${PROMOTE_MS}ms ${PROMOTE_EASE},opacity ${PROMOTE_MS}ms ${PROMOTE_EASE}`;
		if (entry.exit) return `z-index:${entry.z};transform:scale(1) translateY(0px);opacity:1`;
		if (entry.depth === 0) {
			return `z-index:${entry.z};transform:scale(1) translateY(0px);opacity:1;transition:${settle}`;
		}
		// The card underneath rises towards the top slot as the drag approaches a
		// commit, so a swipe reveals where it is going.
		const scale = 0.94 + 0.06 * progress;
		const lift = 8 - 8 * progress;
		const fade = 0.7 + 0.3 * progress;
		return `z-index:${entry.z};transform:scale(${scale.toFixed(3)}) translateY(${lift.toFixed(2)}px);opacity:${fade.toFixed(3)};transition:${settle}`;
	}

	/**
	 * Inner layer: the drag itself, and the flight off screen.
	 *
	 * `will-change: transform` is on every card in every role, from the frame it
	 * mounts to the frame it is dropped — including the one at the back of the deck,
	 * which is not moving at all. It is not a hint about this frame; it is the
	 * promise that a card is the same kind of object for the whole of its life.
	 *
	 * A card that asks for its compositor layer only once it reaches the top asks on
	 * the ONE frame that should not be renegotiating anything: the frame the deck
	 * hands over, where the card leaving starts a transform the compositor runs, the
	 * card behind it is promoted into the top slot, and a third is mounted behind
	 * that. Paint order itself holds — it is stated as a number on every layer, and
	 * it reads back correct in computed style on every frame of every commit — but a
	 * layer that has to be *created* in the middle of the hand-over is one the
	 * compositor has to place against layers that already exist, and nothing in CSS
	 * says on which frame it finishes agreeing. Asking early costs one more layer
	 * the size of a poster and moves that off the frame that matters.
	 *
	 * The same reasoning is why the machinery a card is MADE of — the perspective,
	 * the `preserve-3d`, the two faces — is not applied by role: anything conditional
	 * on whether a card is top, behind or leaving necessarily changes at exactly the
	 * hand-over, so making the deck's 3D conditional would put churn on that frame
	 * rather than take it off. A commit changes where a card is and where it is
	 * painted. It does not change what a card is.
	 *
	 * The MARKUP now says so outright, and that is not a tidy-up: it is the fix for
	 * the blink. Both halves of a card that used to be printed only on the top one —
	 * the ⓘ corner and the whole of the back — are mounted on every card in every
	 * role, and the difference between roles is opacity, hit-testing and tab order.
	 * Rendered by role, a resting top card composited as seven layers and an exiting
	 * or under-card as four, so every single commit tore three layers off the card
	 * leaving and built three on the card arriving — on the hand-over frame, inside
	 * `preserve-3d` contexts that then have to be depth-sorted again against layers
	 * that already existed. Paint order was never wrong; the deck was being rebuilt
	 * underneath it. Now the layer tree of a card is the same at depth 0, at depth 1
	 * and in flight, and a commit is only ever a change of transform, z and opacity.
	 */
	function cardStyle(entry: Entry): string {
		if (entry.exit) {
			// Percentages are of the card's own width, so this clears any viewport.
			const x = entry.exit === 'yes' ? 'calc(110% + 50vw)' : 'calc(-110% - 50vw)';
			const deg = entry.exit === 'yes' ? EXIT_ROTATION_DEG : -EXIT_ROTATION_DEG;
			const fade = Math.round(EXIT_MS * 0.4);
			return `transform:translate3d(${x},0,0) rotate(${deg}deg);opacity:0;transition:transform ${EXIT_MS}ms ${EXIT_EASE},opacity ${fade}ms linear ${EXIT_MS - fade}ms;will-change:transform`;
		}
		if (entry.depth > 0) return 'transform:translate3d(0px,0,0) rotate(0deg);will-change:transform';
		const spring = dragging || reduceMotion ? 'none' : `transform ${SPRING_MS}ms ${SPRING_EASE}`;
		return `transform:translate3d(${dragX.toFixed(1)}px,0,0) rotate(${rotation.toFixed(2)}deg);transition:${spring};will-change:transform`;
	}

	/* ── the flip ─────────────────────────────────────────────────── */
	/**
	 * The card the screen is actually for: on top, not on its way out. It is the
	 * only one that can turn over, and the only one whose ⓘ can be seen or pressed.
	 *
	 * This decides what a card's parts DO, never whether it has them — every card
	 * in the stack is built the same (see the invariant in `cardStyle`).
	 */
	function isLive(entry: Entry): boolean {
		return entry.exit === null && entry.depth === 0;
	}

	/** Only the top card, and never one already flying away, can show its back. */
	function facingBack(entry: Entry): boolean {
		return isLive(entry) && flippedId === entry.card.id;
	}

	function flip(movieId: string) {
		flippedId = flippedId === movieId ? null : movieId;
	}

	/** A tap that landed on one of the card's own links, resolved on release. */
	function activateCardTap(link: HTMLAnchorElement) {
		if (link.dataset.cardTap === 'flip') flip(link.dataset.movieId ?? '');
		// The trailer opens exactly as the markup promises — the anchor's own href,
		// a new tab, no opener — just driven from here rather than from a click the
		// pointer capture may have eaten.
		else if (link.dataset.cardTap === 'trailer') window.open(link.href, '_blank', 'noopener');
	}

	/**
	 * The click side of the same two links.
	 *
	 * A KEYBOARD activation (`detail === 0`: no coordinates, no gesture) is the
	 * one click that has to act on its own — and the ⓘ, which is a link to the
	 * film's own page for the no-JavaScript case, flips in place instead once
	 * JavaScript is running. A POINTER click is only ever the tail of a gesture
	 * already handled on release, so it is cancelled.
	 */
	function onCardTapClick(event: MouseEvent, card: Card) {
		const link = event.currentTarget as HTMLAnchorElement;
		if (event.detail !== 0) {
			event.preventDefault();
			return;
		}
		if (link.dataset.cardTap === 'flip') {
			event.preventDefault();
			flip(card.id);
		}
		// The trailer link is left alone: from the keyboard it is simply a link.
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
	The printed back of the card: kraft stock, stencil header, ink body. Same
	facts the movie's own page prints, cut down to what fits on a component you
	hold in one hand — so the overview is clamped rather than scrolled (a
	scrolling panel inside a swipe target fights the gesture) and the cast is a
	line of names rather than a table.

	It is laid out as a column with FIXED ENDS and one elastic middle: the header
	and the credits/trailer block take exactly what they need, and the synopsis
	takes everything left over. Nothing here can be pushed off the card, and
	nothing leaves a strip of blank kraft under the last line of print.
-->
{#snippet back(card: Card, showing: boolean)}
	{@const trailer = trailerUrl(card.details?.trailerKey)}
	<div class="flex h-full w-full flex-col bg-board p-3 text-ink">
		<!--
			The way back is a slot in the header row, not a token floating over the
			print: it has its own column beside the title, so it cannot come down on
			the trailer button at the foot of the card — or on the title — at any
			width. The ⓘ that turned the card over lives in the opposite corner, on
			the face, where nothing else is printed.
		-->
		<div class="flex shrink-0 items-start gap-2">
			<div class="min-w-0 flex-1">
				<h3 class="stencil text-[0.8rem] leading-[1.15] font-semibold text-ink uppercase">
					{card.title}
				</h3>
				{#if card.details?.tagline}
					<p class="display mt-1 line-clamp-2 text-[0.7rem] leading-[1.2] text-ink-soft">
						{card.details.tagline}
					</p>
				{/if}
			</div>
			<a
				href="/g/{data.token}/movies/{card.id}"
				data-card-tap="flip"
				data-movie-id={card.id}
				onclick={(event) => onCardTapClick(event, card)}
				tabindex={showing ? undefined : -1}
				class="card-corner token token-sm relative h-8 w-8 shrink-0 rounded-full p-0 {showing
					? ''
					: 'pointer-events-none'}"
			>
				<X size={15} />
				<span class="sr-only">Turn {card.title} back over</span>
			</a>
		</div>

		<!-- The elastic middle. `overflow-hidden` is the hard stop: whatever the
		     clamp misses by a pixel is cut, never scrolled.

		     Both measurements are written under this card's own id, and every card in
		     the stack takes them — the back is mounted on all of them now, so the
		     bindings are per card rather than one pair that would follow whichever
		     card happened to be on top. A card therefore arrives at the top already
		     measured. -->
		<div
			class="mt-2 min-h-0 flex-1 overflow-hidden"
			bind:clientHeight={() => overviewBoxHeights[card.id] ?? 0,
			(height) => (overviewBoxHeights[card.id] = height)}
		>
			{#if card.details?.overview}
				{@const lines = overviewLines(card)}
				<p
					bind:this={() => overviewEls[card.id] ?? null,
					(el) => (overviewEls[card.id] = el)}
					class="line-clamp-6 text-[0.76rem] leading-snug text-ink"
					style="-webkit-line-clamp:{lines};line-clamp:{lines}"
				>
					{card.details.overview}
				</p>
			{:else}
				<p class="text-[0.76rem] leading-snug text-ink-soft">
					Nothing printed on the back of this one.
				</p>
			{/if}
		</div>

		{#if card.details && (card.details.directors.length > 0 || card.details.cast.length > 0)}
			<dl class="mt-2 shrink-0 space-y-1 border-t-2 border-dashed border-board-shade pt-2">
				{#if card.details.directors.length > 0}
					<div>
						<dt class="eyebrow text-[0.6rem] text-ink-soft">Directed by</dt>
						<dd class="line-clamp-1 text-[0.74rem] leading-snug">
							{card.details.directors.join(' & ')}
						</dd>
					</div>
				{/if}
				{#if card.details.cast.length > 0}
					<div>
						<dt class="eyebrow text-[0.6rem] text-ink-soft">Starring</dt>
						<dd class="line-clamp-2 text-[0.74rem] leading-snug">
							{card.details.cast.map((person) => person.name).join(', ')}
						</dd>
					</div>
				{/if}
			</dl>
		{/if}

		{#if trailer}
			<a
				href={trailer}
				target="_blank"
				rel="noopener"
				data-card-tap="trailer"
				onclick={(event) => onCardTapClick(event, card)}
				tabindex={showing ? undefined : -1}
				class="token token-sm token-brass mt-2.5 w-full shrink-0 {showing
					? ''
					: 'pointer-events-none'}"
			>
				<Play size={13} />
				Watch trailer<span class="sr-only"> for {card.title} on YouTube (opens a new tab)</span>
			</a>
		{/if}
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
					{@const showing = facingBack(entry)}
					{@const live = isLive(entry)}
					<!--
						A layer that is not the deck's is not in the deck's way either. A card in
						flight keeps its layer for the length of the animation plus a margin, and
						that layer is a full-size transparent box sitting at `EXIT_Z` — over the
						whole stack. The CARD inside it was made inert; the box was not. So for the
						320ms after every single commit, every press and every drag aimed at the
						card that had just been promoted landed on the layer of the card that had
						just left, and the new top card could be neither dragged nor tapped until
						that box was dropped. Nothing inside a card in flight wants a pointer — it
						cannot be dragged, its ⓘ and its back's links are switched off, and its
						seal is decorative — so the whole layer stops hit-testing, and the deck
						underneath answers the first touch it is given.
					-->
					<div
						class="absolute inset-0 {entry.exit ? 'pointer-events-none' : ''}"
						style={layerStyle(entry)}
					>
						<!--
							The card is not a control — the buttons below are, and the arrow
							keys are handled on the window. It carries the drag gesture only,
							hence the presentation role and no keyboard handler.
						-->
						<!--
							THE HAND: the drag lives here, and only here. This element carries
							the gesture's translate/rotate — and the shadow the card casts on the
							table, which stays put on the felt while the card turns above it.
							Drag and flip COMPOSE rather than overwrite each other: this
							transform moves the card, the one two levels down turns it over, and
							neither ever writes the other's property.
						-->
						<div
							class="swipe-card relative h-full w-full rounded-md shadow-[0_16px_24px_rgb(0_0_0/0.32)] select-none {entry.exit ||
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
							<!--
								The stage the card turns on. The perspective gets its own layer,
								deliberately untransformed: the element above is re-styled on every
								pointermove and marked `will-change: transform`, and depth is not
								something to hang off a compositing hint that changes 60 times a
								second.
							-->
							<div class="absolute inset-0 [perspective:900px]">
								<!--
									THE CARD ITSELF, turning as one object: two whole faces on one
									stock, so what comes round is a card and not a panel swapped
									inside a frame. A committed card gets no flip transition — it
									snaps face up as it leaves, so the seal is on the poster from the
									first frame.
								-->
								<div
									class="card-flip absolute inset-0 {showing ? 'is-flipped' : ''}"
									style={entry.exit ? 'transition:none' : ''}
								>
									<!--
										The face IS the artwork: the poster runs edge to edge, clipped by
										the card's own corners, with the wash and the seal over it. The
										card is not pressable — the tokens below are — so it is not
										raised either: no lip, no ink half-step, nothing that says press
										me. What it keeps is the soft shadow it casts on the felt, which
										is lift, not a control.
									-->
									<div
										class="card-face absolute inset-0 overflow-hidden rounded-md bg-felt-deep"
										aria-hidden={showing}
									>
										{@render face(entry.card, hint.yes, hint.no)}
										<!--
											The corner token that turns the card over, in the one corner of the face
											nothing else is printed in. Its twin — the way back — is a slot in the
											back's header row, so the two can never meet on the same corner as the
											trailer button. With no JavaScript this is what it looks like: a link to
											the film's own page, which prints the same facts.

											It is printed on EVERY card, whatever that card is doing, and the ones it
											does not belong to hide it in style rather than not having it: a token that
											appears when a card reaches the top and is thrown away when it leaves is
											compositor layers built and destroyed on the hand-over frame, which is the
											one frame that must not be rebuilding anything (see `cardStyle`).
											`opacity-0` cannot be seen, and it is computed in the same render as the
											exit transform, so a card in flight leaves without its corner from the
											FIRST frame rather than one frame in. Pressing and Tab are shut off with
											it, and the reader never meets a spare one: a card that is not the live one
											is `aria-hidden` whole, and so is a face that is turned away.
										-->
										<a
											href="/g/{data.token}/movies/{entry.card.id}"
											data-card-tap="flip"
											data-movie-id={entry.card.id}
											onclick={(event) => onCardTapClick(event, entry.card)}
											tabindex={live && !showing ? undefined : -1}
											class="card-corner token token-sm absolute right-2 bottom-2 h-8 w-8 rounded-full p-0 {live
												? ''
												: 'opacity-0'} {live && !showing ? '' : 'pointer-events-none'}"
										>
											<Info size={15} />
											<span class="sr-only">What is {entry.card.title} about?</span>
										</a>
									</div>
									<!--
										The back is turned twice — once by itself, once by the container that flips
										— so on screen it is NOT mirrored, which is why its print reads the right
										way round. Kraft stock, edge to edge, clipped by the same corners as the
										face: a card is one flat object whichever way it is facing, and the only
										shadow near it is the one it casts on the felt, which does not turn with it.

										EVERY card in the stack has one, top, behind or leaving, because a card is
										not a different object in a different slot (see `cardStyle`). No style is
										needed to keep it out of sight and none is applied: the flip is by movie id
										and only the top card can hold it, exits snap face up, so this face is
										turned away for every role but one — and a face turned away states its own
										rotation, which is what makes the browser drop it (see `.card-face` below).
										What it buys is that nothing about the card's layer tree changes when the
										deck advances. The print it carries costs three hidden backs' worth of text,
										and it reaches nobody: `aria-hidden` here for anything but the card actually
										showing its back, and every link inside it is `tabindex="-1"` and
										unpressable until it is.
									-->
									<div
										class="card-face card-face-back absolute inset-0 overflow-hidden rounded-md bg-board"
										aria-hidden={!showing}
									>
										{@render back(entry.card, showing)}
									</div>
								</div>
							</div>
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
					{#if genreLine(current.details?.genres, current.details?.certification)}
						<!-- What the shelf label would say. Quiet: it informs the swipe, it
						     is not the swipe. -->
						<p class="stencil mt-0.5 text-[0.68rem] text-chalk-dim/80 uppercase">
							{genreLine(current.details?.genres, current.details?.certification)}
						</p>
					{/if}
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

	/*
		Turning the card over: ONE two-faced container holding two whole cards,
		rotated about its vertical axis, so the object that turns is the card and
		not a panel inside it. Each face hides its own back, so the two never show
		through each other, and the element above supplies the perspective — put it
		on the rotating element itself and the turn reads flat.

		That element above is also the one the gesture transforms, which is the
		whole point of the split: the drag owns `transform` on the outer element,
		the flip owns `transform` here, and a card being dragged mid-turn simply
		carries both.

		Under prefers-reduced-motion the global block in app.css zeroes every
		transition duration, which turns this into exactly what it should be: an
		instant swap between two faces, with no rotation to sit through.
	*/
	.card-flip {
		transform-style: preserve-3d;
		transition: transform 420ms cubic-bezier(0.2, 0.7, 0.3, 1);
	}

	.card-flip.is-flipped {
		transform: rotateY(180deg);
	}

	/*
		The two faces, written ONCE: FLAT stock, no lip and no printed edge. On this
		table an extrusion means pressable, and the card is not a control — the
		tokens under it are. The only shadow it owns is the soft one it casts on the
		felt, which belongs to the element the gesture moves rather than to a face,
		so it stays on the table while the card turns above it.

		Each face states its own turn — including the front's, whose `rotateY(0deg)`
		is a no-op in geometry and the whole fix in practice. Gecko only tests a
		face's backside when that face is itself 3D-transformed; with no transform of
		its own the front face was drawn even while facing away, mirrored, under the
		back. With the rotation written down, exactly one face is ever painted, and
		the hand-over happens at 90° where the card is edge-on.

		The back is turned twice — its own `rotateY(180deg)` plus the container's
		when flipped — so the total is a full turn and the visible back is NOT
		mirrored, which is exactly why its print reads the right way round rather
		than backwards.
	*/
	.card-face {
		transform: rotateY(0deg);
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
	}

	/* After `.card-face`, so this turn is the one that lands on the back. */
	.card-face-back {
		transform: rotateY(180deg);
	}

	/*
		A 2rem token is the right SIZE on a card held in one hand; 2rem is not a
		target. The halo is the target: it takes both flip affordances out to 44px
		without changing what is printed. It is transparent and unstyled, so it
		hit-tests but never shows, and a press on it reports the anchor as the
		event target — which is what the tap resolver reads on release.
	*/
	.card-corner::after {
		content: '';
		position: absolute;
		inset: -6px;
		border-radius: 9999px;
	}
</style>
