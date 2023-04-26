<script>
    import Fa from 'svelte-fa';
    import { faClosedCaptioning, faUpload } from '@fortawesome/free-solid-svg-icons'
    import { tick } from 'svelte';

    export let video, activeTextTrack, sendSubtitles, openMenu,subtitles;
    let lastTextTrack, menu;

    $: if (activeTextTrack) {
        lastTextTrack = activeTextTrack;
    }

    window.addEventListener('click', (e) => {
        if (openMenu == "subtitles" && menu && !menu.contains(e.target)) openMenu = null;
    });
    $:console.log(openMenu)
</script>

{#if video}
    <div bind:this={menu} class="relative w-8 group transition-all">
        <div class="absolute -right-4 bottom-10 {openMenu == "subtitles" ? "w-32 h-44 bg-slate-800":"w-8 h-8"} rounded-2xl transition-all overflow-hidden">
            <div class="flex flex-col divide-y overflow-y-scroll h-full no-scrollbar">
                <button class="{activeTextTrack == null ? "bg-slate-600 font-semibold" : "hover:bg-slate-700"} {openMenu == "subtitles" ? "opacity-100":"opacity-0"} min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3" on:click={() => {activeTextTrack = null;sendSubtitles(null)}}>
                    Disabled
                </button>
                {#key subtitles}
                    {#each video.textTracks as track}
                        <button class="{track == activeTextTrack ? "bg-slate-600 font-semibold" : "hover:bg-slate-700"}  min-h-[40px] border-slate-700 w-full transition-all text-slate-200 p-2 text-left pl-3"
                        on:click={() => {activeTextTrack = track; sendSubtitles(activeTextTrack.language)}}>
                            {track.label}
                        </button>
                    {/each}
                {/key}
            </div>

            <div class="flex p-1">
                <label
                for="subtitles" class="flex w-full h-full cursor-pointer p-2 rounded-xl
                transition-all
                hover:bg-slate-600 bg-slate-700">
                    <Fa icon={faUpload} class="text-slate-200 m-auto" />
                </label>
                <input type="file" accept=".vtt" class="hidden" id="subtitles" on:change={(e) => {
                    const file = e.target.files[0];
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const text = e.target.result;
                        let subBlob = new Blob([text], {type: "text/vtt"});
                        let url = URL.createObjectURL(subBlob);
                        let sub = {srclang:file.name.split(".")[0], label:file.name.split(".")[0],text:text}
                        sendSubtitles(sub)
                        sub.src = url;
                        subtitles = [sub,...subtitles]
                        tick().then(() => {
                            activeTextTrack = video.textTracks[0];
                        })
                    };
                    reader.readAsText(file);
                }} />
            </div>
        </div>
        <button on:click={() => openMenu = openMenu == "subtitles" ? null : "subtitles"} class="video-control absolute right-0 bottom-0 border-none" >
            <Fa icon={faClosedCaptioning} />
        </button>
    </div>
{/if}