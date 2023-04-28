<script>
	import Fa from 'svelte-fa';
	import { faClosedCaptioning, faTextHeight, faUpload } from '@fortawesome/free-solid-svg-icons';

	export let video, activeTextTrack, sendSubtitles, openMenu, subtitles, subtitlesSize = 0.5;
	let lastTextTrack, menu, slider, controllingSize = false;

	$: if (activeTextTrack) {
		lastTextTrack = activeTextTrack;
	}

	window.addEventListener('click', e => {
		if (openMenu == 'subtitles' && !menu?.contains(e.target)) openMenu = null;
	});

	function setSize(e) {
		controllingSize = true;
		const rect = slider.getBoundingClientRect();
		subtitlesSize = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	window.addEventListener('mousemove', e => {
		if (controllingSize) {
			const rect = slider.getBoundingClientRect();
			subtitlesSize = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		}
	});

	window.addEventListener('mouseup', () => {
		controllingSize = false;
	});
</script>

{#if video}
	<div bind:this={menu} class="relative w-8 group transition-all">
		<div class="absolute flex flex-col bottom-10 -translate-x-1/2 left-4 {openMenu == 'subtitles' ? 'h-44 w-32 bg-slate-800 opacity-100' : 'h-0 w-0 opacity-0'} rounded-2xl transition-all overflow-hidden">
			<div class="flex flex-col grow divide-y overflow-y-scroll no-scrollbar">
				<button class="{activeTextTrack == null ? 'bg-slate-600 font-semibold' : 'hover:bg-slate-700'} min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3" on:click={() => { activeTextTrack = null; sendSubtitles(null); }}>
					Disabled
				</button>
				{#key subtitles}
					{#each video.textTracks as track}
						<button class="{track == activeTextTrack ? 'bg-slate-600 font-semibold' : 'hover:bg-slate-700'}  min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3" on:click={() => activeTextTrack = track}>
							{track.label}
						</button>
					{/each}
				{/key}
			</div>
			<div class="flex p-1 w-full">
				<div class="flex grow items-center hover:bg-slate-700 transition-colors rounded-full">
					<div class="video-control">
						<Fa icon={faTextHeight} class="text-slate-200 m-auto" />
					</div>
					<div class="flex grow h-full items-center">
						<div bind:this={slider} class="flex items-center h-full cursor-pointer w-full mr-2" on:mousedown={setSize}>
							<div class="bg-slate-900 h-2 w-full rounded-full flex items-end">
								<div class="bg-slate-200 h-2 rounded-full pointer-events-none" style:width="{subtitlesSize * 100}%"></div>
							</div>
						</div>
					</div>
				</div>
				<label for="subtitles" class="video-control cursor-pointer">
					<Fa icon={faUpload} class="text-slate-200 m-auto" />
				</label>
				<input type="file" multiple accept=".vtt" class="hidden" id="subtitles" on:change={async e => {
					for (let file of e.target.files) {
						const text = await file.text();
						const sub = { srclang: file.name.split('.')[0], label: file.name.split('.')[0], text: text };
						sendSubtitles(sub);
						sub.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
						subtitles = [sub, ...subtitles];
					}
				}} />
			</div>
		</div>
		<button on:click={() => openMenu = openMenu == 'subtitles' ? null : 'subtitles'} class="video-control absolute right-0 bottom-0 border-none" >
			<Fa icon={faClosedCaptioning} />
		</button>
	</div>
{/if}