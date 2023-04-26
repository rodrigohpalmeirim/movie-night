<script>
    import Fa from 'svelte-fa'
    import { faVolumeHigh, faVolumeLow, faVolumeOff, faVolumeMute } from '@fortawesome/free-solid-svg-icons'

    export let muted, volume = 1,canOpen = true;
    let controlingVolume = false;
    let slider;

    function setVolume(e) {
        controlingVolume = true;
        muted = false;
        const rect = slider.getBoundingClientRect();
        volume = Math.max(0, Math.min(1, 1-(e.clientY - rect.top) / rect.height));
    }

    window.addEventListener('mousemove', e => {
        if (controlingVolume) {
            const rect = slider.getBoundingClientRect();
            volume = Math.max(0, Math.min(1, 1-(e.clientY - rect.top) / rect.height));
        }
    });

    window.addEventListener('mouseup', () => {
        controlingVolume = false;
    });
</script>

<div class="group hover:bg-slate-800 active:bg-slate-800 transition-colors rounded-full {!canOpen?"pointer-events-none":""}">
    <div class="flex items-center opacity-0 group-hover:opacity-100 group-active:opacity-100 w-full h-0 group-hover:h-20 group-active:h-20 transition-all">
        <div bind:this={slider} class="flex justify-center w-full cursor-pointer h-16 mt-2" on:mousedown={setVolume}>
            <div class="bg-slate-900 w-2 h-full rounded-full flex items-end">
                <div class="{muted ? "bg-slate-500" : "bg-slate-200"} w-2 rounded-full pointer-events-none" style:height="{volume * 100}%"></div>
            </div>
        </div>
    </div>
    <button class="video-control justify-start pl-[5px]" on:click={() => muted = !muted}>
        <Fa icon={muted ? faVolumeMute : volume > 0.5 ? faVolumeHigh : volume > 0 ? faVolumeLow : faVolumeOff} />
    </button>
</div>