const path = require('path');
const express = require('express');
const port = process.env.PORT || 5000;
const app = express();
const cors = require('cors');
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { pingTimeout: 5000, pingInterval: 5000 });

app.use(express.static(path.resolve('client/build')));
app.use((req, res) => res.sendFile(path.resolve('client/build/index.html')));
app.use(cors());

server.listen(port, () => {
    console.log(`Listening on port ${port}`);
});

let rooms = {};

io.on('connection', (socket) => {
    socket.onAny((...a) => console.log(a));
    console.log('a user connected');

    let room;

    let serverTimeWhenReady;

    socket.on("join", (_roomId) => {
        try {
            if (rooms[_roomId] == undefined) {
                room = {
                    id: _roomId,
                    playing: true,
                    lastKnownSeek: 0,
                    lastServerTime: new Date(),
                    buffering: 0,
                    url: null,
                    subtitles: [],
                    numPeople: 1,
                    time: () => (room.playing ? (new Date() - room.lastServerTime) / 1000 : 0) + room.lastKnownSeek,
                };
                rooms[room.id] = room;
            } else {
                room = rooms[_roomId];
                room.numPeople++;
                room.buffering = room.numPeople;
            }
            socket.join(room.id);

            socket.emit("url", room.url);
            io.in(room.id).emit("people", room.numPeople);
            io.in(room.id).emit("seek", room.time());
            io.in(room.id).emit("buffering", room.buffering);
            io.in(room.id).emit("subtitles", room.subtitles);

            // io.in(room.id).fetchSockets().then(sockets => io.in(room.id).emit("people", sockets.length));

            console.log('a user joined');
            console.log("room", room);
        } catch (error) {
            console.log(error);
        }
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
        try {
            if (room != undefined) {
                console.log(room);
                // io.in(room.id).fetchSockets().then(sockets => io.in(room.Id).emit("people", sockets.length));
                room.numPeople--;
                io.in(room.id).emit("people", room.numPeople);
                if (serverTimeWhenReady !== room.lastServerTime) {
                    room.buffering = Math.max(room.buffering - 1, 0);
                    io.in(room.id).emit("buffering", room.buffering);
                }
                if (room.buffering <= 0 && room.playing) {
                    io.in(room.id).emit("play");
                    room.lastServerTime = new Date();
                }
            }
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("play", () => {
        try {
            room.playing = true;
            if (room.buffering <= 0) {
                socket.to(room.id).emit("play");
                room.lastServerTime = new Date();
            }
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("pause", (timestamp) => {
        try {
            socket.to(room.id).emit("pause", timestamp);
            room.buffering = room.numPeople - 1;
            room.playing = false;
            room.lastKnownSeek = timestamp;
            room.lastServerTime = new Date();
            serverTimeWhenReady = room.lastServerTime;
            io.in(room.id).emit("buffering", room.buffering);
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("seek", (timestamp) => {
        try {
            socket.to(room.id).emit("seek", timestamp);
            room.buffering = room.numPeople;
            room.lastKnownSeek = timestamp;
            room.lastServerTime = new Date();
            io.in(room.id).emit("buffering", room.buffering);
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("url", (url) => {
        try {
            socket.to(room.id).emit("url", url);
            room.buffering = room.numPeople;
            room.lastKnownSeek = 0;
            room.lastServerTime = new Date();
            room.url = url;
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("ready", () => {
        try {
            room.buffering = Math.max(room.buffering - 1, 0);
            io.in(room.id).emit("buffering", room.buffering);
            if (room.buffering <= 0 && room.playing) {
                io.in(room.id).emit("play");
                room.lastServerTime = new Date();
            }
            serverTimeWhenReady = room.lastServerTime;
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("subtitles", (subtitles) => {
        try {
            socket.to(room.id).emit("subtitles", subtitles);
            room.subtitles = subtitles;
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("info", (roomId, callback) => {
        try {
            callback({ people: rooms[roomId] !== undefined ? rooms[roomId].numPeople : 0 });
        } catch (error) {
            console.log(error);
        }
    });
});