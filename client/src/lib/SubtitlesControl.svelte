<script>
    import Fa from 'svelte-fa';
    import { faClosedCaptioning } from '@fortawesome/free-solid-svg-icons'

    export let video, activeTextTrack;
    let lastTextTrack;

    $: if (activeTextTrack) {
        lastTextTrack = activeTextTrack;
    }
</script>

{#if video}
    <div class="relative w-8 hover:w-32 group transition-all">
        <div class="absolute bottom-0 w-8 h-8 group-hover:w-32 group-hover:h-44 group-hover:bg-slate-800 rounded-[1rem] transition-all pb-8">
            <div class="flex flex-col divide-y overflow-y-scroll h-full rounded-t-[1rem] no-scrollbar">
                {#each video.textTracks as track}
                    <button class="{track == activeTextTrack ? "bg-slate-600 font-semibold" : "hover:bg-slate-700"} min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3 opacity-0 group-hover:opacity-100 overflow-hidden" on:click={() => activeTextTrack = (activeTextTrack != track ? track : null)}>
                        {track.label}
                    </button>
                {/each}
            </div>
            <button class="video-control absolute right-0 bottom-0 border-none" on:click={() => { activeTextTrack = activeTextTrack ? null : (lastTextTrack || video.textTracks[0]) }}>
                <Fa icon={faClosedCaptioning} />
            </button>
        </div>
    </div>
{/if}