<script>
  import SeekBar from './lib/SeekBar.svelte';
  import FullscreenButton from './lib/FullscreenButton.svelte';
  import Fa from 'svelte-fa'
  import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'
  import VolumeControl from './lib/VolumeControl.svelte';
  import CropControl from './lib/CropControl.svelte';
  import Subtitles from './lib/Subtitles.svelte';
  import SubtitlesControl from './lib/SubtitlesControl.svelte';
  
  let paused, buffering, currentTime, duration, muted = true, volume, video, scale, activeTextTrack, timeout, showControls = true;

  window.addEventListener('mousemove', () => {
    clearTimeout(timeout);
    showControls = true;
    document.body.style.cursor = 'default';
    timeout = setTimeout(() => {
      showControls = false;
      document.body.style.cursor = 'none';
    }, 2000);
  });
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
    src="https://upload.wikimedia.org/wikipedia/commons/7/76/Sprite_Fright_-_Blender_Open_Movie-full_movie.webm"
  />
  <track kind="subtitles" src="en.vtt" srclang="en" label="English" />
  <track kind="subtitles" src="de.vtt" srclang="de" label="German" />
  <track kind="subtitles" src="es.vtt" srclang="es" label="Spanish" />
  <track kind="subtitles" src="hu.vtt" srclang="hu" label="Hungarian" />
  <track kind="subtitles" src="it.vtt" srclang="it" label="Italian" />
  <track kind="subtitles" src="pt.vtt" srclang="pt" label="Portuguese" />
  <track kind="subtitles" src="ru.vtt" srclang="ru" label="Russian" />
</video>

<Subtitles activeTextTrack={activeTextTrack} />

<div class="absolute w-screen h-20 bottom-0 bg-gradient-to-t from-[#000000CC] to-transparent {showControls ? 'opacity-100' : 'opacity-0'} transition-all">
  <div class="flex absolute right-[2%] -mr-2 top-2 gap-1">
    <VolumeControl bind:muted bind:volume />
    <SubtitlesControl video={video} bind:activeTextTrack />
    <CropControl video={video} bind:scale />
    <FullscreenButton />
  </div>
  <SeekBar duration={duration} bind:currentTime />
</div>

<button class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 video-control {showControls ? 'opacity-50 hover:opacity-90' : 'opacity-0'} text-slate-200 text-[50px] w-[100px] h-[100px]" on:click={() => (paused = !paused)}>
  <Fa icon={paused ? faPlay : faPause} />
</button>