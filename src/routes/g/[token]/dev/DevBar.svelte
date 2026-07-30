<!--
	DEV-ONLY member switcher.

	A slim amber bar pinned above the tab bar listing every member of the group;
	tapping one POSTs to `dev/switch`, which re-points this device's member cookie
	and bounces back to the page you were on. One browser can therefore RSVP, veto
	and vote as all five members of a round.

	It is deliberately ugly: amber, block capitals, hard borders. Nobody should be
	able to look at a screenshot and wonder whether this is part of the app.

	Mounted only when the server says DEV_MODE is on, so with the flag unset none
	of this markup is ever rendered — see the group layout.

	No JavaScript is involved: one <form> with a submit button per member, each
	carrying its own `member_id` value. Progressive enhancement is not needed here,
	and a full navigation is the honest way to show the new identity everywhere at
	once.
-->
<script lang="ts">
	import { page } from '$app/state';

	let {
		token,
		members,
		meId
	}: {
		token: string;
		members: Array<{ id: string; displayName: string }>;
		meId: string;
	} = $props();

	const returnTo = $derived(`${page.url.pathname}${page.url.search}`);
</script>

<div
	data-dev-bar
	class="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-30 border-y-2 border-amber-600 bg-amber-300 text-amber-950"
>
	<form
		method="POST"
		action="/g/{token}/dev/switch"
		class="mx-auto flex max-w-lg items-center gap-1 overflow-x-auto px-2 py-1"
	>
		<span class="shrink-0 pr-1 text-[10px] leading-none font-black tracking-widest uppercase">
			dev<span class="sr-only"> — switch member</span>
		</span>
		<input type="hidden" name="return_to" value={returnTo} />
		{#each members as member (member.id)}
			{@const active = member.id === meId}
			<button
				type="submit"
				name="member_id"
				value={member.id}
				aria-current={active ? 'true' : undefined}
				class="shrink-0 rounded border border-amber-700 px-2 py-0.5 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-900 {active
					? 'bg-amber-900 text-amber-50'
					: 'bg-amber-100 hover:bg-amber-50'}"
			>
				{member.displayName}
			</button>
		{/each}
	</form>
</div>
