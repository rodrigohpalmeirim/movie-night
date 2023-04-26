<script>
	export let currentTime = 0;
	export let duration = 1;
	export let onSeek;
	$: progress = currentTime / duration * 100;

	let slider;

	let seeking = false;
	function seek(e) {
		e.preventDefault();
		seeking = true;
		const rect = slider.getBoundingClientRect();
		currentTime = Math.max(0, Math.min(duration, (e.clientX - rect.left) / rect.width * duration));
		onSeek?.(currentTime);
	}

	function formatTime(time) {
		const hours = Math.floor(time / 3600) || 0;
		const minutes = Math.floor((time - hours * 3600) / 60) || 0;
		const seconds = Math.floor(time - hours * 3600 - minutes * 60) || 0;
		let formatted = '';
		if (hours > 0) {
			formatted += hours + ':';
		}
		formatted += String(minutes).padStart(2, '0') + ':';
		formatted += String(seconds).padStart(2, '0');
		return formatted;
	}

	let hoverPos = 0;
	let hoverTime = '';
	function hover(e) {
		const rect = slider.getBoundingClientRect();
		const time = Math.max(0, Math.min(duration, (e.clientX - rect.left) / rect.width * duration));
		hoverPos = e.offsetX;
		hoverTime = formatTime(time);
	}

	window.addEventListener('mousemove', e => {
		if (seeking) {
			const rect = slider.getBoundingClientRect();
			currentTime = Math.max(0, Math.min(duration, (e.clientX - rect.left) / rect.width * duration));
			onSeek?.(currentTime);
		}
	}, { passive: true });

	window.addEventListener('mouseup', e => {
		seeking = false;
	}, { passive: true });
</script>

<div bind:this={slider} class="absolute w-[96%] h-6 bottom-4 left-[2%] group cursor-pointer" on:mousedown={seek} on:mousemove={hover}>
	<div class="h-2 my-2 opacity-70 group-hover:opacity-90 group-hover:h-3 group-hover:my-1.5 transition-all bg-slate-700 rounded-full pointer-events-none">
		<div class="h-full bg-slate-300 rounded-full" style="width: {progress}%;"></div>
	</div>
	<span class="absolute bottom-6 text-slate-200 pointer-events-none">
		{formatTime(currentTime)} / {formatTime(duration)}
	</span>
	<div class="absolute px-1.5 opacity-0 group-hover:opacity-90 transition-opacity bg-slate-800 text-slate-200 rounded-md bottom-6 pointer-events-none -translate-x-1/2 text-center" style="left: {hoverPos}px">
		{hoverTime}
	</div>
</div>