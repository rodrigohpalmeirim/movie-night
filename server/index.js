const path = require('path');
const express = require('express');
const port = process.env.PORT || 5174;
const app = express();
const cors = require('cors');
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { pingTimeout: 5000, pingInterval: 5000 });

app.use(express.static(path.resolve('client/dist')));
app.use((req, res) => res.sendFile(path.resolve('client/dist/index.html')));
app.use(cors());

server.listen(port, () => {
    console.log(`Listening on port ${port}`);
});

let rooms = {};

let numClients = 0;
io.on('connection', (socket) => {
    let client = numClients++;
    socket.onAny((...a) => console.log(client, a));
    console.log('a user connected');

    let room;

    socket.on("join", async (_roomId) => {
        try {
            if (rooms[_roomId] == undefined) {
                room = {
                    id: _roomId,
                    playing: true,
                    lastKnownSeek: 0,
                    lastServerTime: new Date(),
                    buffering: [],
                    url: 'https://upload.wikimedia.org/wikipedia/commons/7/76/Sprite_Fright_-_Blender_Open_Movie-full_movie.webm',
                    subtitles: [],
                    numPeople: 1,
                    time: () => (room.playing ? (new Date() - room.lastServerTime) / 1000 : 0) + room.lastKnownSeek,
                };
                rooms[room.id] = room;
            } else {
                room = rooms[_roomId];
                room.numPeople++;
                room.buffering = (await io.in(room.id).fetchSockets()).map(socket => socket.id);
            }
            socket.join(room.id);

            io.in(room.id).emit("people", room.numPeople);
            if (room.url != null) {
                socket.emit("url", room.url);
                socket.emit("subtitles", room.subtitles);
                console.log(room.playing, (new Date() - room.lastServerTime) / 1000, room.lastKnownSeek);
                io.in(room.id).emit("seek", room.time());
                io.in(room.id).emit("buffering", room.buffering.length);
                room.lastServerTime = new Date();
            }

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
                // io.in(room.id).fetchSockets().then(sockets => io.in(room.Id).emit("people", sockets.length));
                room.numPeople--;
                io.in(room.id).emit("people", room.numPeople);
                if (room.buffering.length == 1 && room.buffering.includes(socket.id)) {
                    io.in(room.id).emit("play");
                    room.lastServerTime = new Date();
                }
                room.buffering = room.buffering.filter(id => id !== socket.id);
                io.in(room.id).emit("buffering", room.buffering.length);
            }
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("play", () => {
        try {
            room.playing = true;
            if (room.buffering.length <= 0) {
                socket.to(room.id).emit("play");
                room.lastServerTime = new Date();
            }
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("pause", async (timestamp) => {
        try {
            socket.to(room.id).emit("pause", timestamp);
            room.buffering = (await socket.to(room.id).fetchSockets()).map(socket => socket.id);
            room.playing = false;
            room.lastKnownSeek = timestamp;
            room.lastServerTime = new Date();
            io.in(room.id).emit("buffering", room.buffering.length);
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("seek", async (timestamp) => {
        try {
            socket.to(room.id).emit("seek", timestamp);
            room.buffering = (await io.in(room.id).fetchSockets()).map(socket => socket.id);
            room.lastKnownSeek = timestamp;
            room.lastServerTime = new Date();
            io.in(room.id).emit("buffering", room.buffering.length);
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("url", async (url) => {
        try {
            socket.to(room.id).emit("url", url);
            room.buffering = (await io.in(room.id).fetchSockets()).map(socket => socket.id);
            room.lastKnownSeek = 0;
            room.lastServerTime = new Date();
            room.url = url;
        } catch (error) {
            console.log(error);
        }
    });

    socket.on("ready", () => {
        try {
            room.buffering = room.buffering.filter(id => id !== socket.id);
            io.in(room.id).emit("buffering", room.buffering.length);
            if (room.buffering.length <= 0 && room.playing) {
                io.in(room.id).emit("play");
                room.lastServerTime = new Date();
            }
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
});