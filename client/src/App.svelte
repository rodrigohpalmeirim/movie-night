<script>
  import SeekBar from './lib/SeekBar.svelte';
  import FullscreenButton from './lib/FullscreenButton.svelte';
  import Fa from 'svelte-fa'
  import { faPlay, faPause, faCrop, faCropSimple } from '@fortawesome/free-solid-svg-icons'
  import VolumeControl from './lib/VolumeControl.svelte';
  import CropControl from './lib/CropControl.svelte';
  import Subtitles from './lib/Subtitles.svelte';
  import SubtitlesControl from './lib/SubtitlesControl.svelte';
  import Spinner from './lib/Spinner.svelte';
  import { io } from 'socket.io-client';
    import UrlControl from './lib/UrlControl.svelte';
  
  let paused, url, buffering, peopleBuffering, people, currentTime, duration, muted = true, volume, video, scale, activeTextTrack = null, timeout, showControls = true;

  window.addEventListener('mousemove', () => {
    clearTimeout(timeout);
    showControls = true;
    document.body.style.cursor = 'default';
    timeout = setTimeout(() => {
      showControls = false;
      document.body.style.cursor = 'none';
    }, 2000);
  });

  const socket = io();
  socket.onAny((...args) => console.log("Socket:", ...args));
  socket.on('connect', () => {
    if (window.location.pathname.length <= 1) {
      window.history.replaceState({}, "", window.location.origin + "/" + Math.random().toString(36).substring(2, 10));
    }
    socket.emit('join', window.location.pathname);
  });
  socket.on('disconnect', () => {
    // TODO
  });
  socket.on('play', () => paused = false);
  socket.on('pause', (time) => { paused = true; currentTime = time; });
  socket.on('seek', (time) => { paused = true; currentTime = time; });
  socket.on('buffering', (num) => peopleBuffering = num);
  socket.on('people', (num) => people = num);
  socket.on('url', (newUrl) => url = newUrl);
  socket.on('subtitles', (subtitles) => {
    // TODO
  });
  let subtitlesOpen = false, urlOpen = false;
  function toggleMenu(name){
    if (name == 'subtitles'){
      subtitlesOpen = !subtitlesOpen;
      if(subtitlesOpen)
        urlOpen = false;
    }
    if(name == 'url'){
      urlOpen = !urlOpen;
      if(urlOpen)
        subtitlesOpen = false;
    }
  }
</script>

<!-- svelte-ignore a11y-media-has-caption -->
<video
  class="w-screen h-screen bg-black pointer-events-none"
  style:transform="scale({scale})"
  playsinline
  bind:muted
  bind:volume
  bind:paused
  bind:currentTime
  bind:duration
  bind:this={video}
  src={url}
  on:canplay={() => {if (video.readyState >= 3) {buffering = false; socket.emit('ready')}}}
  on:waiting={() => {if (!buffering) socket.emit('seek', currentTime); buffering = true}}
>
  <track kind="subtitles" src="en.vtt" srclang="en" label="English" />
  <track kind="subtitles" src="de.vtt" srclang="de" label="German" />
  <track kind="subtitles" src="es.vtt" srclang="es" label="Spanish" />
  <track kind="subtitles" src="hu.vtt" srclang="hu" label="Hungarian" />
  <track kind="subtitles" src="it.vtt" srclang="it" label="Italian" />
  <track kind="subtitles" src="pt.vtt" srclang="pt" label="Portuguese" />
  <track kind="subtitles" src="ru.vtt" srclang="ru" label="Russian" />
</video>

<Subtitles activeTextTrack={activeTextTrack} />

<div class="absolute w-screen h-20 bottom-0 bg-gradient-to-t from-[#000000CC] to-transparent {showControls ? 'opacity-100' : 'opacity-0'} hover:opacity-100 transition-all">
  <div class="flex items-end absolute right-[2%] -mr-2 bottom-10 gap-1">
    <VolumeControl bind:muted bind:volume />
    <SubtitlesControl video={video} bind:activeTextTrack bind:open={subtitlesOpen} toggleOpen={toggleMenu} />
    <UrlControl setUrl={(link)=>{socket.emit("url",link);url = link}} bind:open={urlOpen} toggleOpen={toggleMenu} {url} />
    <CropControl video={video} bind:scale />
    <FullscreenButton />
  </div>
  <SeekBar duration={duration} bind:currentTime onSeek={() => {paused = true; socket.emit('seek', currentTime)}} />
</div>

<div class="absolute left-1/2 top-1/2 rounded-full -translate-x-1/2 -translate-y-1/2">
  {#if buffering || peopleBuffering > 0}
    <Spinner people={people} peopleBuffering={peopleBuffering} />
  {:else}
    <button class="video-control {showControls ? 'opacity-50 hover:opacity-90' : 'opacity-0'} text-slate-200 text-[50px] w-[100px] h-[100px]" on:click={() => {paused = !paused; socket.emit(paused ? 'pause' : 'play', currentTime)}}>
      <Fa icon={paused ? faPlay : faPause} />
    </button>
  {/if}
</div>