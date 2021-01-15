import './App.css';
import React, { Component } from 'react';
import Peer from "peerjs";
import { faClosedCaptioning, faFileUpload, faFilm, faLink, faPlay, faUsers } from '@fortawesome/free-solid-svg-icons';
import { ActionInput } from './ActionInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

var peer;
var connections = {};
var paused = false;
var localAction = true;
var subtitles = [];

Number.prototype.toHHMMSS = function () {
  var hours = Math.floor(this / 3600);
  var minutes = Math.floor((this - (hours * 3600)) / 60);
  var seconds = Math.floor(this - (hours * 3600) - (minutes * 60));

  if (minutes < 10) { minutes = "0" + minutes; }
  if (seconds < 10) { seconds = "0" + seconds; }
  return hours + ':' + minutes + ':' + seconds;
}

export default class App extends Component {
  constructor(props) {
    super(props);

    peer = new Peer(null, {
      host: "peerjs-server.ddns.net",
      port: "9000"
    });

    this.state = {
      readyCount: 0,
      waiting: false,
      urlPanel: false,
      descriptionPanel: false,
      ready: false,
      controlsShown: true,
      joined: true,
      description: { people: 1 },
      subtitlesPanel: false,
    }

    this.video = React.createRef();

    this.connect = this.connect.bind(this);
    this.connectionHandler = this.connectionHandler.bind(this);
    this.dataHandler = this.dataHandler.bind(this);
    this.changeUrl = this.changeUrl.bind(this);
    this.copyLink = this.copyLink.bind(this);
    this.toggleUrlPanel = this.toggleUrlPanel.bind(this);
    this.toggleDescriptionPanel = this.toggleDescriptionPanel.bind(this);
    this.toggleSubtitlesPanel = this.toggleSubtitlesPanel.bind(this);
    this.uploadSubtitles = this.uploadSubtitles.bind(this);
    this.updateSubtitles = this.updateSubtitles.bind(this);
    this.join = this.join.bind(this);
  }

  componentDidMount() {
    let timeout;
    document.addEventListener("mousemove", () => {
      clearTimeout(timeout);
      this.setState({ controlsShown: true });
      timeout = setTimeout(() => { this.setState({ controlsShown: false }) }, 2600);
    });

    peer.on("open", (id) => {
      this.setState({
        id: id,
        urlPanel: true,
      });
      if (this.props.match.params.peerid) {
        this.connect(this.props.match.params.peerid);
      }
    });
    peer.on("connection", this.connectionHandler);

    this.video.current.onplay = () => {
      if (this.state.waiting) {
        this.video.current.pause();
      } else {
        paused = false;
        if (localAction)
          this.sendEveryone({ type: "play" });
      }
      localAction = true;
    }
    this.video.current.onpause = () => {
      if (!this.state.waiting && this.video.current.readyState === 4) {
        paused = true;
        if (localAction)
          this.sendEveryone({ type: "pause" });
      }
      localAction = true;
    }
    this.video.current.onseeking = () => {
      this.setState({ waiting: true });
      if (localAction)
        this.sendEveryone({ type: "seek", content: this.video.current.currentTime });
      localAction = true;
      this.setState({ readyCount: 0, ready: false });
    };
    this.video.current.oncanplay = () => {
      this.sendEveryone({ type: "ready", content: this.video.current.currentTime });
      this.setState({ readyCount: this.state.readyCount + 1, ready: true });
      this.testReady();
    }
    this.video.current.onwaiting = () => {
      this.setState({ waiting: true });
      if (localAction)
        this.sendEveryone({ type: "seek", content: this.video.current.currentTime });
      localAction = true;
      this.setState({ readyCount: 0, ready: false });
    }
  }

  componentWillUnmount() {
    for (const id in connections) {
      try { connections[id].close(); } catch { }
    }
  }

  connect(id) {
    const connection = peer.connect(id);
    this.connectionHandler(connection);
  }

  connectionHandler(connection) {
    connection.on("open", () => {
      if (this.props.match.params.peerid === connection.peer) {
        connections[connection.peer] = connection;
        connection.send({ type: "description request" });
      }

      console.log("Connected to:", connection.peer);
    });

    connection.on("close", () => {
      delete connections[connection.peer];
      console.log("Disconnected from:", connection.peer);
      this.testReady();
    });

    connection.on("data", (data) => this.dataHandler(connection, data));
  }

