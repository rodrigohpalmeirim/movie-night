const path = require('path');
const express = require('express');
const port = process.env.PORT || 5000;
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const { time } = require('console');
const io = new Server(server);

app.use(express.static(path.resolve(__dirname, '../client/build')));

server.listen(port, () => {
    console.log(`Listening on port ${port}`);
});

let rooms = {};

io.on('connection', (socket) => {
    socket.onAny((...a) => console.log(a));
    console.log('a user connected');

    let room;

    socket.on('disconnect', () => {
        console.log('user disconnected');
        io.in(roomId).fetchSockets().then(sockets => io.in(roomId).emit("people", sockets.length));
    });

    socket.on("join", (_roomId) => {
        if (rooms[_roomId] == undefined) {
            room = {
                id: _roomId,
                playing: false,
                lastKnownSeek: 0,
                lastServerTime: new Date(),
                buffering: 0,
                url: null,
                time: () => (playing ? (new Date() - room.lastServerTime) : 0) + lastKnownSeek,
                getNumPeople: () => io.in(room.id).fetchSockets().then(sockets => io.in(room.id).emit("people", sockets.length))
            };
            rooms[room.id] = room;
        } else {
            room = rooms[_roomId];
        }
        socket.join(room.id);

        ((playing) ? socket.to(room.id) : socket).emit("pause", time);


        io.in(room.id).fetchSockets().then(sockets => io.in(room.id).emit("people", sockets.length));
    });


    socket.on("play", (timestamp) => {
        socket.to(room.id).emit("play");
        room.playing = true;
        room.lastKnownSeek = timestamp;
        room.lastServerTime = new Date();
    });

    socket.on("pause", (timestamp) => {
        socket.to(room.id).emit("pause", timestamp);
        room.playing = false;
        room.lastKnownSeek = timestamp;
        room.lastServerTime = new Date();
    });

    socket.on("seek", (timestamp) => {
        socket.to(room.id).emit("seek", timestamp);
        room.lastKnownSeek = timestamp;
        room.lastServerTime = new Date();
    });

    socket.on("url", (url) => {
        socket.to(room.id).emit("url", url);
        room.url = url;
    });

    socket.on("subtitles", () => {
        //TODO
    });
});