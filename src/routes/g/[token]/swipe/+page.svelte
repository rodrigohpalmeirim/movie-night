<!--
	Swipe screen: full-screen card stack.

	voting-spec's effort budget is one swipe per movie, ever. The gesture is an
	enhancement: right = yes, left = no, UP = a starred yes, all via pointer
	events, but the Yes/No buttons are always visible and are the accessible and
	desktop path, so the whole stack is operable without ever touching the drag
	handler. Arrow keys and `U` (undo) drive the same commit path as the buttons and
	the gesture — and the star has no third button on purpose: the row stays a pair
	(the answer is still yes or no), the up arrow covers the keyboard, and the pool
	list's toggle is the universal fallback for a star anyone missed.

	A gesture picks ONE AXIS and keeps it. The card follows the finger sideways or
	up, never both, so a diagonal thumb arc cannot half-vote and half-star; which
	axis it is is decided in the same few pixels that stop the press being a tap
	(see `decideAxis`), and the horizontal is given the benefit of every doubt,
	because right and left are what this screen is mostly for.

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
	soft shadow it casts on the felt, which is lift, not an invitation to press —
	and it belongs to the card: it follows the drag, and as the card turns over it
	drops, spreads and closes to the sliver an edge-on card casts, rather than
	lying on the felt at full width while the card leaves it.

	The WHOLE card turns over — stock, print and all, one object rotating about its
	vertical axis, not a panel swapped inside a frame. A TAP ANYWHERE ON IT turns
	it to a printed kraft back — what the film is about, who is in it, and a link
	out to the trailer — and a tap anywhere turns it face up again: the card is the
	affordance, so there is no token on it to aim at, and the only thing inside it
	a tap means something else on is the trailer button. From the keyboard ArrowDown
	turns it over and back, Escape only ever face up — ArrowUp is the star, so the
	keys say what the gestures say. Which leaves the back to be
	discovered, so it is shown: the first card of a BROWSER SESSION is dealt back up
	and turns itself over on the frame after it arrives, once, and nothing does that
	again — not the next card, and not the next visit to this screen, which the
	server remembers on a session cookie. No dwell either, because the reveal is the
	turn and not the pause before it.
	The flip never fights the gesture: it rides a layer inside the element the drag
	transforms, and the first few pixels of a drag turn the card face up mid-drag,
	without interrupting it, so a vote is always stamped onto the poster.

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
	behind, or on its way off screen: both faces are there for the whole of a
	card's life, and the one a card's current role has no use for is hidden with
	style rather than left out. A part printed on promotion and thrown away on
	commit is a layer tree rebuilt on the very frame the deck hands over.

	All motion is CSS on transforms: transitions on the inline ones for the drag,
	the spring and the fly-out, and keyframe animations for the turn — one for the
	card, one for the shadow it casts — which pass through a midpoint (the card
	swells towards you halfway round and its shadow drops and narrows to a sliver
	under it) that no transition could hold. `prefers-reduced-motion` drops the
	fly-out, the spring, the turn and the intro reveal entirely (app.css also zeroes
	durations globally, so this is belt and braces).
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { flushSync, untrack } from 'svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Stamp from '$lib/components/Stamp.svelte';
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import Check from '$lib/icons/Check.svelte';
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
		commitProgress,
		createVelocityTracker,
		decideAxis,
		decideRelease,
		rotationFor,
		stampOpacity,
		type DragAxis,
		type SwipeAction,
		type SwipeChoice
	} from '$lib/swipe.js';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	type Card = PageServerData['stack'][number];
	/**
	 * One rendered layer of the stack. `exit` set = committed, on its way out; `z`
	 * is where the layer sits in the pile (see `STACK_TOP_Z`/`EXIT_Z`).
	 */
	type Entry = { card: Card; depth: number; exit: SwipeAction | null; z: number };

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

	/**
	 * How long a card takes to turn over. Written down here because the class that
	 * runs the turn has to be taken off again afterwards; the animation's own
	 * duration is in the stylesheet below, and the two are the same number.
	 *
	 * There is no third number for the intro reveal: it does not wait at all (see
	 * the intro effect). The back is on screen for the frame it is dealt on, and
	 * the card is already coming round on the next.
	 */
	const FLIP_MS = 350;
	/**
	 * The card the intro reveal deals back up, or null when there is no reveal to
	 * give: the first card of the FIRST swipe screen of a browser session, read ONCE
	 * at init and deliberately not reactive. `untrack` says so out loud — the stack
	 * is rebuilt by every live invalidation, and the intro is a fact about arriving
	 * on this screen, not about whatever the server most recently dealt.
	 *
	 * Whether the reveal is owed at all is the SERVER's answer (`data.intro`, a
	 * session cookie — see `INTRO_COOKIE` in `+page.server.ts`), because the card is
	 * dealt back up in the server's HTML: only knowledge the server already has can
	 * decide which way up the first paint is without a correction the reader sees.
	 * Coming back to this screen in the same browser session, `data.intro` is false
	 * and the deck is simply face up, as it is for every card after the first.
	 */
	const introId: string | null = untrack(() => (data.intro ? (data.stack[0]?.id ?? null) : null));

	/**
	 * Answers this session, newest last — powers Undo and drives the cursor. The
	 * ANSWER is stored, star and all (`'star'` is the yes the up-gesture makes), so
	 * this list is also the session's memory of what each card was given.
	 */
	let answered = $state<Array<{ card: Card; value: SwipeAction }>>([]);
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
	let exits = $state<Array<{ card: Card; dir: SwipeAction }>>([]);

	let dragX = $state(0);
	/**
	 * The vertical half of the drag, which is the star. Exactly one of these two is
	 * ever non-zero: the axis is locked at `TAP_SLOP` and held for the whole
	 * gesture, so the card travels either sideways or up, never on a diagonal — and
	 * a lift therefore has no tilt to write either (`rotationFor(0)` is 0).
	 */
	let dragY = $state(0);
	/** The locked axis, or null while the gesture is still a tap. State, because
	 *  which seal is inking and which way the card is going both read it. */
	let dragAxis = $state<DragAxis | null>(null);
	let dragging = $state(false);
	/**
	 * Which card is showing its back, BY MOVIE ID — like every other cursor on
	 * this screen. That is what makes the flip reset itself when the deck
	 * advances: the id stops matching the top card, so the next film always
	 * arrives face up without anyone having to remember to clear a flag.
	 *
	 * It starts on the FIRST card a browser session is dealt, and on nothing else:
	 * that card arrives back up and turns itself over on the very next frame (see
	 * the intro effect), which is how anyone finds out there is a back at all now
	 * that no token advertises it. Every later visit starts at null — `introId` is
	 * already null, because the server has spent the session's one reveal.
	 */
	let flippedId = $state<string | null>(introId);
	/**
	 * Which card is mid-turn and which way it is going, or null between turns. The
	 * animation that turns a card is attached from here and nowhere else — see
	 * `turn`, which is where the reason lives.
	 */
	let turning = $state<{ id: string; dir: 'to-back' | 'to-face' } | null>(null);
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
	/**
	 * Describes the vote currently being posted; the form reads only this.
	 *
	 * `starred` is ALWAYS stated, true or false — this screen never leaves it out.
	 * A bare `yes` would keep whatever star the film already had (that is the rule
	 * the other surfaces want, where a yes is an edit and not a fresh answer), but
	 * here the card in your hand is the whole truth: swipe right and you get the
	 * plain yes you just saw stamped on it, including on the re-swipe after an Undo
	 * of a star.
	 */
	let pending = $state<{ movieId: string; value: SwipeChoice; starred: boolean }>({
		movieId: '',
		value: 'yes',
		starred: false
	});
	let form = $state<HTMLFormElement | undefined>(undefined);

	// Plain locals: the gesture reads them every pointermove, nothing renders them.
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	/**
	 * Has this gesture travelled far enough to be a drag rather than a tap?
	 * Deliberately NOT state: it decides what a release means, and nothing
	 * renders it.
	 */
	let dragMoved = false;
	/**
	 * The link inside the card the press landed on, if any — the trailer button is
	 * the only one there is.
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
	/**
	 * One tracker per axis. They are read TOGETHER at release — an upward flick has
	 * to be upward in both position and speed — and a single tracker fed both
	 * coordinates would only ever know the diagonal.
	 */
	const velocityX = createVelocityTracker();
	const velocityY = createVelocityTracker();
	const exitTimers = new Set<ReturnType<typeof setTimeout>>();
	/**
	 * The running turn's timer, whose only job is to take the animation off again
	 * once it has played. One at a time: a card is only ever turning one way.
	 */
	let turnTimer: ReturnType<typeof setTimeout> | null = null;

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

	/**
	 * How close this gesture is to committing, on whichever axis it locked to —
	 * which is one number, because a card only ever travels one way at a time. It
	 * inks the seal and lifts the card underneath, so the deck reveals where it is
	 * going whether that is off the side or off the top.
	 *
	 * A downward drag is measured as no travel at all (`Math.min(0, dragY)`): the
	 * card follows the finger down, but there is nothing down there to promise.
	 */
	const progress = $derived(
		commitProgress(dragAxis === 'y' ? Math.min(0, dragY) : dragX, cardWidth)
	);
	const rotation = $derived(rotationFor(dragX, cardWidth));
	const yesHint = $derived(dragAxis === 'x' && dragX > 0 ? stampOpacity(progress) : 0);
	const noHint = $derived(dragAxis === 'x' && dragX < 0 ? stampOpacity(progress) : 0);
	const starHint = $derived(dragAxis === 'y' && dragY < 0 ? stampOpacity(progress) : 0);

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

	/**
	 * THE INTRO REVEAL, and the only thing on this screen that happens by itself.
	 *
	 * The session's first card is dealt back up (`flippedId` starts on it, so the
	 * server's HTML and the first client render agree and hydration has nothing to
	 * argue with) and starts turning over IMMEDIATELY: there is no dwell, because the
	 * reveal is the turn, not the pause before it. The back is what the card is
	 * dealt as, and the poster is what it becomes while you watch — which is the
	 * whole discoverability story for tap-to-flip, since nothing else on the card
	 * advertises that it has a back.
	 *
	 * Two frames, and only two: one for the back to be on screen as a from-state
	 * (usually it has been since before this script ran — it is in the server's
	 * HTML), the next to attach the animation. Skip them and the turn would be
	 * requested on the frame the card mounts, where a browser is entitled to show
	 * the card face up rather than coming round.
	 *
	 * It runs ONCE: nothing it reads is read reactively, so an invalidation mid
	 * session cannot deal the current card back up again. If a thumb gets there
	 * first the card is already face up (`TAP_SLOP` clears the flip mid-drag) and
	 * a tap has toggled it deliberately — hence the id check, which only ever turns
	 * over the card the intro itself dealt. Under prefers-reduced-motion there is
	 * no reveal at all: the card starts face up.
	 *
	 * And it runs on the first swipe screen of a browser session only, which is the
	 * same gate as the dealt-back-up card and therefore the same value: `introId` is
	 * null when the server did not grant a reveal, so there is nothing here to check
	 * twice.
	 */
	$effect(() => {
		if (!introId) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			flippedId = null;
			return;
		}
		let shown = 0;
		const dealt = requestAnimationFrame(() => {
			shown = requestAnimationFrame(() => {
				if (flippedId === introId) turn(introId, false);
			});
		});
		return () => {
			cancelAnimationFrame(dealt);
			cancelAnimationFrame(shown);
		};
	});

	$effect(() => () => {
		cancelExitTimers();
		cancelTurnTimer();
	});

	function cancelExitTimers() {
		for (const timer of exitTimers) clearTimeout(timer);
		exitTimers.clear();
	}

	function cancelTurnTimer() {
		if (turnTimer !== null) clearTimeout(turnTimer);
		turnTimer = null;
	}

	/**
	 * The one path to a vote: gesture, buttons and keys all land here — and a star
	 * comes through it too, because a star is not a second kind of answer. It is
	 * split into a value and a flag at the very last moment, on `pending`, which is
	 * the only place that has to speak the server's language.
	 */
	function commit(action: SwipeAction) {
		const card = current;
		if (!card) return;

		// A vote is stamped on the artwork, so a card never leaves back-first. The
		// gesture has usually flipped it already; this covers the buttons and keys.
		// It SNAPS: not through `turn`, and any turn already running is dropped, so
		// the card that flies off is face up on the first frame rather than partway
		// through coming round.
		flippedId = null;
		turning = null;
		cancelTurnTimer();
		pending = {
			movieId: card.id,
			value: action === 'no' ? 'no' : 'yes',
			starred: action === 'star'
		};
		// Hand the card to the exit layer *before* the cursor moves, so the keyed
		// `each` sees it move slot rather than disappear: same DOM node, poster
		// already decoded, seal still stamped on it, and a CSS transition from
		// wherever the thumb left it.
		if (!reduceMotion) {
			exits = [...exits, { card, dir: action }];
			const timer = setTimeout(() => {
				exitTimers.delete(timer);
				exits = exits.filter((exit) => exit.card.id !== card.id);
			}, EXIT_MS + 60);
			exitTimers.add(timer);
		}
		restored = restored.filter((c) => c.id !== card.id);
		answered = [...answered, { card, value: action }];
		dragX = 0;
		dragY = 0;
		dragAxis = null;

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
		// The card comes back BLANK, whichever answer it had: no ink, no seal, no
		// star, and both axes back at rest. The star it may have carried a moment ago
		// is not a fact about the card any more — it is in `answered`, which this
		// Undo has just shortened — so the next swipe right on it posts the plain yes
		// the reader is looking at rather than quietly restoring a star.
		dragX = 0;
		dragY = 0;
		dragAxis = null;
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
		startY = event.clientY;
		dragX = 0;
		dragY = 0;
		dragAxis = null;
		velocityX.reset(event.clientX, event.timeStamp);
		velocityY.reset(event.clientY, event.timeStamp);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return;
		// clientX/Y against the down position, not movementX: no accumulated drift.
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		velocityX.sample(event.clientX, event.timeStamp);
		velocityY.sample(event.clientY, event.timeStamp);

		// The axis is answered ONCE and then kept, so a thumb that curls as it
		// travels cannot drag the card off its line halfway through.
		if (dragAxis === null) dragAxis = decideAxis(dx, dy);
		if (dragAxis === 'y') dragY = dy;
		else if (dragAxis === 'x') dragX = dx;

		if (!dragMoved && dragAxis !== null) {
			dragMoved = true;
			// The thumb has started an answer — sideways or up, it makes no difference
			// here: turn the card face up under it, without touching the drag. The
			// offsets are untouched, the pointer is still captured, and the same gesture
			// carries straight on to its commit — the poster simply arrives in time to
			// be stamped.
			if (flippedId !== null) turn(flippedId, false);
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
			dy: dragY,
			vx: velocityX.velocity(event.timeStamp),
			vy: velocityY.velocity(event.timeStamp),
			width: cardWidth,
			axis: dragAxis
		});
		if (choice) {
			commit(choice);
			return;
		}
		dragX = 0; // springs back
		dragY = 0;
		dragAxis = null;
		// It never travelled, so it was a tap. On the trailer button it opens the
		// trailer; ANYWHERE else on the card it turns the card over, which is the
		// whole affordance now that there is no token to aim at. Only the live top
		// card ever gets this far — a press is refused on any other (see
		// `onPointerDown`), so `current` is the card that was tapped.
		if (!dragMoved) {
			if (tapped) openTrailer(tapped);
			else if (current) flip(current.id);
		}
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		// The browser took the gesture over (scroll, system edge swipe). Never
		// turn that into a vote.
		pointerId = null;
		dragging = false;
		tapTarget = null;
		dragX = 0;
		dragY = 0;
		dragAxis = null;
	}

	/* ── keyboard (same commit path as the buttons) ────────────────── */
	function onKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		// A thumb is mid-gesture; let it finish rather than voting underneath it.
		if (dragging) return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable) return;
		if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

		// THE KEYS SAY WHAT THE GESTURES SAY. Left and right vote, and UP is now the
		// star, because up is the gesture — a key that means one thing on the card and
		// another in the hand would be worse than no key at all.
		//
		// Which moves the flip to ArrowDown, the one direction the card cannot be
		// pushed: nothing else on this screen wants it, and "put it down and read the
		// back" is a fair reading of it. Escape still only ever turns the card face
		// up. Both turn it the way a tap does — through `turn`, so the card comes
		// round rather than swapping faces under the reader.
		if (event.key === 'Escape' && flippedId !== null) turn(flippedId, false);
		else if (event.key === 'ArrowDown' && current) flip(current.id);
		else if (event.key === 'ArrowUp') commit('star');
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
	 * the blink. The half of a card that used to be printed only on the top one —
	 * the whole of the back — is mounted on every card in every role, and the
	 * difference between roles is opacity, hit-testing and tab order.
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
			// Percentages are of the card's own box — width on x, height on y — so this
			// clears any viewport. A STARRED card goes straight up off the top, and goes
			// up FLAT: the tilt belongs to a card thrown across the table, and a card
			// lifted off it has nothing to tilt against. Same property, same duration,
			// same easing as the sideways flight; only the direction differs.
			const star = entry.exit === 'star';
			const x = star ? '0px' : entry.exit === 'yes' ? 'calc(110% + 50vw)' : 'calc(-110% - 50vw)';
			const y = star ? 'calc(-110% - 50vh)' : '0px';
			const deg = star ? 0 : entry.exit === 'yes' ? EXIT_ROTATION_DEG : -EXIT_ROTATION_DEG;
			const fade = Math.round(EXIT_MS * 0.4);
			return `transform:translate3d(${x},${y},0) rotate(${deg}deg);opacity:0;transition:transform ${EXIT_MS}ms ${EXIT_EASE},opacity ${fade}ms linear ${EXIT_MS - fade}ms;will-change:transform`;
		}
		if (entry.depth > 0)
			return 'transform:translate3d(0px,0px,0) rotate(0deg);will-change:transform';
		const spring = dragging || reduceMotion ? 'none' : `transform ${SPRING_MS}ms ${SPRING_EASE}`;
		return `transform:translate3d(${dragX.toFixed(1)}px,${dragY.toFixed(1)}px,0) rotate(${rotation.toFixed(2)}deg);transition:${spring};will-change:transform`;
	}

	/* ── the flip ─────────────────────────────────────────────────── */
	/**
	 * The card the screen is actually for: on top, not on its way out. It is the
	 * only one that can turn over, and the only one whose back can be read or whose
	 * trailer can be reached.
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

	/**
	 * TURNING THE CARD, animated. Every turn anyone can see starts here: the tap,
	 * the key, the first pixels of a drag and the intro reveal.
	 *
	 * The turn is a keyframe animation and not a transition, because it passes
	 * through a midpoint — the card grows towards you as it comes round and settles
	 * back to its own size — and a transition has no midpoint to hit. Which is why
	 * the fact that a card is turning has to be STATE: the resting poses stay plain
	 * classes, and the animation is attached only while a turn is actually running.
	 * Written into the resting state instead it would replay on every card that
	 * mounts, and cards mount constantly as the deck advances.
	 *
	 * `commit` deliberately does not come through here: a card that has been voted
	 * on snaps face up as it leaves, so the seal is on the poster from frame one.
	 */
	function turn(movieId: string, showBack: boolean) {
		flippedId = showBack ? movieId : null;
		if (reduceMotion) return;
		turning = { id: movieId, dir: showBack ? 'to-back' : 'to-face' };
		cancelTurnTimer();
		turnTimer = setTimeout(() => {
			turnTimer = null;
			turning = null;
		}, FLIP_MS + 60);
	}

	function flip(movieId: string) {
		turn(movieId, flippedId !== movieId);
	}

	/**
	 * The animation a card wears WHILE IT IS TURNING, and only then — one card at a
	 * time, by movie id, like every other cursor here. A card in flight is excluded
	 * outright: it snaps.
	 *
	 * It goes on TWO elements, which are the two things a turn moves: the flipping
	 * layer, which rotates and swells, and the drag layer, whose cast shadow drops
	 * and closes with it (the shadow is that element's pseudo-element, deliberately
	 * outside the 3D — see the stylesheet). One state, one duration, one easing, so
	 * the shadow cannot drift out of step with the card it belongs to.
	 *
	 * Style only, like every other difference between a card's roles. What a card is
	 * MADE of does not change (see the invariant in `cardStyle`).
	 */
	function turnClass(entry: Entry): string {
		if (entry.exit || turning === null || turning.id !== entry.card.id) return '';
		return turning.dir === 'to-back' ? 'is-turning-back' : 'is-turning-face';
	}

	/**
	 * The trailer, opened exactly as the markup promises — the anchor's own href, a
	 * new tab, no opener — just driven from the release rather than from a click the
	 * pointer capture may have eaten.
	 */
	function openTrailer(link: HTMLAnchorElement) {
		window.open(link.href, '_blank', 'noopener');
	}

	/**
	 * The click side of the trailer link, the one link left inside a card.
	 *
	 * From the KEYBOARD (`detail === 0`: no coordinates, no gesture) it is simply a
	 * link and is left alone. A POINTER click is only ever the tail of a gesture
	 * already resolved on release, so it is cancelled: the tap opened the trailer
	 * from there, and a second activation would open a second tab.
	 */
	function onCardTapClick(event: MouseEvent) {
		if (event.detail !== 0) event.preventDefault();
	}

	/**
	 * Stamp/tint strength for a layer: full on a committed card, live on the top one.
	 *
	 * A starred card wears the STAR alone, not a star over a yes. It is one answer,
	 * so it is one seal — the brass one, which says the louder thing.
	 */
	function hints(entry: Entry): { yes: number; no: number; star: number } {
		if (entry.exit) {
			return {
				yes: entry.exit === 'yes' ? 1 : 0,
				no: entry.exit === 'no' ? 1 : 0,
				star: entry.exit === 'star' ? 1 : 0
			};
		}
		if (entry.depth > 0) return { yes: 0, no: 0, star: 0 };
		return { yes: yesHint, no: noHint, star: starHint };
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet face(card: Card, yes: number, no: number, star: number)}
	<Poster path={card.posterPath} title={card.title} size="w500" eager />

	<!-- Direction hint: a wash of ink plus the seal that names the vote. Same
	     stamp component the reveal slams onto the winner — dragging the card is
	     literally inking it. The third ink is brass, and it arrives from below:
	     push the card up and it comes up starred. -->
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
	<div
		class="pointer-events-none absolute inset-0 bg-brass"
		style="opacity:{(star * 0.3).toFixed(3)}"
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
	<!-- The star is stamped low and centred, clear of the two corner seals it can
	     never appear beside: the axis is locked, so a card is either voting or
	     starring, and the ink that is not being used is at zero. -->
	<div class="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
		<Stamp
			word="Star"
			tone="brass"
			size="1.85rem"
			rotate={-6}
			opacity={star}
			scale={0.82 + 0.18 * star}
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
			The header takes the full width of the stock: there is no token to make
			room for beside it, because the way back is the card itself — a tap
			anywhere on it turns it over again.
		-->
		<div class="shrink-0">
			<h3 class="stencil text-[0.8rem] leading-[1.15] font-semibold text-ink uppercase">
				{card.title}
			</h3>
			{#if card.details?.tagline}
				<p class="display mt-1 line-clamp-2 text-[0.7rem] leading-[1.2] text-ink-soft">
					{card.details.tagline}
				</p>
			{/if}
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
				onclick={onCardTapClick}
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
	NOTHING here clips, deliberately. A committed card flies a full viewport past
	the stack and that has to be contained — unclipped it grows the document and
	lets the page be dragged sideways for the length of the animation — but the
	containment belongs to the width of the SCREEN, so it lives on `html` (app.css)
	and on the shell's scroll region, which spans it. Clipping it
	here cut the card off at this column's edge, which is the width of the content
	and not of the screen: invisible on a phone, and on a desktop a card that
	disappeared at a line in the middle of the felt.
-->
<div class="space-y-4">
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
		<!-- Stated on every swipe, true or false: see `pending`. -->
		<input type="hidden" name="starred" value={pending.starred} />
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
					<!--
						A layer that is not the deck's is not in the deck's way either. A card in
						flight keeps its layer for the length of the animation plus a margin, and
						that layer is a full-size transparent box sitting at `EXIT_Z` — over the
						whole stack. The CARD inside it was made inert; the box was not. So for the
						320ms after every single commit, every press and every drag aimed at the
						card that had just been promoted landed on the layer of the card that had
						just left, and the new top card could be neither dragged nor tapped until
						that box was dropped. Nothing inside a card in flight wants a pointer — it
						cannot be dragged or turned over, its back's trailer link is switched off,
						and its seal is decorative — so the whole layer stops hit-testing, and the
						deck underneath answers the first touch it is given.
					-->
					<div
						class="absolute inset-0 {entry.exit ? 'pointer-events-none' : ''}"
						style={layerStyle(entry)}
					>
						<!--
							The card is not a control — the buttons below are, and every key
							is handled on the window. It carries the pointer gesture only: a
							drag, or a tap that turns it over. Hence the presentation role, no
							tab stop and no keyboard handler of its own; from the keyboard the
							card is turned over with ArrowDown, back with ArrowDown or Escape.
						-->
						<!--
							THE HAND: the drag lives here, and only here. This element carries
							the gesture's translate/rotate — and the shadow the card casts on the
							table, as a pseudo-element, so the shadow follows the thumb by being
							moved by the same transform. It does not sit still while the card
							turns above it either: it wears the turn's own state (see
							`turnClass`) and drops, narrows and softens on keyframes of its own,
							in step with the card. Drag and flip COMPOSE rather than overwrite
							each other: this transform moves the card, the one two levels down
							turns it over, and neither ever writes the other's property.

								`touch-none` ON THE LIVE CARD, AND NOWHERE ELSE. It used to be
								`touch-pan-y`, which handed every vertical gesture to the scroller —
								and the scroller cannot be asked to share, because a browser decides
								whether a touch is a scroll or ours within the first few pixels and
								never revisits it. Swipe-up needs the whole touch, so on the top card
								the page does not scroll at all. THE TRADE: on a phone too short to
								fit this screen, a finger that starts ON the card can no longer scroll
								it. The felt either side still scrolls, as do the title, the tokens
								and the undo row below — and the card is `max-w-[16.5rem]` inside a
								wider column, so there is always a margin to scroll from. Style only,
								like every other difference between roles: the cards behind and in
								flight are `pointer-events-none`, so no touch reaches them to argue.
						-->
						<div
							class="swipe-card relative h-full w-full rounded-md select-none {turnClass(
								entry
							)} {entry.exit || entry.depth > 0 ? 'pointer-events-none' : 'touch-none'}"
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
									inside a frame. It carries the turn ONLY while it is turning
									(see `turn`), and a committed card is given none at all — it
									snaps face up as it leaves, so the seal is on the poster from the
									first frame.
								-->
								<div
									class="card-flip absolute inset-0 {showing ? 'is-flipped' : ''} {turnClass(
										entry
									)}"
									style={entry.exit ? 'animation:none' : ''}
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
										{@render face(entry.card, hint.yes, hint.no, hint.star)}
									</div>
									<!--
										The back is turned twice — once by itself, once by the container that flips
										— so on screen it is NOT mirrored, which is why its print reads the right
										way round. Kraft stock, edge to edge, clipped by the same corners as the
										face: a card is one flat object whichever way it is facing, and the only
										shadow near it is the one it casts on the felt — which is not printed on
										either face, so it never turns; it narrows with the turn from outside the 3D.

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
			<!-- Quiet, and it names all three directions now: the star has no token of
			     its own on this screen, so this line is where anyone finds out about it. -->
			<p class="max-w-56 text-right text-[0.7rem] leading-snug text-chalk-dim">
				Swipe right for yes, left for no, up to star one —
				<span class="inline-flex items-center gap-0.5 align-[-2px]" aria-hidden="true">
					<ArrowLeft size={12} /> / <ArrowRight size={12} />
				</span><span class="sr-only">the left, right and up arrow keys</span> work too. Tap the card
				to see what the film is about<span class="sr-only">
					— or press the down arrow key to turn it over and back</span
				>.
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

		THE TWO POSES ARE PLAIN CLASSES and the turn between them is an animation
		attached only while a card is actually turning (see `turn` in the script).
		Both halves of that matter. The turn needs a midpoint — the card grows
		towards you as it comes round, so it reads as leaving the table rather than
		spinning on it — and a transition cannot hold one. And the resting poses must
		stay poses: an animation written into them plays on every card that mounts,
		and at depth 1 a card mounts on every single commit, so the deck would turn a
		card over behind the one being swiped.

		Under prefers-reduced-motion there is no turn at all, just the other face: the
		script does not attach the animation, the block below cuts it anyway, and the
		global block in app.css zeroes every duration on the page for good measure.
	*/
	.card-flip {
		transform-style: preserve-3d;
		transform: rotateY(0deg);
	}

	.card-flip.is-flipped {
		transform: rotateY(180deg);
	}

	/* 350ms is `FLIP_MS` in the script, which times the class off again. */
	.card-flip.is-turning-back {
		animation: card-turn-to-back 350ms ease-in-out;
	}

	.card-flip.is-turning-face {
		animation: card-turn-to-face 350ms ease-in-out;
	}

	/*
		The card comes towards you and settles back: rotateY does the turning, the
		scale does the lift, and the two are written into one transform so they cannot
		fight over the property. The scale peaks where the card is edge-on, which is
		also where the easing of each half meets — the one frame of the turn where
		nothing is visible, so nothing shows for it.

		1.13 at the midpoint, not a hair over 1: on a card this size a lift you have
		to be told about is not a lift. It has to read as the card leaving the table
		to turn — which is also why the shadow below drops, spreads and closes to a
		sliver at the same instant.

		The way back UNWINDS the same turn (180° → 90° → 0°) rather than carrying on
		round: turning a card back is the gesture reversed, not a second lap.
	*/
	@keyframes card-turn-to-back {
		from {
			transform: scale(1) rotateY(0deg);
		}
		50% {
			transform: scale(1.13) rotateY(90deg);
		}
		to {
			transform: scale(1) rotateY(180deg);
		}
	}

	@keyframes card-turn-to-face {
		from {
			transform: scale(1) rotateY(180deg);
		}
		50% {
			transform: scale(1.13) rotateY(90deg);
		}
		to {
			transform: scale(1) rotateY(0deg);
		}
	}

	/*
		THE SHADOW THE CARD CASTS, which belongs to the card and not to the felt.

		It hangs off the element the GESTURE transforms, so it follows the thumb for
		free: one transform moves the card and its shadow together, and there is
		nothing to keep in sync during a drag. What it no longer does is sit still
		while the card turns above it — it wears the same `is-turning-*` state the
		flip does and drops, spreads and CLOSES on keyframes of its own, so what turns
		reads as one object lifting off the table rather than a card revolving over a
		blob that never moves.

		Deliberately OUTSIDE the 3D. Put on the faces it would ride the turn for
		nothing, but a shadow is cast on the table rather than printed on the stock,
		and Gecko draws box-shadow oddly on 3D-transformed elements — this screen has
		paid for that lesson once already. Out here the shadow is also purely
		compositable: the blur is painted once, and only `transform` and `opacity`
		are ever animated, so turning a card never repaints one.

		`z-index: -1` puts it behind both faces, which are opaque, so the only part
		of it anyone sees is the part that falls on the felt — exactly what the
		shadow utility that used to be on this element painted. `border-radius:
		inherit` keeps the card's corners stated once, up in the markup. And the
		layer is asked for on the frame it mounts, like the card's own above it: a
		turn is not the moment to negotiate a new one.
	*/
	.swipe-card::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		box-shadow: 0 16px 24px rgb(0 0 0 / 0.32);
		pointer-events: none;
		will-change: transform;
	}

	/* Same 350ms and same easing as the turn above: one motion, not two. */
	.swipe-card.is-turning-back::after,
	.swipe-card.is-turning-face::after {
		animation: card-cast-lift 350ms ease-in-out;
	}

	/*
		Lower, taller, NARROWER and fainter halfway round, back to rest by the end —
		what a shadow does as the thing casting it rises and turns edge-on.

		The two axes do different jobs, which is why the scale is written as a pair.
		Vertically the shadow spreads a little (1.09 against the card's 1.13: the card
		is coming towards the eye, the shadow only spreads on the table). Horizontally
		it COLLAPSES to a sliver, because a card seen edge-on has no width to cast —
		and the horizontal extent is the whole reason this exists: a full-width blob
		under a card standing on its edge is not that card's shadow, it is the felt's.

		The intermediate stops are what keep the sliver honest. A card's apparent
		width through the turn is the cosine of its angle, and the angle is eased, so
		at a quarter of the way through the card is at 45° and about 0.7 as wide;
		interpolated straight from full to sliver the shadow would be down to a half
		by then and visibly ahead of the card. cos 45° written down at 25% and 75%
		puts the two back on the same curve.

		The layer scales, so the box-shadow's 16px drop and 24px blur scale with it —
		vertically to ~26px of blur under a 27px drop, horizontally down to ~3px,
		which is what makes the sliver read as an edge rather than a smudge. The
		opacity floor is what stops the edge reading as a hard bar at the one instant
		the card is invisible and none of it is hidden behind the stock.

		Symmetric about the midpoint, so the one keyframe serves both directions of
		the turn and the intro reveal.
	*/
	@keyframes card-cast-lift {
		from {
			transform: translateY(0) scale(1, 1);
			opacity: 1;
		}
		25% {
			transform: translateY(5px) scale(0.72, 1.05);
			opacity: 0.88;
		}
		50% {
			transform: translateY(10px) scale(0.14, 1.09);
			opacity: 0.62;
		}
		75% {
			transform: translateY(5px) scale(0.72, 1.05);
			opacity: 0.88;
		}
		to {
			transform: translateY(0) scale(1, 1);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card-flip,
		.swipe-card::after {
			animation: none !important;
		}
	}

	/*
		The two faces, written ONCE: FLAT stock, no lip and no printed edge. On this
		table an extrusion means pressable, and the card is not a control — the
		tokens under it are. Neither face carries a shadow at all: the only one the
		card owns is the soft one it casts on the felt, which hangs off the element
		the gesture moves (see `.swipe-card::after`) and is animated from there in
		step with the turn — out of the 3D, where Gecko is to be trusted with it.

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
</style>
