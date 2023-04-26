<script>
    import Fa from 'svelte-fa';
    import { faLink, faPlay } from '@fortawesome/free-solid-svg-icons'
    import { cubicInOut } from 'svelte/easing';
    import { tick } from 'svelte';

    export let open=false, toggleOpen, setUrl, url = "";

    let input;
    function checkAndSetUrl() {
        if (input.checkValidity()) {
            setUrl(input.value);
            toggleOpen("url")
        }else{
            input.focus();
        }
    }

function fadeScale (
  node, { delay = 0, duration = 150, easing = cubicInOut, baseScale = 0.80 }
) {
  const o = +getComputedStyle(node).opacity;
  const m = getComputedStyle(node).transform.match(/scale\(([0-9.]+)\)/);
  const s = m ? m[1] : 1;
  const is = 1 - baseScale;

  return {
    delay,
    duration,
    css: t => {
      const eased = easing(t);
      return `opacity: ${eased * o}; transform: scale(${(eased * s * is) + baseScale})`;
    }
  };
}




// TODO remember to change the pattern to match the webtorrent urls
</script>

<div class="relative w-8 group transition-all">
    {#if open}
        <div transition:fadeScale class="flex gap-1 absolute -right-10 bottom-10 w-48 h-10 bg-slate-800 rounded-2xl transition-all overflow-hidden p-1">
            <input 
            pattern="https?://.+\.(mp4|webm|ogg)(\?.*)?$"
            placeholder={url}
            bind:this={input} on:keydown={(e)=>{if (e.key === "Enter") checkAndSetUrl()}} type="text"
            class="w-full bg-slate-900 text-slate-200 p-2 rounded-xl outline-slate-600 outline-2 focus:outline
            invalid:outline-rose-300" />

            <button on:click={checkAndSetUrl} class="video-control" >
                <Fa icon={faPlay} class="w-8 h-8" />
            </button>
        </div>
    {/if}
    <button on:click={()=>{toggleOpen("url");tick().then(()=>{if (open) input.focus()})}} class="video-control absolute right-0 bottom-0 border-none" >
        <Fa icon={faLink} />
    </button>
</div>