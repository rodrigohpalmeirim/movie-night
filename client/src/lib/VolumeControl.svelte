<script>
    import Fa from 'svelte-fa'
    import { faVolumeHigh, faVolumeLow, faVolumeOff, faVolumeMute } from '@fortawesome/free-solid-svg-icons'

    export let muted, volume = 1;
    let controlingVolume = false;
    let slider;

    function setVolume(e) {
        controlingVolume = true;
        muted = false;
        const rect = slider.getBoundingClientRect();
        volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }

    window.addEventListener('mousemove', e => {
        if (controlingVolume) {
            const rect = slider.getBoundingClientRect();
            volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        }
    });

    window.addEventListener('mouseup', () => {
        controlingVolume = false;
    });
</script>

<div class="flex group hover:bg-slate-800 active:bg-slate-800 transition-colors rounded-full">
    <div class="flex group-hover:pl-3 group-active:pl-3 pr-1 items-center opacity-0 group-hover:opacity-100 group-active:opacity-100 w-0 h-full group-hover:w-20 group-active:w-20 transition-all">
        <div bind:this={slider} class="flex items-center w-full cursor-pointer h-6" on:mousedown={setVolume}>
            <div class="bg-slate-900 h-2 w-full rounded-full">
                <div class="{muted ? "bg-slate-500" : "bg-slate-200"} h-2 rounded-full pointer-events-none" style="width: {volume * 100}%;"></div>
            </div>
        </div>
    </div>
    <button class="video-control justify-start pl-[5px]" on:click={() => muted = !muted}>
        <Fa icon={muted ? faVolumeMute : volume > 0.5 ? faVolumeHigh : volume > 0 ? faVolumeLow : faVolumeOff} />
    </button>
</div>