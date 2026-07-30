<!--
	THE SIGNATURE ELEMENT — an ink seal.

	Every mark made in this app is the same object: a rubber stamp pressed onto a
	component. Yes and nope on the swipe card, done on a finished ballot, out on a
	vetoed film, and PICKED slammed across the winner's stub. One grammar, three
	inks — and each ink is the same fill as its matching button, so a stamped YES
	and the YES token read as one system.

	Purely decorative: the words it prints are always stated in real text nearby,
	so it is `aria-hidden` and never the only carrier of meaning.

	`slam` plays the celebration once. Under prefers-reduced-motion app.css
	cancels the animation outright, and the seal simply is there.
-->
<script lang="ts">
	let {
		word,
		note,
		tone = 'brass',
		size = '1.5rem',
		rotate = -8,
		opacity = 1,
		scale = 1,
		slam = false,
		class: className = ''
	}: {
		word: string;
		/** Second line under the rule — a date, a count. Optional. */
		note?: string;
		tone?: 'brass' | 'jade' | 'cherry';
		/** Size of the stamped word. Every other dimension is derived from it. */
		size?: string;
		rotate?: number;
		/** Drag-driven fade, 0–1. */
		opacity?: number;
		/** Drag-driven press, multiplies the resting size. */
		scale?: number;
		slam?: boolean;
		class?: string;
	} = $props();
</script>

<span
	class="seal seal-{tone} {slam ? 'seal-slam' : ''} {className}"
	style="--seal-rot:{rotate}deg;--seal-size:{size};opacity:{opacity}{scale === 1
		? ''
		: `;transform:rotate(${rotate}deg) scale(${scale})`}"
	aria-hidden="true"
>
	<span class="seal-face">
		{word}
		{#if note}<span class="seal-note">{note}</span>{/if}
	</span>
</span>
