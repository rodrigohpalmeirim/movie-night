<script>
	import Fa from 'svelte-fa';
	import { faExpand, faCompress } from '@fortawesome/free-solid-svg-icons';

	let fullscreen = false;
	document.addEventListener('fullscreenchange', () => {
		fullscreen = !!document.fullscreenElement;
	});

	function toggleFullscreen() {
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			document.documentElement.requestFullscreen();
		}
	}
</script>

<button class="video-control" on:click={toggleFullscreen}>
	<Fa icon={fullscreen ? faCompress : faExpand} />
</button>