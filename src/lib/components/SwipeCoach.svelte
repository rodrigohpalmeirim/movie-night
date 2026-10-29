<!--
	THE GESTURE COACH: how the swipe deck is played, said once, all at once.

	Nothing on a swipe card advertises what it does. It has no token to press and
	no corner to turn, so the two gestures that are not the obvious ones — push it
	UP to star it, TAP it to turn it over — would otherwise be found by accident or
	not at all. So the first time a device reaches the deck, the table is dimmed and
	all four moves are laid out over the card they are made on, each where it is
	made: no to the left, yes to the right, the star off the top and the tap in the
	middle. One screen, not a tour — there is nothing to step through, and a lesson
	that has to be clicked through is a lesson people click through unread.

	The yes, no and star are labelled with the SEALS themselves — the same stamp,
	ink and tilt that drag onto the card as it moves — so what is shown here is
	exactly what the reader will see happen. The seal is decorative, as it is
	everywhere (see `Stamp`), so every gesture also says its meaning in real text.

	Each gesture has a small hand that plays it on a loop, staggered so the eye is
	led round the four rather than asked to watch them all at once. Under
	prefers-reduced-motion the hands stand still, each caught mid-gesture beside
	its arrow — a picture of the move rather than nothing.

	It is a modal in every sense that matters: a dialog, named by its heading,
	that takes focus when it opens and hands it back when it closes, keeps Tab
	inside itself, and closes on Escape. A tap ANYWHERE closes it too — on the
	scrim, on the card, on the lesson itself — because there is nothing in it to
	interact with but the way out. It does not, itself, stop the deck from
	answering keys behind it: the page is told it is open and stands down (see
	`coaching` in the swipe page); the scrim is what stops the pointer.

	It is laid over the CARD, not the screen. The element is the card's own box,
	so the gestures sit on the card at any size without measuring anything — which
	is also what lets the server print it on the first paint, before any script
	has run. The dimming is a pseudo-element pinned to the viewport, so it covers
	the whole table, lid and tray included, while the lesson stays where the card
	is.

	Closing is the PAGE's business, because closing spends the device's one
	showing: the page owns the form that tells the server so. The "Got it" button
	is that form's submit button (by `form` id, since the form cannot be here — it
	has to outlive the overlay), which is what makes it work with no JavaScript at
	all; every other way out calls `ondismiss`, which posts the same form.
