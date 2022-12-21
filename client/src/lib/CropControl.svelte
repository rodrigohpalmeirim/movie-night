<script>
    import Fa from 'svelte-fa'
    import { faCrop, faCropSimple } from '@fortawesome/free-solid-svg-icons'

    export let video, scale;
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
        crop = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setScale();
    }

    window.addEventListener('mousemove', e => {
        if (controlingCrop) {
            const rect = slider.getBoundingClientRect();
            crop = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            setScale();
        }
    });

    window.addEventListener('mouseup', () => {
        controlingCrop = false;
    });
</script>

<div class="flex group hover:bg-slate-800 active:bg-slate-800 transition-colors rounded-full">
    <div class="flex group-hover:pl-3 group-active:pl-3 items-center opacity-0 group-hover:opacity-100 group-active:opacity-100 w-0 h-full group-hover:w-20 group-active:w-20 transition-all">
        <div bind:this={slider} class="flex items-center w-full cursor-pointer h-6" on:mousedown={setCrop}>
            <div class="bg-slate-900 h-2 w-full rounded-full">
                <div class="bg-slate-200 h-2 rounded-full pointer-events-none" style="width: {crop * 100}%;"></div>
            </div>
        </div>
    </div>
    <button class="video-control" on:click={() => {crop = !crop; setScale()}}>
        <Fa icon={crop ? faCropSimple : faCrop} />
    </button>
</div>