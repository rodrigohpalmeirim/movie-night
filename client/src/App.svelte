<script>
  import SeekBar from './lib/SeekBar.svelte';
  import FullscreenButton from './lib/FullscreenButton.svelte';
  import Fa from 'svelte-fa'
  import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'
  import VolumeControl from './lib/VolumeControl.svelte';
  import CropControl from './lib/CropControl.svelte';
  import Subtitles from './lib/Subtitles.svelte';
    import SubtitlesControl from './lib/SubtitlesControl.svelte';
  
  let paused, buffering, currentTime, duration, muted = true, volume, video, scale;
</script>

<video
  class="w-screen h-screen bg-black pointer-events-none"
  style="transform: scale({scale});"
  autoplay
  playsinline
  bind:muted
  bind:volume
  bind:paused
  bind:currentTime
  bind:duration
  bind:this={video}
  on:canplay={() => (buffering = true)}
  on:waiting={() => (buffering = false)}
>
  <source
    src=""
  />
  <track kind="subtitles" src="subtitles.vtt" srclang="en" label="English" default />
</video>

<Subtitles video={video} />

<div class="absolute w-screen h-20 bottom-0 bg-gradient-to-t from-[#000000CC] to-transparent">
  <div class="flex absolute right-[2%] -mr-2 top-2 gap-1">
    <VolumeControl bind:muted bind:volume />
    <CropControl video={video} bind:scale />
    <FullscreenButton />
  </div>
  <SeekBar duration={duration} bind:currentTime />
</div>

<button class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 video-control opacity-50 hover:opacity-90 text-slate-200 text-[50px] w-[100px] h-[100px]" on:click={() => (paused = !paused)}>
  <Fa icon={paused ? faPlay : faPause} />
</button>