  dataHandler(connection, data) {
    console.log("Received data:", data)
    switch (data.type) {
      case "info request":
        connection.send({
          type: "info",
          content: {
            peers: Object.keys(connections),
            url: this.state.url,
            time: this.video.current.currentTime,
            paused: paused,
            waiting: this.state.waiting,
            readyCount: this.state.readyCount,
            subtitles: subtitles,
          }
        });
        connections[connection.peer] = connection;
        this.setState({ description: { ...this.state.description, ...{ people: this.state.description.people + 1 } } });
        break;
      case "description request":
        connection.send({ type: "description", content: { people: Object.keys(connections).length + 1, duration: this.video.current.duration } });
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
        this.video.current.currentTime = data.content.time;
        subtitles = data.content.subtitles;
        this.updateSubtitles();
        paused = data.content.paused;
        this.testReady();
        break;
      case "url":
        if (data.content !== this.state.url) {
          this.setState({
            url: data.content,
            waiting: true,
            readyCount: 0,
            ready: false,
            urlPanel: false,
          });
          paused = false;
          subtitles = [];
          this.updateSubtitles();
        }
        break;
      case "subtitles": {
        subtitles = data.content;
        this.updateSubtitles();
        break;
      }
      case "play":
        localAction = false;
        this.video.current.play();
        break;
      case "pause":
        localAction = false;
        this.video.current.pause();
        break;
      case "seek":
        this.setState({
          waiting: true,
          readyCount: 0,
          ready: false,
        });
        localAction = false;
        this.video.current.pause();
        this.video.current.currentTime = data.content;
        break;
      case "ready":
        if (data.content === this.video.current.currentTime) {
          this.setState({ readyCount: this.state.readyCount + 1 });
        }
        this.testReady();
        break;
      default:
        break;
    }
  }

  join() {
    connections[this.props.match.params.peerid].send({ type: "info request" });
    this.setState({ descriptionPanel: false });
  }

  testReady() {
    if (this.state.url && this.state.readyCount === Object.keys(connections).length + 1) {
      this.setState({ waiting: false });
      if (!paused) {
        localAction = false;
        this.video.current.play();
      }
    }
  }

  sendEveryone(data) {
    for (const id in connections) {
      connections[id].send(data);
    }
    console.log("Sent data:", data)
  }

  changeUrl(url) {
    if (url !== this.state.url) {
      this.setState({
        url: url,
        urlPanel: false,
      });
      this.sendEveryone({ type: "url", content: url });
      this.setState({
        waiting: true,
        readyCount: 0,
        ready: false
      });
      paused = false;
      subtitles = [];
      this.updateSubtitles();
    }
  }

  uploadSubtitles(event) {
    this.setState({ subtitlesPanel: false });
    for (const file of event.target.files) {
      subtitles.push(file);
    }
    this.sendEveryone({ type: "subtitles", content: subtitles });
    this.updateSubtitles();
  }

  updateSubtitles() {
    this.video.current.innerHTML = "";
    while (this.video.current.firstChild) {
      this.video.current.removeChild(this.video.current.lastChild);
    }
    for (const file of subtitles) {
      const track = document.createElement("track");
      track.kind = "captions";
      // track.label = "English";
      // track.srclang = "en";
      track.src = URL.createObjectURL(new Blob([file]));
      this.video.current.appendChild(track);
    }
  }

  copyLink() {
    navigator.clipboard.writeText("https://rodrigohpalmeirim.github.io/movie-night/#/" + this.state.id);
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
        <video ref={this.video} src={this.state.url} controls style={{ display: this.state.url ? "block" : "none" }} />
        {this.state.waiting && (this.state.ready ?
          <span className="status">Waiting for {Object.keys(connections).length + 1 - this.state.readyCount} {Object.keys(connections).length + 1 - this.state.readyCount === 1 ? "person" : "people"}'s stream...</span> :
          <span className="status">Loading...</span>
        )}
        {this.state.urlPanel &&
          <div className="panel" id="url-selector">
            <span className="item-title">Movie URL</span>
            <ActionInput placeholder="https://example.com/movie.mp4" autoFocus={true} icon={faPlay} width={350} action={this.changeUrl} />
          </div>
        }
        {this.state.descriptionPanel &&
          <div className="panel" id="join">
            <span className="item-title">Party Description</span>
            <ul>
              <li>People: {this.state.description.people}</li>
              {this.state.description.duration > 1 &&
                <li>Duration: {this.state.description.duration.toHHMMSS()}</li>}
            </ul>
            {!this.state.joined &&
              <button onClick={this.join}>Join</button>}
          </div>
        }
        {this.state.subtitlesPanel &&
          <div className="panel" id="subtitles">
            <span className="item-title">Upload Subtitles</span>
            <input type="file" accept=".vtt" multiple onChange={this.uploadSubtitles} id="upload-button" style={{ position: "absolute", display: "none" }} />
            <label htmlFor="upload-button" className="big-icon-button" style={{ width: 41, height: 41 }}>
              <FontAwesomeIcon icon={faFileUpload} />
            </label>
          </div>
        }
        {this.state.id && this.state.joined && <FontAwesomeIcon className="top-button" icon={faLink} style={{ left: 20, opacity: this.state.controlsShown ? 0.5 : 0 }} onClick={this.copyLink} />}
        {this.state.id && this.state.joined && <FontAwesomeIcon className="top-button" icon={faUsers} style={{ left: 60, opacity: this.state.controlsShown ? 0.5 : 0 }} onClick={this.toggleDescriptionPanel} />}
        {this.state.id && this.state.joined && <FontAwesomeIcon className="top-button" icon={faFilm} style={{ left: 106.25, opacity: this.state.controlsShown ? 0.5 : 0 }} onClick={this.toggleUrlPanel} />}
        {this.state.id && this.state.joined && this.state.url && <FontAwesomeIcon className="top-button" icon={faClosedCaptioning} style={{ left: 146.25, opacity: this.state.controlsShown ? 0.5 : 0 }} onClick={this.toggleSubtitlesPanel} />}
      </div>
    );
  }
}