<!--
	Root error boundary: catches what falls outside the group shell — a bad
	address, a failed landing load, or a group layout load that never resolved.
	Same one-column-on-the-felt arrangement as the landing page, because this is
	the other page a reader can meet with no chrome around it.
-->
<script lang="ts">
	import ErrorCard from '$lib/components/ErrorCard.svelte';
</script>

<svelte:head>
	<title>Movie Night</title>
</svelte:head>

<div class="h-full overflow-x-clip overflow-y-auto overscroll-contain">
	<main class="mx-auto flex min-h-full max-w-lg flex-col justify-center px-4 py-8">
		<ErrorCard />
	</main>
</div>
