const path = require('path');
const express = require('express');
const port = process.env.PORT || 5000;
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
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

    let ready = false;
    socket.on("join", (_roomId) => {
        if (rooms[_roomId] == undefined) {
            room = {
                id: _roomId,
                playing: false,
                lastKnownSeek: 0,
                lastServerTime: new Date(),
                buffering: 0,
                url: null,
                numPeople: 1,
                time: () => (room.playing ? (new Date() - room.lastServerTime) : 0) + room.lastKnownSeek, // TODO fix this
            };
            rooms[room.id] = room;
        } else {
            room = rooms[_roomId];
            room.numPeople ++;
        }
        socket.join(room.id);

        ((room.playing) ? socket.to(room.id) : socket).emit("pause", room.time()); // TODO fix this
        console.log(room.time())

        socket.emit("url", room.url);
        socket.emit("seek", room.time());
        socket.emit("buffering", room.buffering);
        socket.emit("people", room.numPeople);


        io.in(room.id).fetchSockets().then(sockets => io.in(room.id).emit("people", sockets.length));

        console.log('a user joined');
        console.log("room", room)
    });


    socket.on('disconnect', () => {
        console.log('user disconnected');
        if (room != undefined) {
            console.log(room);
            io.in(room.id).fetchSockets().then(sockets => io.in(room.Id).emit("people", sockets.length));
            room.numPeople--;
            if (!ready)
                room.buffering--;
        }
    });


    socket.on("play", () => {
        room.playing = true;
        if (room.buffering == 0) {
            socket.to(room.id).emit("play");
        }
    });

    socket.on("pause", (timestamp) => {
        socket.to(room.id).emit("pause", timestamp);
        room.buffering = room.numPeople - 1;
        room.playing = false;
        ready = false;
        room.lastKnownSeek = timestamp;
        room.lastServerTime = new Date();
        io.in(room.id).emit("buffering", room.buffering);
    });

    socket.on("seek", (timestamp) => {
        ready = false;
        socket.to(room.id).emit("seek", timestamp);
        room.buffering = room.numPeople;
        room.lastKnownSeek = timestamp;
        room.lastServerTime = new Date();
        io.in(room.id).emit("buffering", room.buffering);
    });

    socket.on("url", (url) => {
        ready = false;
        socket.to(room.id).emit("url", url);
        room.buffering = room.numPeople;
        room.url = url;
    });


    socket.on("ready", () => {
        ready = true;
        room.buffering -= 1;
        io.in(room.id).emit("buffering", room.buffering);
        if (room.buffering <= 0 && room.playing) {
            io.in(room.id).emit("play");
        }
    });

    socket.on("subtitles", (subtitles) => {
        socket.to(room.id).emit("subtitles", subtitles);
    });

    socket.on("info", (roomId, callback) => {
        callback({ people: rooms[roomId] !== undefined ? rooms[roomId].numPeople : 0 });
    })
});