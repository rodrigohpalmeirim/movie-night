<script>
    export let activeTextTrack;
    let cues = [];
    let previousTextTrack;
    
    $: if (activeTextTrack !== previousTextTrack) {
        if (previousTextTrack) {
            previousTextTrack.oncuechange = null;
        }
        previousTextTrack = activeTextTrack;
        changeCues();
        if (activeTextTrack) {
            activeTextTrack.mode = 'hidden';
            activeTextTrack.oncuechange = changeCues;
        }
    }

    function changeCues() {
        cues = [];
        if (activeTextTrack?.activeCues) {
            for (let cue of activeTextTrack.activeCues) {
                cues.push(cue.getCueAsHTML().firstChild.outerHTML || cue.getCueAsHTML().firstChild.textContent);
            }
            cues = cues;
        }
    }
</script>

<div class="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col-reverse items-center text-slate-200 text-[40px] text-center" style="text-shadow: black 3px 3px 2px, black 0px 0px 4px;">
    {#each cues as cue}
        {@html cue}
    {/each}
</div>