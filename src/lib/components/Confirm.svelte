<!--
	A submit button with a confirm step, for the one-way transitions app-spec asks
	to guard.

	Built on <details>/<summary>, which is the only two-stage pattern that is
	genuinely operable with JavaScript off:

	- The first stage is the native disclosure toggle. No script runs; the browser
	  itself opens the panel.
	- The panel contains a real <button type="submit">, so activating it posts the
	  enclosing <form> through the plain HTML path.
	- Re-activating the summary closes the panel again, so "cancel" also needs no
	  script. The summary swaps its own face (label ⇄ Cancel) with CSS only.

	There is exactly one submitter in the markup and no click handler on it, so
	the enhanced path (use:enhance on the parent form) submits once and once only.
	`name`/`value` ride along as the submitter entry, natively and under enhance.

	Visually: the closed face is a chunky token; the question is a board-stock
	card with a torn (dashed) edge, so the second stage is unmistakably a
	different object rather than a colour change.
-->
<script lang="ts">
	let {
		label,
		confirmLabel = 'Yes, do it',
		question = 'Are you sure? This cannot be undone.',
		name,
		value,
		disabled = false,
		variant = 'primary',
		size = 'lg'
	}: {
		label: string;
		confirmLabel?: string;
		question?: string;
		name?: string;
		value?: string;
		disabled?: boolean;
		variant?: 'primary' | 'danger' | 'quiet';
		/** `lg` for the screen's main move, `md` for housekeeping that must not
		 *  out-shout it — regenerating a link, removing a film, signing out — and
		 *  `sm` for a guard that has to fit at the end of a line it shares, like a
		 *  name on the roster. */
		size?: 'lg' | 'md' | 'sm';
	} = $props();

	const styles = {
		primary: 'token-brass',
		danger: 'token-cherry',
		quiet: ''
	};
	/**
	 * The face's metrics, per size. Only `sm` gives up the full width: it is the
	 * one that stands at the end of a row beside something else, so it takes the
	 * width of its own words and is pushed to the end of the line. The question
	 * card it opens is unaffected — that always fills whatever it is given, because
	 * that is where the consequences are read.
	 */
	const faces = { lg: 'token-lg w-full', md: 'w-full', sm: 'token-sm ml-auto w-fit' };
	const face = $derived(`token ${faces[size]} ${styles[variant]}`);
</script>

{#if disabled}
	<!-- Nothing to confirm: the action isn't available, so show it plainly inert. -->
	<button type="submit" {name} {value} disabled class={face}>
		{label}
	</button>
{:else}
	<!-- Named group: this component is used inside Menu's own <details>, so the
	     open-state styling must key off *this* disclosure, not any ancestor. -->
	<details class="group/confirm">
		<summary class="block cursor-pointer list-none rounded-md select-none">
			<!-- Closed face: the action. Open face: the way back out. -->
			<span class="{face} group-open/confirm:hidden">{label}</span>
			<span class="token {faces[size]} hidden group-open/confirm:flex">Cancel</span>
		</summary>
		<!-- The question card is torn from the pad, not laid on the table: dashed
		     ink edge, and flat, because you read it rather than press it.
		     pop-settle is CSS-only entrance dressing on the native disclosure —
		     the no-JS open/close path is exactly what it was. -->
		<div class="pop-settle mt-3 space-y-3 rounded-md border-2 border-dashed border-ink bg-board p-3">
			<p class="text-sm leading-snug text-ink">{question}</p>
			<button type="submit" {name} {value} class="token w-full {styles[variant]}">
				{confirmLabel}
			</button>
		</div>
	</details>
{/if}
