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
		variant = 'primary'
	}: {
		label: string;
		confirmLabel?: string;
		question?: string;
		name?: string;
		value?: string;
		disabled?: boolean;
		variant?: 'primary' | 'danger' | 'quiet';
	} = $props();

	const styles = {
		primary: 'token-brass',
		danger: 'token-cherry',
		quiet: ''
	};
</script>

{#if disabled}
	<!-- Nothing to confirm: the action isn't available, so show it plainly inert. -->
	<button type="submit" {name} {value} disabled class="token token-lg w-full {styles[variant]}">
		{label}
	</button>
{:else}
	<!-- Named group: this component is used inside Menu's own <details>, so the
	     open-state styling must key off *this* disclosure, not any ancestor. -->
	<details class="group/confirm">
		<summary class="block cursor-pointer list-none rounded-md select-none">
			<!-- Closed face: the action. Open face: the way back out. -->
			<span class="token token-lg w-full {styles[variant]} group-open/confirm:hidden">{label}</span>
			<span class="token token-lg hidden w-full group-open/confirm:flex">Cancel</span>
		</summary>
		<div class="mt-3 space-y-3 rounded-md border-2 border-dashed border-ink bg-board p-3">
			<p class="text-sm leading-snug text-ink">{question}</p>
			<button type="submit" {name} {value} class="token w-full {styles[variant]}">
				{confirmLabel}
			</button>
		</div>
	</details>
{/if}
