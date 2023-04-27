<script>
	import Fa from 'svelte-fa';
	import { faCrop, faCropSimple } from '@fortawesome/free-solid-svg-icons';

	export let video, scale, canOpen = true;
	let crop = 0;
	let controlingCrop = false;
	let slider;

	window.addEventListener('resize', setScale);

	function setScale() {
		const videoRatio = video?.videoWidth / video?.videoHeight;
		const windowRatio = window.innerWidth / window.innerHeight;
		scale = (Math.max(videoRatio / windowRatio, windowRatio / videoRatio) - 1) * crop + 1;
	}

	function setCrop(e) {
		controlingCrop = true;
		const rect = slider.getBoundingClientRect();
		crop = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
		setScale();
	}

	window.addEventListener('mousemove', e => {
		if (controlingCrop) {
			const rect = slider.getBoundingClientRect();
			crop = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
			setScale();
		}
	});

	window.addEventListener('mouseup', () => {
		controlingCrop = false;
	});
</script>

<div class="group hover:bg-slate-800 active:bg-slate-800 transition-colors rounded-full {!canOpen ? 'pointer-events-none' : ''}">
	<div class="flex items-center opacity-0 group-hover:opacity-100 group-active:opacity-100 w-full h-0 group-hover:h-20 group-active:h-20 transition-all overflow-hidden">
		<div bind:this={slider} class="flex justify-center w-full cursor-pointer h-16 mt-2" on:mousedown={setCrop}>
			<div class="bg-slate-900 w-2 h-full rounded-full flex items-end">
				<div class="bg-slate-200 w-2 rounded-full pointer-events-none" style:height="{crop * 100}%"></div>
			</div>
		</div>
	</div>
	<button class="video-control" on:click={() => { crop = crop ? 0 : 1; setScale(); }}>
		<Fa icon={crop ? faCropSimple : faCrop} />
	</button>
</div>