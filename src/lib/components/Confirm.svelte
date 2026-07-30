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

	const base =
		'w-full rounded-xl px-4 py-3 text-base font-semibold transition disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2';
	const styles = {
		primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-400',
		danger: 'bg-rose-600 text-white hover:bg-rose-500 focus-visible:outline-rose-400',
		quiet:
			'border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
	};
</script>

{#if disabled}
	<!-- Nothing to confirm: the action isn't available, so show it plainly inert. -->
	<button type="submit" {name} {value} disabled class="{base} {styles[variant]}">
		{label}
	</button>
{:else}
	<!-- Named group: this component is used inside Menu's own <details>, so the
	     open-state styling must key off *this* disclosure, not any ancestor. -->
	<details class="group/confirm">
		<summary
			class="block cursor-pointer list-none rounded-xl select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
		>
			<!-- Closed face: the action. Open face: the way back out. -->
			<span class="{base} {styles[variant]} block text-center group-open/confirm:hidden">{label}</span>
			<span class="{base} {styles.quiet} hidden text-center group-open/confirm:block">Cancel</span>
		</summary>
		<div
			class="mt-2 space-y-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/30"
		>
			<p class="text-sm text-amber-900 dark:text-amber-200">{question}</p>
			<button type="submit" {name} {value} class="{base} {styles[variant]}">
				{confirmLabel}
			</button>
		</div>
	</details>
{/if}
