<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';

	let { children } = $props();

	// The group shell pins a tab bar to the bottom of the viewport, so the footer
	// needs enough clearance to sit above it (plus the iOS safe area) instead of
	// disappearing behind it. Elsewhere it only needs the safe area.
	const inGroup = $derived(page.url.pathname.startsWith('/g/'));

	/**
	 * Which of the four felt tables a route belongs to, in tab-bar order — the
	 * runoff screens (veto, pairs) are legs of the Round flow, and a movie's
	 * detail page and the swipe stack are legs of the Pool. Anything else
	 * (landing, picker) has no seat in the order and gets the default settle.
	 */
	const SECTION_ORDER: Record<string, number> = {
		'': 0, // the round screen itself
		veto: 0,
		pairs: 0,
		pool: 1,
		movies: 1,
		swipe: 1,
		history: 2,
		settings: 3
	};

	function sectionIndex(routeId: string | null | undefined): number | null {
		if (!routeId?.startsWith('/g/[token]')) return null;
		return SECTION_ORDER[routeId.split('/')[3] ?? ''] ?? null;
	}

	/*
	 * Page transitions, as progressive enhancement: where the View Transitions
	 * API exists, client-side navigations get a fast crossfade-and-settle, and
	 * moves between the four tab sections slide in the direction of the tab
	 * order (the CSS keys off <html data-page-transition>). Where it doesn't —
	 * or when the visitor prefers reduced motion — this returns nothing and
	 * navigation is untouched.
	 */
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const from = sectionIndex(navigation.from?.route.id);
		const to = sectionIndex(navigation.to?.route.id);
		const direction =
			from !== null && to !== null && from !== to ? (to > from ? 'forward' : 'back') : 'settle';
		document.documentElement.dataset.pageTransition = direction;

		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				// An aborted navigation rejects; the transition simply falls away.
				await navigation.complete.catch(() => {});
			});
			transition.finished.finally(() => {
				delete document.documentElement.dataset.pageTransition;
			});
		});
	});
</script>

{@render children()}

<!--
	App-wide attribution: posters and film data are TMDB's, and their free tier
	requires the credit wherever their data appears — which is nearly every
	screen, not just Settings. Kept to one quiet line at the end of the document.
-->
<footer
	class="mx-auto max-w-lg px-4 pt-4 text-center text-[11px] leading-relaxed text-chalk-dim {inGroup
		? 'pb-[calc(4.5rem_+_env(safe-area-inset-bottom))]'
		: 'pb-[calc(1rem_+_env(safe-area-inset-bottom))]'}"
>
	<p>
		This product uses the TMDB API but is not endorsed or certified by TMDB. Film data and posters
		courtesy of
		<a href="https://www.themoviedb.org/" rel="noreferrer" class="underline">The Movie Database</a>.
	</p>
</footer>
