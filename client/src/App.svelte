<script>
  import SeekBar from './lib/SeekBar.svelte';
  import FullscreenButton from './lib/FullscreenButton.svelte';
  import Fa from 'svelte-fa'
  import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'
  import VolumeControl from './lib/VolumeControl.svelte';
  import CropControl from './lib/CropControl.svelte';
  import Subtitles from './lib/Subtitles.svelte';
  import SubtitlesControl from './lib/SubtitlesControl.svelte';
  import Spinner from './lib/Spinner.svelte';
  import UrlControl from './lib/UrlControl.svelte';
  import { io } from 'socket.io-client';
  import { onMount } from 'svelte';
  
  let paused, url, buffering, peopleBuffering, people, currentTime, duration, muted = true, volume, video, scale, activeTextTrack = null, timeout, showControls = true, openMenu;

  let controls, hoveringControls = false;

  onMount(() => {
    window.addEventListener('mousemove', () => {
      clearTimeout(timeout);
      showControls = true;
      document.body.style.cursor = 'default';
      hoveringControls = controls.matches(':hover')
      if (!hoveringControls)
        timeout = setTimeout(() => {
          showControls = false;
          document.body.style.cursor = 'none';
          openMenu = null;
        }, 2000);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        if (!buffering && peopleBuffering == 0) {
          paused = !paused;
          socket.emit(paused ? 'pause' : 'play', currentTime);
        }
      } else if (e.key === 'ArrowLeft') {
        currentTime -= 5;
        socket.emit('seek', currentTime);
      } else if (e.key === 'ArrowRight') {
        currentTime += 5;
        socket.emit('seek', currentTime);
      } else if (e.key === 'ArrowUp') {
        volume = Math.min(volume + 0.05, 1);
      } else if (e.key === 'ArrowDown') {
        volume = Math.max(volume - 0.05, 0);
      } else if (e.key === 'm') {
        muted = !muted;
      } else if (e.key === 'f') {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen();
        }
      } else if (e.key === "Escape"){
        openMenu = null;
      }
    });
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
  socket.on('subtitles', (subEntry) => {
    if (!subEntry) return;
    let subBlob = new Blob([subEntry.text], {type: "text/vtt"});
    subEntry.src = URL.createObjectURL(subBlob);
    subtitles = [subEntry,...subtitles]
  });
  let subtitlesOpen = false, urlOpen = false;
  $: canOpen = !subtitlesOpen && !urlOpen;
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

  let subtitles =[
    {srclang:"en", label:"English",src:"en.vtt"},
    {srclang:"de", label:"German",src:"de.vtt"},
    {srclang:"es", label:"Spanish",src:"es.vtt"},
    {srclang:"hu", label:"Hungarian",src:"hu.vtt"},
    {srclang:"it", label:"Italian",src:"it.vtt"},
    {srclang:"pt", label:"Portuguese",src:"pt.vtt"},
    {srclang:"ru", label:"Russian",src:"ru.vtt"}
  ]
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
  {#each subtitles as subtitle}
    <track kind="subtitles" src={subtitle.src} srclang={subtitle.srclang} label={subtitle.label} />
  {/each}
</video>

<Subtitles activeTextTrack={activeTextTrack} />

<div bind:this={controls} class="absolute w-screen h-20 bottom-0 bg-gradient-to-t from-[#000000CC] to-transparent {showControls ? 'opacity-100' : 'opacity-0'} transition-all">
  <div class="flex items-end absolute right-[2%] -mr-2 bottom-10 gap-1">
    <VolumeControl bind:muted bind:volume canOpen={!openMenu} />
    <SubtitlesControl video={video} sendSubtitles={(subEntry)=>socket.emit('subtitles',subEntry)} bind:activeTextTrack bind:subtitles bind:openMenu />
    <UrlControl setUrl={(link)=>{socket.emit("url",link);url = link}} bind:openMenu {url} />
    <CropControl video={video} bind:scale canOpen={!openMenu} />
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