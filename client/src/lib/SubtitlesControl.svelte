<script>
    import Fa from 'svelte-fa';
    import { faClosedCaptioning } from '@fortawesome/free-solid-svg-icons'

    export let video, activeTextTrack, sendSubtitles, openMenu;
    let lastTextTrack;

    $: if (activeTextTrack) {
        lastTextTrack = activeTextTrack;
    }
</script>

{#if video}
    <div class="relative w-8 group transition-all">
        <div class="absolute -right-4 bottom-10 {openMenu == "subtitles" ? "w-32 h-44 bg-slate-800":"w-8 h-8"} rounded-2xl transition-all overflow-hidden">
            <div class="flex flex-col divide-y overflow-y-scroll h-full no-scrollbar">
                <button class="{activeTextTrack == null ? "bg-slate-600 font-semibold" : "hover:bg-slate-700"} {openMenu == "subtitles" ? "opacity-100":"opacity-0"} min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3" on:click={() => {activeTextTrack = null;sendSubtitles(null)}}>
                    Disabled
                </button>
                {#each video.textTracks as track}
                    <button class="{track == activeTextTrack ? "bg-slate-600 font-semibold" : "hover:bg-slate-700"} {openMenu == "subtitles" ? "opacity-100":"opacity-0"} min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3"
                    on:click={() => {activeTextTrack = (activeTextTrack != track ? track : null); sendSubtitles(activeTextTrack.language)}}>
                        {track.label}
                    </button>
                {/each}
            </div>
        </div>
        <button on:click={() => openMenu = openMenu == "subtitles" ? null : "subtitles"} class="video-control absolute right-0 bottom-0 border-none" >
            <Fa icon={faClosedCaptioning} />
        </button>
    </div>
{/if}