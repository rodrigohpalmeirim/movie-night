<!--
	The night's theme, printed as a label: "Halloween night", "Sci-fi night".
	Every themed round gets this — presets and custom tags alike — on the round
	screen, the reveal and the History stub. (Only the presets also get a palette
	and an ornament.)

	A printed label, not a control: an ink outline and stencil caps, flat on
	whatever it is printed on. Two stocks, because it is printed in two places —
	straight onto the felt (the round screen) and onto board (a History stub).
-->
<script lang="ts">
	let {
		label,
		on = 'felt',
		class: className = ''
	}: { label: string; on?: 'felt' | 'board'; class?: string } = $props();
</script>

<span
	class="stencil inline-flex max-w-full items-center rounded-full border-2 px-2.5 pt-0.5 pb-px text-[0.68rem] leading-snug font-semibold tracking-[0.1em] uppercase {on ===
	'felt'
		? 'border-brass text-brass'
		: 'border-ink bg-board-shade/45 text-ink'} {className}"
>
	<span class="truncate">{label} night</span>
</span>