-->
<script lang="ts">
	import ArrowLeft from '$lib/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/icons/ArrowRight.svelte';
	import ArrowUp from '$lib/icons/ArrowUp.svelte';
	import Pointer from '$lib/icons/Pointer.svelte';
	import Stamp from './Stamp.svelte';

	let {
		form,
		ondismiss
	}: {
		/** Id of the page's form that records the dismissal; "Got it" submits it. */
		form: string;
		/** Every other way out: a tap anywhere, Escape. */
		ondismiss: () => void;
	} = $props();

	let panel = $state<HTMLDivElement | undefined>(undefined);
	let done = $state<HTMLButtonElement | undefined>(undefined);

	/**
	 * Focus in on the way up, focus back on the way down. The overlay is mounted
	 * exactly while it is open, so mount and unmount ARE open and close — including
	 * the close nobody asked for, when the deck empties under it.
	 *
	 * The dialog itself takes focus rather than its button, so a screen reader
	 * starts at the heading and the lesson, not halfway down at the way out; Tab
	 * then lands on "Got it". Handed back to whatever had it before — the `?` that
	 * opened it, usually — and to nothing when that was the page itself, which is
	 * the first visit: there is no control a reader was on to return them to.
	 */
	$effect(() => {
		const before = document.activeElement;
		panel?.focus({ preventScroll: true });
		return () => {
			if (before instanceof HTMLElement && before !== document.body && before.isConnected) {
				before.focus({ preventScroll: true });
			}
		};
	});

	/**
	 * On the window, not on the panel: a key pressed with focus anywhere — or
	 * nowhere — still belongs to the dialog while it is up. Escape closes it, and
	 * Tab has exactly one stop to go to, so it goes there, from either direction.
	 * Everything else is left alone; the page ignores it while the coach is open.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			ondismiss();
		} else if (event.key === 'Tab') {
			event.preventDefault();
			done?.focus();
		}
	}

	/**
	 * A tap anywhere is a dismissal — except on "Got it", which already is one
	 * natively, by submitting the form. Letting the tap close the overlay as well
	 * would unmount the button between its click and its submission, and a button
	 * that has left the document submits nothing.
	 */
	function onClick(event: MouseEvent) {
		if ((event.target as Element | null)?.closest('[data-coach-done]')) return;
		ondismiss();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- The keyboard's way out is Escape, on the window (see `onKeydown`); the click
     handler is the pointer's, and is not a control of its own. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={panel}
	class="coach absolute inset-0 z-50 cursor-pointer outline-none"
	role="dialog"
	aria-modal="true"
	aria-labelledby="swipe-coach-title"
	tabindex="-1"
	onclick={onClick}
>
	<!-- The card's outline, drawn over its dimmed self: this is the thing every
	     gesture below is made on. A child and not the panel's own border, which
	     would be painted underneath the scrim. It dims the card a shade further
	     than the table, too: a poster is the busiest thing on the screen, and the
	     lesson is printed straight on top of it. -->
	<div
		class="pointer-events-none absolute inset-0 rounded-md border-2 border-dashed border-board-shade/80 bg-felt-deep/60"
		aria-hidden="true"
	></div>

	<div class="relative flex h-full flex-col items-center px-2 pt-3.5 pb-3 text-center">
		<h2 id="swipe-coach-title" class="display text-[1.3rem] text-board">How to swipe</h2>

		<ul class="mt-2 flex w-full flex-1 flex-col justify-around">
			<!-- Up, at the top: the card leaves that way. -->
			<li class="flex flex-col items-center">
				<span class="coach-glyph coach-glyph-y" style="--coach-delay:2s" aria-hidden="true">
					<ArrowUp size={18} class="coach-arrow top-0 left-1/2 -translate-x-1/2" />
					<span class="coach-hand"><Pointer size={24} /></span>
				</span>
				<Stamp word="Star" tone="brass" size="0.95rem" rotate={-6} class="mt-1" />
				<p class="coach-caption">
					Swipe up<span class="sr-only"> to star it</span>
					<span class="coach-note">a starred yes</span>
				</p>
			</li>

			<!-- The middle row: the two answers at the edges they leave by, and the
			     tap where a thumb actually taps. -->
			<li class="grid grid-cols-3 items-start">
				<div class="flex flex-col items-center">
					<span class="coach-glyph coach-glyph-x" style="--coach-dir:-1;--coach-delay:1s" aria-hidden="true">
						<ArrowLeft size={18} class="coach-arrow top-1/2 left-0 -translate-y-1/2" />
						<span class="coach-hand"><Pointer size={24} /></span>
					</span>
					<Stamp word="Nope" tone="cherry" size="0.95rem" rotate={12} class="mt-1" />
					<p class="coach-caption">Swipe left<span class="sr-only"> for no</span></p>
				</div>

				<div class="flex flex-col items-center">
					<span class="coach-glyph coach-glyph-tap" style="--coach-delay:3s" aria-hidden="true">
						<span class="coach-ring"></span>
						<span class="coach-hand"><Pointer size={24} /></span>
					</span>
					<p class="coach-caption mt-1">
						Tap the card<span class="sr-only"> to turn it over</span>
						<span class="coach-note">plot, cast &amp; trailer on the back</span>
					</p>
				</div>

				<div class="flex flex-col items-center">
					<span class="coach-glyph coach-glyph-x" style="--coach-dir:1;--coach-delay:0s" aria-hidden="true">
						<ArrowRight size={18} class="coach-arrow top-1/2 right-0 -translate-y-1/2" />
						<span class="coach-hand"><Pointer size={24} /></span>
					</span>
					<Stamp word="Yes" tone="jade" size="0.95rem" rotate={-13} class="mt-1" />
					<p class="coach-caption">Swipe right<span class="sr-only"> for yes</span></p>
				</div>
			</li>
		</ul>

		<button
			bind:this={done}
			type="submit"
			{form}
			data-coach-done
			class="token token-brass mt-2 w-full max-w-[12rem]"
		>
			Got it
		</button>
	</div>
</div>

<style>
	/*
		THE SCRIM, pinned to the viewport from inside the card's box. `fixed`
		resolves against the viewport because nothing between here and the root
		transforms, filters or contains — the same fact the flying cards rely on to
		pass over the tray. `z-index: -1` is inside the panel's own stacking context
		(it is `z-50`), so the scrim is behind the lesson and in front of everything
		else on the page: the deck, the lid, the tray, a card still in flight.

		It is a pseudo-element of the dialog, so a tap on it is a tap on the dialog —
		which is what closes it — and it soaks up every pointer the deck would
		otherwise have been handed.
	*/
	.coach::before {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -1;
		background-color: color-mix(in srgb, var(--color-felt-deep) 84%, transparent);
		touch-action: none;
	}

	/* The table dims rather than the lesson snapping on: the same quick settle
	   everything else that lands on the felt has. */
	.coach {
		touch-action: none;
		animation: coach-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards;
	}

	@keyframes coach-in {
		from {
			opacity: 0;
		}
	}

	.coach-caption {
		margin-top: 0.4rem;
		font-family: var(--font-stencil);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		line-height: 1.2;
		text-transform: uppercase;
		color: var(--color-chalk);
	}

	.coach-note {
		display: block;
		margin-top: 0.1rem;
		font-family: var(--font-sans);
		font-size: 0.66rem;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--color-chalk-dim);
	}

	/*
		THE GESTURES. Each is a small stage: an arrow at the end the card goes to,
		chalked on faintly, and a hand that plays the move along it — or, for the tap,
		presses down and leaves a ring where the fingertip was.

		The RESTING pose is the illustration, and the keyframes only run between
		poses around it: so under reduced motion, where the animation is taken off
		outright, each hand is left standing mid-gesture where the picture wants it,
		not wherever a zeroed animation happened to drop it.

		All four loop on one 4s period, offset by `--coach-delay` in whole seconds,
		so they play in turn — right, left, up, tap — and only ONE hand is ever on
		the card: every keyframe set fades its hand in and out inside the first
		quarter of the period, its own slot, and holds it hidden for the other three.
		(`both` fill keeps a hand hidden through its delay on the first lap too.)
	*/
	.coach-glyph {
		position: relative;
		display: block;
		color: var(--color-chalk-dim);
	}

	.coach-glyph-x {
		width: 4rem;
		height: 2.6rem;
	}

	.coach-glyph-y {
		width: 2.6rem;
		height: 3.2rem;
	}

	.coach-glyph-tap {
		width: 2.6rem;
		height: 2.6rem;
	}

	.coach-glyph :global(.coach-arrow) {
		position: absolute;
		opacity: 0.75;
	}

	/* The fingertip (the top of the icon, a third of the way in) is the point
	   that travels; the icon is placed so it sits on the arrow's line. */
	.coach-hand {
		position: absolute;
		display: block;
		left: 50%;
		top: 50%;
		color: var(--color-board);
		filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.45));
		animation: 4s ease-in-out var(--coach-delay, 0s) infinite both;
	}

	.coach-glyph-x .coach-hand {
		transform: translate(-35%, -15%) translateX(calc(var(--coach-dir, 1) * 0.35rem));
		animation-name: coach-swipe-x;
	}

	.coach-glyph-y .coach-hand {
		transform: translate(-35%, 0) translateY(-0.2rem);
		animation-name: coach-swipe-y;
	}

	.coach-glyph-tap .coach-hand {
		transform: translate(-35%, -10%);
		animation-name: coach-tap;
	}

	@keyframes coach-swipe-x {
		0% {
			opacity: 0;
			transform: translate(-35%, -15%) translateX(calc(var(--coach-dir, 1) * -0.85rem));
		}
		3% {
			opacity: 1;
			transform: translate(-35%, -15%) translateX(calc(var(--coach-dir, 1) * -0.85rem));
		}
		17% {
			opacity: 1;
			transform: translate(-35%, -15%) translateX(calc(var(--coach-dir, 1) * 0.6rem));
		}
		22%,
		100% {
			opacity: 0;
			transform: translate(-35%, -15%) translateX(calc(var(--coach-dir, 1) * 0.6rem));
		}
	}

	@keyframes coach-swipe-y {
		0% {
			opacity: 0;
			transform: translate(-35%, 0) translateY(0.9rem);
		}
		3% {
			opacity: 1;
			transform: translate(-35%, 0) translateY(0.9rem);
		}
		17% {
			opacity: 1;
			transform: translate(-35%, 0) translateY(-0.9rem);
		}
		22%,
		100% {
			opacity: 0;
			transform: translate(-35%, 0) translateY(-0.9rem);
		}
	}

	/* Down, and back up: a press, not a drag — faded in and out like the swipes,
	   so it is not left standing on the card while the others play. */
	@keyframes coach-tap {
		0% {
			opacity: 0;
			transform: translate(-35%, -10%) scale(1);
		}
		3%,
		6% {
			opacity: 1;
			transform: translate(-35%, -10%) scale(1);
		}
		9% {
			opacity: 1;
			transform: translate(-35%, -2%) scale(0.88);
		}
		13%,
		18% {
			opacity: 1;
			transform: translate(-35%, -10%) scale(1);
		}
		22%,
		100% {
			opacity: 0;
			transform: translate(-35%, -10%) scale(1);
		}
	}

	/* Where the fingertip landed. At rest it is simply there, a ring under the
	   finger; animated, it spreads and fades from the moment of the press. */
	.coach-ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 1.6rem;
		height: 1.6rem;
		margin: -0.8rem 0 0 -0.8rem;
		border: 2px solid var(--color-brass);
		border-radius: 9999px;
		opacity: 0.8;
		animation: coach-ring 4s ease-out var(--coach-delay, 0s) infinite both;
	}

	@keyframes coach-ring {
		0%,
		8% {
			opacity: 0;
			transform: scale(0.3);
		}
		9% {
			opacity: 0.9;
			transform: scale(0.45);
		}
		22%,
		100% {
			opacity: 0;
			transform: scale(1.5);
		}
	}

	/* Still pictures, not a frozen loop: the resting poses above are the stills. */
	@media (prefers-reduced-motion: reduce) {
		.coach,
		.coach-hand,
		.coach-ring {
			animation: none !important;
		}
	}
</style>
