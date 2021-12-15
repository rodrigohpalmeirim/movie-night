import './App.css';
import React, { Component } from 'react';
import io from 'socket.io-client';
import { faClosedCaptioning, faFileUpload, faFilm, faLink, faPlay, faUsers } from '@fortawesome/free-solid-svg-icons';
import { ActionInput } from './ActionInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { srt2webvtt } from "./subtitles";

var localAction = true;
var subtitles = [];
var log = "";
var video;
const socket = io();

Number.prototype.toHHMMSS = function () {
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

function consoleLog(...message) {
  log += (new Date()).toJSON().slice(11, -1) + " - " + message.join(" ") + "\n";
  console.log(message.join(" "));
}

export default class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      people: 1,
      buffering: 0,
      waiting: false,
      ready: false,
      urlPanel: false,
      descriptionPanel: false,
      controlsShown: true,
      subtitlesPanel: false,
    }

    video = React.createRef();


    socket.on("disconnect", () => {
      console.log("Connection lost");
    });

    socket.on("play", () => {
      localAction = false;
      video.current.play();
    });

    socket.on("pause", () => {
      localAction = false;
      video.current.pause();
    });

    socket.on("seek", time => {
      this.setState({
        waiting: true,
        ready: false,
      });
      localAction = false;
      video.current.pause();
      video.current.currentTime = time;
    });

    socket.on("people", people => {
      this.setState({
        people: people
      });
    });

    socket.on("url", url => {
      this.updateUrl(url);
    });

    socket.on("subtitles", newSubtitles => {
      subtitles = newSubtitles;
      this.updateSubtitles();
    });

    this.updateUrl = this.updateUrl.bind(this);
    this.copyLink = this.copyLink.bind(this);
    this.toggleUrlPanel = this.toggleUrlPanel.bind(this);
    this.toggleDescriptionPanel = this.toggleDescriptionPanel.bind(this);
    this.toggleSubtitlesPanel = this.toggleSubtitlesPanel.bind(this);
    this.uploadSubtitles = this.uploadSubtitles.bind(this);
    this.updateSubtitles = this.updateSubtitles.bind(this);
  }

  componentDidMount() {
    let timeout;
    document.addEventListener("mousemove", () => {
      clearTimeout(timeout);
      this.setState({ controlsShown: true });
      timeout = setTimeout(() => { this.setState({ controlsShown: false }) }, 2600);
    });

    document.addEventListener("keypress", event => {
      if (event.key === "l") {
        download(log, "log.txt");
      }
    });

    video.current.onplay = () => {
      consoleLog("Event: playing, localAction:", localAction)
      if (this.state.waiting) {
        video.current.pause();
      } else {
        if (localAction) {
          socket.emit("play");
        }
      }
      localAction = true;
    }
    video.current.onpause = () => {
      consoleLog("Event: paused, localAction:", localAction)
      if (!this.state.waiting && video.current.readyState >= 3) {
        if (localAction) {
          socket.emit("pause");
        }
        localAction = true;
      }
    }
    video.current.onseeking = () => {
      this.setState({ waiting: true });
      if (localAction) {
        socket.emit("seek", video.current.currentTime);
      }
      localAction = true;
      this.setState({ ready: false });
    };
    video.current.oncanplay = () => {
      socket.emit("ready", video.current.currentTime);
      this.setState({
        ready: true,
      });
      // this.testReady();
    }
    video.current.onwaiting = () => {
      if (!this.state.waiting) {
        consoleLog("Event: buffering");
        video.current.pause();
        this.setState({ waiting: true });
        socket.emit("seek", video.current.currentTime);
        localAction = true;
        this.setState({ ready: false });
      }
    }
  }

  componentWillUnmount() {
    socket.close();
  }

  /* dataHandler(connection, data) {
    consoleLog("Received data: " + JSON.stringify(data));

    if (!this.state.joined && data.type !== "info")
      return;

    switch (data.type) {
      case "info request":
        connection.send({
          type: "info",
          content: {
            url: this.state.url,
            time: video.current.currentTime,
            paused: paused,
            waiting: this.state.waiting,
            readyCount: this.state.readyCount,
            subtitles: subtitles,
          }
        });
        this.setState({ description: { ...this.state.description, ...{ people: this.state.description.people + 1 } } });
        break;
      case "description request":
        connection.send({ type: "description", content: { people: Object.keys(socket).length + 1, duration: this.video.current.duration } });
        break;
      case "description":
        this.setState({ joined: false, description: data.content, descriptionPanel: true, urlPanel: false });
        break;
      case "info":
        for (const peerId of data.content.peers) {
          this.connect(peerId);
        }
        this.setState({
          waiting: data.content.waiting,
          readyCount: data.content.readyCount,
          url: data.content.url,
          joined: true,
          urlPanel: !data.content.url,
          description: { ...this.state.description, ...{ people: this.state.description.people + 1 } },
        });
        video.current.currentTime = data.content.time;
        subtitles = data.content.subtitles;
        this.updateSubtitles();
        paused = data.content.paused;
        this.testReady();
        break;
      case "url":
        this.updateUrl(data.content);
        break;
      case "subtitles": {
        subtitles = data.content;
        this.updateSubtitles();
        break;
      }
      case "play":
        localAction = false;
        video.current.play();
        break;
      case "pause":
        localAction = false;
        video.current.pause();
        break;
      case "seek":
        this.setState({
          waiting: true,
          readyCount: 0,
          ready: false,
        });
        localAction = false;
        video.current.pause();
        video.current.currentTime = data.content;
        break;
      case "ready":
        if (data.content === video.current.currentTime) {
          this.setState({ readyCount: this.state.readyCount + 1 });
        }
        this.testReady();
        break;
      case "kick":
        try { socket[data.content].close(); } catch { }
        break;
      default:
        break;
    }
  } */

  /* join() {
    connections[this.props.match.params.peerid].send({ type: "info request" });
    this.setState({ descriptionPanel: false });
  } */

  /* testReady() {
    if (this.state.url && this.state.readyCount === Object.keys(connections).length + 1) {
      this.setState({ waiting: false });
      if (!paused) {
        localAction = false;
        video.current.play();
      }
    }
  } */

  /* sendEveryone(data) {
    for (const id in connections) {
      connections[id].send(data);
    }
    consoleLog("Sent data: " + JSON.stringify(data));
  } */

  updateUrl(url) {
    if (url !== this.state.url) {
      this.setState({
        url: url,
        urlPanel: false,
        waiting: true,
        ready: false
      });
      subtitles = [];
      this.updateSubtitles();
    }
  }

  async uploadSubtitles(event) {
    this.setState({ subtitlesPanel: false });
    for (var file of event.target.files) {
      if (file.type.includes("x-subrip")) {
        file = new Blob([srt2webvtt(await file.text())], { type: 'text/vtt' });
      }
      subtitles.push(file);
    }
    socket.emit("subtitles", subtitles);
    this.updateSubtitles();
  }

  updateSubtitles() {
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

  // TODO
  copyLink() {
    navigator.clipboard.writeText(window.location);
  }

  toggleUrlPanel() {
    this.setState({
      descriptionPanel: false,
      subtitlesPanel: false,
      urlPanel: !this.state.urlPanel
    });
  }

  toggleDescriptionPanel() {
    this.setState({
      urlPanel: false,
      subtitlesPanel: false,
      descriptionPanel: !this.state.descriptionPanel
    });
  }

  toggleSubtitlesPanel() {
    this.setState({
      urlPanel: false,
      descriptionPanel: false,
      subtitlesPanel: !this.state.subtitlesPanel
    });
  }

  render() {
    return (
      <div className="App">
        <video ref={video} src={this.state.url} controls style={{ display: this.state.url ? "block" : "none" }} />
        {this.state.waiting && (this.state.ready ?
          <span className="status">Waiting for {this.state.buffering} {this.state.buffering === 1 ? "person" : "people"}'s stream...</span> :
          <span className="status">Loading...</span>
        )}
        {this.state.urlPanel &&
          <div className="panel" id="url-selector">
            <span className="item-title">Movie URL</span>
            <ActionInput placeholder="https://example.com/movie.mp4" autoFocus={true} icon={faPlay} width={350} action={url => { socket.emit("url", url); this.updateUrl(url); }} />
          </div>
        }
        {this.state.descriptionPanel &&
          <div className="panel" id="join">
            <span className="item-title">Party Description</span>
            <ul>
              <li>People: {this.state.people}</li>
              {video.current.duration > 1 &&
                <li>Duration: {video.current.duration.toHHMMSS()}</li>}
            </ul>
            {/* {!this.state.joined &&
              <button onClick={this.join}>Join</button>} */}
          </div>
        }
        {this.state.subtitlesPanel &&
          <div className="panel" id="subtitles">
            <span className="item-title">Upload Subtitles</span>
            <input type="file" accept=".vtt,.srt" multiple onChange={this.uploadSubtitles} id="upload-button" style={{ position: "absolute", display: "none" }} />
            <label htmlFor="upload-button" className="big-icon-button" style={{ width: 41, height: 41 }}>
              <FontAwesomeIcon icon={faFileUpload} />
            </label>
          </div>
        }
        <div className="top-button" style={{ left: 20, opacity: this.state.controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faLink} onClick={this.copyLink} /><span className="tooltip">Copy Link</span></div>
        <div className="top-button" style={{ left: 60, opacity: this.state.controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faUsers} onClick={this.toggleDescriptionPanel} /><span className="tooltip">Party Description</span></div>
        <div className="top-button" style={{ left: 106.25, opacity: this.state.controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faFilm} onClick={this.toggleUrlPanel} /><span className="tooltip">Movie URL</span></div>
        {this.state.url && <div className="top-button" style={{ left: 146.25, opacity: this.state.controlsShown ? 0.5 : 0 }}><FontAwesomeIcon icon={faClosedCaptioning} onClick={this.toggleSubtitlesPanel} /><span className="tooltip">Subtitles</span></div>}
      </div>
    );
  }
}
