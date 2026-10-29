<!--
	THE HALLOWEEN TABLE'S DRESSING — two corner cobwebs and a spider on a thread,
	for the Halloween preset only (ThemeOrnament's sibling; the Christmas table,
	custom themes and ordinary nights get none of it).

	It is its own strip of felt at the top of the round screen: a band in the flow,
	pulled out into the scroll region's padding so the webs sit in its real top
	corners, and tall enough that nothing printed on the screen starts until the
	band ends. That is the whole overlap guarantee — the webs and the spider live in
	space no text, ticket or button ever occupies — so it needs no z-index games,
	and `pointer-events: none` is only a belt.

	Cut like the ornament: the spider is a die-cut chipboard piece (solid ink with
	its face printed in board stock, the soft shadow a dealt piece casts) — cute,
	not creepy: round, two big eyes, a smile. The webs are not pieces, they are chalk: thin, faint lines on
	the felt, drawn in the table's own chalk ink so they belong to the palette.

	The spider sways slowly on its thread and bobs a little. Under
	prefers-reduced-motion it simply hangs still (cut here outright, and app.css
	zeroes animations globally as well).

	Purely decorative and aria-hidden: it says nothing the theme chip doesn't.
-->
<script lang="ts">
	/**
	 * A corner web anchored at (0, 0) in a w × h box: spokes fanning out from the
	 * corner, and rings strung between neighbouring spokes that sag back towards it,
	 * the way silk does. The two walls (the box's top and left edges) are where the
	 * outermost rings are tied off.
	 */
	function cornerWeb(w: number, h: number): string {
		const angles = [0, 18, 40, 62, 90].map((deg) => (deg * Math.PI) / 180);
		const point = (angle: number, r: number) => [Math.cos(angle) * r * w, Math.sin(angle) * r * h];
		const spokes = angles
			.slice(1, -1)
			.map((angle) => {
				const [x, y] = point(angle, 1);
				return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join('');
		const rings = [0.28, 0.52, 0.76, 0.96]
			.map((r) =>
				angles
					.slice(1)
					.map((angle, i) => {
						const [x0, y0] = point(angles[i], r);
						const [x1, y1] = point(angle, r);
						// The control point is the chord's midpoint pulled a quarter of the
						// way back to the corner: the sag.
						const cx = ((x0 + x1) / 2) * 0.78;
						const cy = ((y0 + y1) / 2) * 0.78;
						return `${i === 0 ? `M${x0.toFixed(1)} ${y0.toFixed(1)}` : ''}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
					})
					.join('')
			)
			.join('');
		return spokes + rings;
	}

	const bigWeb = cornerWeb(72, 56);
	const smallWeb = cornerWeb(54, 44);
</script>

<!-- The band: -mx-4/-mt-5 undo `main`'s padding so the webs reach the scroll
     region's corners; its height is what keeps the screen's first line clear. -->
<div class="decor pointer-events-none relative -mx-4 -mt-5 h-[3.75rem]" aria-hidden="true">
	<svg class="absolute top-0 left-0" width="72" height="56" viewBox="0 0 72 56" focusable="false">
		<path d={bigWeb} class="web" />
	</svg>
	<svg
		class="absolute top-0 right-0 -scale-x-100"
		width="54"
		height="44"
		viewBox="0 0 54 44"
		focusable="false"
	>
		<path d={smallWeb} class="web" />
	</svg>

	<!-- The spider, hung from the lid's rule. The outer layer sways about the top of
	     the thread (a pendulum); the inner one bobs the spider a couple of pixels,
	     and the thread runs on behind its body, so a bob never shows a gap. -->
	<div class="sway absolute top-0 left-[63%]">
		<svg width="30" height="48" viewBox="0 0 30 48" focusable="false" class="overflow-visible">
			<line x1="15" y1="0" x2="15" y2="30" class="silk" />
			<g class="bob">
				<g
					stroke="var(--color-ink)"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					fill="none"
				>
					<!-- Four legs a side, bent at the knee. -->
					<path d="M9 30L3 26 1 30M9 33L2 32 0 36M9 36L3 38 2 42M10 39L6 43 6 46" />
					<path d="M21 30L27 26 29 30M21 33L28 32 30 36M21 36L27 38 28 42M20 39L24 43 24 46" />
				</g>
				<!-- Body: solid ink, the face printed on it in board stock. -->
				<circle
					cx="15"
					cy="35"
					r="8"
					fill="var(--color-ink)"
					stroke="var(--color-ink)"
					stroke-width="2"
				/>
				<!-- Big eyes and a small smile: the cute end of spider. -->
				<circle cx="12" cy="33.5" r="2.4" fill="var(--color-board)" />
				<circle cx="18" cy="33.5" r="2.4" fill="var(--color-board)" />
				<circle cx="12.8" cy="32.7" r="0.8" fill="var(--color-ink)" />
				<circle cx="18.8" cy="32.7" r="0.8" fill="var(--color-ink)" />
				<path
					d="M12.5 37.8q2.5 2 5 0"
					fill="none"
					stroke="var(--color-board)"
					stroke-width="1.4"
					stroke-linecap="round"
				/>
			</g>
		</svg>
	</div>
</div>

<style>
	/* Chalk on the felt, faint: drawn, not dealt. */
	.web,
	.silk {
		fill: none;
		stroke: var(--color-chalk);
		stroke-width: 1;
		stroke-linecap: round;
		opacity: 0.5;
	}

	.silk {
		opacity: 0.65;
	}

	.sway {
		transform-origin: 50% 0;
		animation: spider-sway 5.5s ease-in-out infinite alternate;
		/* The shadow a dealt piece casts, as on the ornament. */
		filter: drop-shadow(0 3px 3px rgb(0 0 0 / 0.35));
	}

	.bob {
		animation: spider-bob 2.75s ease-in-out infinite alternate;
	}

	@keyframes spider-sway {
		from {
			rotate: -6deg;
		}
		to {
			rotate: 6deg;
		}
	}

	@keyframes spider-bob {
		from {
			translate: 0 0;
		}
		to {
			translate: 0 3px;
		}
	}

	/* Static when motion is unwelcome: it hangs straight down and stays put. */
	@media (prefers-reduced-motion: reduce) {
		.sway,
		.bob {
			animation: none;
		}
	}
</style>
