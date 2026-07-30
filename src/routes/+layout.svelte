<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	// The group shell pins a tab bar to the bottom of the viewport, so the footer
	// needs enough clearance to sit above it (plus the iOS safe area) instead of
	// disappearing behind it. Elsewhere it only needs the safe area.
	const inGroup = $derived(page.url.pathname.startsWith('/g/'));
</script>

{@render children()}

<!--
	App-wide attribution: posters and film data are TMDB's, and their free tier
	requires the credit wherever their data appears — which is nearly every
	screen, not just Settings. Kept to one quiet line at the end of the document.
-->
<footer
	class="mx-auto max-w-lg px-4 pt-4 text-center text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-500 {inGroup
		? 'pb-[calc(4.5rem_+_env(safe-area-inset-bottom))]'
		: 'pb-[calc(1rem_+_env(safe-area-inset-bottom))]'}"
>
	<p>
		This product uses the TMDB API but is not endorsed or certified by TMDB. Film data and posters
		courtesy of
		<a href="https://www.themoviedb.org/" rel="noreferrer" class="underline">The Movie Database</a>.
	</p>
</footer>
