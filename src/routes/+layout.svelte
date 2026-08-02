<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';

	let { children } = $props();

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

<!--
	No app-wide footer. TMDB's credit belongs where their data is used — the
	suggest sheet, which is the search itself — and it has a permanent home at
	the bottom of Settings. It does not need a band of reserved space under
	every screen, half of it behind the tab bar.
-->
{@render children()}
