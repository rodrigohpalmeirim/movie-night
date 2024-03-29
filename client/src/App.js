import './App.css';
import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import { faClosedCaptioning, faCompress, faExpand, faFileUpload, faFilm, faLink, faPlay, faUsers } from '@fortawesome/free-solid-svg-icons';
import { ActionInput } from './ActionInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { srt2webvtt } from "./subtitles";

var localAction = true;
var controlsTimeout;
var seekTimeout;
var readyTimeout;
var subtitles = [];
var logs = "";
const socket = io();


Number.prototype.toHHMMSS = function () { // eslint-disable-line no-extend-native
  var hours = Math.floor(this / 3600);
  var minutes = Math.floor((this - (hours * 3600)) / 60);
  var seconds = Math.floor(this - (hours * 3600) - (minutes * 60));

  if (minutes < 10) { minutes = "0" + minutes; }
  if (seconds < 10) { seconds = "0" + seconds; }
  return hours + ':' + minutes + ':' + seconds;
}

function download(text, filename) {
  const file = new Blob([text], { type: 'text/plain' });
  const a = document.createElement("a");
  const url = URL.createObjectURL(file);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 0);
}

function log(...message) {
  logs += (new Date()).toJSON().slice(11, -1) + " - " + message.join(" ") + "\n";
  console.log(message.join(" "));
}

