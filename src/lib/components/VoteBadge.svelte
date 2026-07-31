<!--
	The viewer's own standing vote as three visually distinct states.
	voting-spec: "Never conflate 'no' with 'not yet seen'."

	An answered film carries the same ink seal the swipe card was stamped with —
	one grammar for every mark a person makes, so the YES in the pool list is
	visibly the *same object* as the YES you swiped. Small and flat: a stamp is
	pressed once, never pressable. Greyscale separation is inherited from the
	seal tones (jade = dark plate, light type; cherry = bright plate, ink type),
	so yes and no stay apart with the colour thrown away, on top of the words
	themselves differing. The seal is decorative (aria-hidden in Stamp), so the
	vote is also stated in visually-hidden real text.

	Not-yet-seen is no mark at all: an unfilled chip with a cut edge, because
	nobody has stamped anything.
-->
<script lang="ts">
	import Stamp from './Stamp.svelte';

	let { vote, class: className = '' }: { vote: 'yes' | 'no' | null; class?: string } = $props();
</script>

{#if vote === 'yes'}
	<span class="inline-flex items-center py-0.5 {className}">
		<Stamp word="Yes" tone="jade" size="0.72rem" rotate={-4} />
		<span class="sr-only">Your standing vote: yes</span>
	</span>
{:else if vote === 'no'}
	<!-- Same word, tone and lean as the swipe card's refusal stamp. -->
	<span class="inline-flex items-center py-0.5 {className}">
		<Stamp word="Nope" tone="cherry" size="0.72rem" rotate={3} />
		<span class="sr-only">Your standing vote: no</span>
	</span>
{:else}
	<!-- Ink-soft, not chalk: this chip only ever appears on board stock. -->
	<span
		class="stencil inline-flex items-center gap-1 rounded border-2 border-dashed border-ink-soft px-1.5 py-0.5 text-[0.7rem] font-semibold tracking-[0.08em] text-ink-soft uppercase {className}"
	>
		Not yet seen
	</span>
{/if}
