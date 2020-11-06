import './App.css';
import React, { Component } from 'react';
import Peer from "peerjs";
import { faFilm, faLink, faPlay, faShare } from '@fortawesome/free-solid-svg-icons';
import { ActionInput } from './ActionInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

var peer;
var connections = {};
var paused = false;
var localAction = true;

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
      urlSelector: false,
      ready: false
    }

    this.video = React.createRef();

    this.connect = this.connect.bind(this);
    this.connectionHandler = this.connectionHandler.bind(this);
    this.dataHandler = this.dataHandler.bind(this);
    this.changeUrl = this.changeUrl.bind(this);
    this.copyLink = this.copyLink.bind(this);
    this.toggleUrlSelector = this.toggleUrlSelector.bind(this);
  }

  componentDidMount() {
    peer.on("open", (id) => {
      this.setState({
        id: id,
        urlSelector: true,
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
      connections[connection.peer] = connection;
      if (this.props.match.params.peerid) {
        connection.send({ type: "info request" });
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
    switch (data.type) {
      case "info request":
        connection.send({ type: "info", content: { peers: Object.keys(connections), url: this.state.url, time: this.video.current.currentTime, paused: paused, waiting: this.state.waiting, readyCount: this.state.readyCount } });
        break;
      case "info":
        for (const peerId of data.content.peers) {
          this.connect(peerId);
        }
        this.setState({
          waiting: data.content.waiting,
          readyCount: data.content.readyCount,
          url: data.content.url
        });
        if (data.content.url)
          this.setState({ urlSelector: false });
        this.video.current.currentTime = data.content.time;
        paused = data.content.paused;
        this.testReady();
        break;
      case "url":
        if (data.content !== this.state.url) {
          console.log(data.content);
          this.setState({
            url: data.content,
            waiting: true,
            readyCount: 0,
            ready: false,
            urlSelector: false,
          });
          paused = false;
        }
        break;
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
  }

  changeUrl(url) {
    if (url !== this.state.url) {
      this.setState({
        url: url,
        urlSelector: false,
      });
      this.sendEveryone({ type: "url", content: url });
      this.setState({
        waiting: true,
        readyCount: 0,
        ready: false
      });
      paused = false;
    }
  }

  copyLink() {
    navigator.clipboard.writeText("https://localhost:3000/#/" + this.state.id);
  }

  toggleUrlSelector() {
    this.setState({ urlSelector: !this.state.urlSelector });
  }

  render() {
    return (
      <div className="App">
        <video ref={this.video} src={this.state.url} controls style={{ display: this.state.url ? "block" : "none" }} />
        {this.state.waiting && (this.state.ready ?
          <span className="status">Waiting for {Object.keys(connections).length + 1 - this.state.readyCount} {Object.keys(connections).length + 1 - this.state.readyCount !== 1 ? "peers" : "peer"}...</span> :
          <span className="status">Loading...</span>
        )}
        {this.state.urlSelector &&
          <div className="panel" id="url-selector">
            <span className="item-title">Enter a video URL</span>
            <ActionInput placeholder="https://example.com/video.mp4" autoFocus={true} icon={faPlay} width={350} action={this.changeUrl} />
          </div>
        }
        <FontAwesomeIcon className="top-button" icon={faLink} style={{ left: 20 }} onClick={this.copyLink} />
        <FontAwesomeIcon className="top-button" icon={faFilm} style={{ left: 60 }} onClick={this.toggleUrlSelector} />
      </div>
    );
  }
}