export default function App(props) {

  const [url, setUrl] = useState(undefined);
  const [joined, setJoined] = useState(false);
  const [people, setPeople] = useState(undefined);
  const [buffering, setBuffering] = useState(0);
  const [ready, setReady] = useState(false);
  const [urlPanel, setUrlPanel] = useState(false);
  const [descriptionPanel, setDescriptionPanel] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [subtitlesPanel, setSubtitlesPanel] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const video = useRef();

  useEffect(() => {

    // Socket events
    socket.onAny((...a) => log("Socket:", a));

    let reconnection = false;
    socket.on("connect", () => {
      if (window.location.pathname.length <= 1) {
        window.history.replaceState({}, "", window.location.origin + "/" + Math.random().toString(36).substring(2, 10));
      }

      if (!reconnection) {
        socket.emit("info", window.location.pathname.slice(1), (response) => {
          setPeople(response.people);
          if (response.people === 0) {
            join();
          } else {
            setDescriptionPanel(true);
          }
        });
      }
      reconnection = true;
    });

    socket.on("disconnect", () => {
      log("Connection lost");
      join();
    });

    socket.on("play", () => {
      localAction = false;
      video.current.play();
    });

    socket.on("pause", time => {
      localAction = false;
      video.current.pause();
      video.current.currentTime = time;
    });

    socket.on("seek", time => {
      setReady(false);
      localAction = false;
      video.current.pause();
      video.current.currentTime = time;
    });

    socket.on("buffering", num => {
      setBuffering(num);
    });

    socket.on("people", num => {
      setPeople(num);
    });

    socket.on("url", newUrl => {
      setUrl(newUrl);
    });

    socket.on("subtitles", newSubtitles => {
      subtitles = newSubtitles;
      updateSubtitles();
    });

    // User events
    document.addEventListener("mousemove", () => {
      clearTimeout(controlsTimeout);
      setControlsShown(true);
      controlsTimeout = setTimeout(() => setControlsShown(false), 2600);
    });

    document.addEventListener("keypress", event => {
      if (event.key === "l") {
        download(logs, "log.txt");
      }
    });

    setInterval(() => fetch(window.location.origin + "/manifest.json"), 600000); // Keep Heroku app alive

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    // Video events
    video.current.onplay = () => {
      log("Event: playing, localAction:", localAction)
      if (localAction) {
        if (buffering !== 0) {
          video.current.pause();
        } else {
          socket.emit("play", video.current.currentTime);
        }
      }
      localAction = true;
    }

    video.current.onpause = () => {
      log("Event: paused, localAction:", localAction)
      if (localAction && buffering === 0 && video.current.readyState >= 3) {
        socket.emit("pause", video.current.currentTime);
        localAction = true;
      }
    }

    video.current.onseeking = () => {
      setBuffering(people - 1);
      if (localAction) {
        clearTimeout(seekTimeout);
        seekTimeout = setTimeout(() => {
          socket.emit("seek", video.current.currentTime);
          seekTimeout = null;
        }, 200);
      }
      localAction = true;
      setReady(false);
    };

    video.current.oncanplay = () => {
      if (seekTimeout) {
        clearTimeout(readyTimeout);
        readyTimeout = setTimeout(() => socket.emit("ready"), 200);
      } else {
        socket.emit("ready");
      }
      setReady(true);
    }

    video.current.onwaiting = () => {
      if (!buffering) {
        log("Event: buffering");
        video.current.pause();
        setBuffering(people - 1);
        socket.emit("seek", video.current.currentTime);
        localAction = true;
        setReady(false);
      }
    }
  }, [buffering, people]);

  useEffect(() => {
    setBuffering(people - 1);
    setReady(false);
    subtitles = [];
    updateSubtitles();
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setUrlPanel(!url && joined);
  }, [joined, url]);

  function join() {
    socket.emit("join", window.location.pathname.slice(1));
    setDescriptionPanel(false);
    setJoined(true);
  }

  async function uploadSubtitles(event) {
    setSubtitlesPanel(false);
    for (var file of event.target.files) {
      if (file.type.includes("x-subrip")) {
        file = new Blob([srt2webvtt(await file.text())], { type: 'text/vtt' });
      }
      subtitles.push(file);
    }
    socket.emit("subtitles", subtitles);
    updateSubtitles();
  }

  function updateSubtitles() {
    video.current.innerHTML = "";
    while (video.current.firstChild) {
      video.current.removeChild(video.current.lastChild);
    }
    for (const file of subtitles) {
      const track = document.createElement("track");
      track.kind = "captions";
      // track.label = "English";
      // track.srclang = "en";
      track.src = URL.createObjectURL(new Blob([file]));
      video.current.appendChild(track);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location);
  }

  function toggleUrlPanel() {
    setDescriptionPanel(false);
    setSubtitlesPanel(false);
    setUrlPanel(!urlPanel);
  }

  function toggleDescriptionPanel() {
    setUrlPanel(false);
    setSubtitlesPanel(false);
    setDescriptionPanel(!descriptionPanel);
  }

  function toggleSubtitlesPanel() {
    setUrlPanel(false);
    setDescriptionPanel(false);
    setSubtitlesPanel(!subtitlesPanel);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
    setFullscreen(!document.fullscreenElement);
  }

  return (
    <div className="App">
      <video ref={video} src={url} controls style={{ display: url ? "block" : "none" }} />
      {url && buffering > 0 && (ready ?
        <span className="status" style={{ right: controlsShown ? 60 : 20 }}>Waiting for {buffering} {buffering === 1 ? "person" : "people"}'s stream...</span> :
        <span className="status" style={{ right: controlsShown ? 60 : 20 }}>Loading...</span>
      )}
      {urlPanel &&
        <div className="panel" id="url-selector">
          <span className="item-title">Movie URL</span>
          <ActionInput placeholder="https://example.com/movie.mp4" autoFocus={true} icon={faPlay} width={350} action={url => { socket.emit("url", url); setUrl(url); }} />
        </div>
      }
      {descriptionPanel &&
        <div className="panel" id="join">
          <span className="item-title">Party Description</span>
          <ul>
            {people !== undefined &&
              <li>People: {people}</li>}
            {video.current != null && video.current.duration > 1 &&
              <li>Duration: {video.current.duration.toHHMMSS()}</li>}
          </ul>
          {!joined &&
            <button onClick={join}>Join</button>}
        </div>
      }
      {subtitlesPanel &&
        <div className="panel" id="subtitles">
          <span className="item-title">Upload Subtitles</span>
          <input type="file" accept=".vtt,.srt" multiple onChange={uploadSubtitles} id="upload-button" style={{ position: "absolute", display: "none" }} />
          <label htmlFor="upload-button" className="big-icon-button" style={{ width: 41, height: 41 }}>
            <FontAwesomeIcon icon={faFileUpload} />
          </label>
        </div>
      }
      <div className="top-button" style={{ left: 20, opacity: controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faLink} onClick={copyLink} /><span className="tooltip">Copy Link</span></div>
      <div className="top-button" style={{ left: 60, opacity: controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faUsers} onClick={toggleDescriptionPanel} /><span className="tooltip">Party Description</span></div>
      <div className="top-button" style={{ left: 106.25, opacity: controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faFilm} onClick={toggleUrlPanel} /><span className="tooltip">Movie URL</span></div>
      <div className="top-button" style={{ right: 20, opacity: controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} onClick={toggleFullscreen} /><span className="tooltip">Fullscreen</span></div>
      {url && <div className="top-button" style={{ left: 146.25, opacity: controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faClosedCaptioning} onClick={toggleSubtitlesPanel} /><span className="tooltip">Subtitles</span></div>}
    </div>
  );
}
