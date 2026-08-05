<script lang="ts">
	import '../app.css';
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';

	let { children } = $props();

	/**
	 * Which manifest this page installs from. One app either way — same `id`, same
	 * name, same icon — the difference is only where the icon starts. Inside a group
	 * it is the group's own (`/g/<token>/manifest.webmanifest`), whose `start_url`
	 * is `/?g=<token>`: an installed PWA on iOS launches with an empty cookie jar,
	 * so the token is what gets that first launch back to the group it was installed
	 * from. Everywhere else it is the static one, whose `start_url` is plain `/`.
	 *
	 * Emitted here rather than in app.html, and in exactly one place, because
	 * browsers honour the FIRST `rel=manifest` in document order: a second link
	 * added lower down would silently lose to the hardcoded one.
	 */
	const manifestHref = $derived(
		page.params.token ? `/g/${page.params.token}/manifest.webmanifest` : '/manifest.webmanifest'
	);

	/**
	 * The home-screen label on iOS, which reads this meta rather than the
	 * manifest's `short_name`. A constant, because the install is one app wherever
	 * it was added from: a device with two groups has one icon, and it is the app's.
	 */
	const installTitle = 'Movie Night';

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

<svelte:head>
	<link rel="manifest" href={manifestHref} />
	<meta name="apple-mobile-web-app-title" content={installTitle} />
</svelte:head>

<!--
	No app-wide footer. TMDB's credit belongs where their data is used — the
	suggest sheet, which is the search itself — and it has a permanent home at
	the bottom of Settings. It does not need a band of reserved space under
	every screen, half of it behind the tab bar.
-->
{@render children()}
