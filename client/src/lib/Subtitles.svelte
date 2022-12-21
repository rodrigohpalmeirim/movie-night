<script>
    export let video;
    let cues = [];

    $: if (video?.textTracks[0]) {
        video.textTracks[0].mode = 'hidden';
        video.textTracks[0].oncuechange = () => {
            cues = [];
            for (let cue of video.textTracks[0].activeCues) {
                cues.push(cue.getCueAsHTML().firstChild.outerHTML || cue.getCueAsHTML().firstChild.textContent);
            }
            cues = cues;
        };
    }
</script>

<div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col-reverse items-center text-slate-200 text-[40px] text-center" style="text-shadow: black 3px 3px 2px, black 0px 0px 4px;">
    {#each cues as cue}
        {@html cue}
    {/each}
</div>