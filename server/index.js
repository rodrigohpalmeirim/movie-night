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

rooms = {};

io.on('connection', (socket) => {
    socket.onAny((...a) => console.log(a))
    console.log('a user connected');

    let room;

    socket.on('disconnect', () => {
        console.log('user disconnected');
        io.in(room).fetchSockets().then(sockets => io.in(room).emit("people", sockets.length));
    });

    socket.on("join", (roomId) => {
        room = roomId;
        if (rooms[room] == undefined) {
            rooms[room] = {
                buffering: 0,
            };
        }
        socket.join(room);

        io.in(room).fetchSockets().then(sockets => io.in(room).emit("people", sockets.length));
    });


    socket.on("play", () => {
        socket.to(room).emit("play");
    });

    socket.on("pause", () => {
        socket.to(room).emit("pause");
    });

    socket.on("seek", (timestamp) => {
        socket.to(room).emit("seek", timestamp);
    });

    socket.on("url", (url) => {
        socket.to(room).emit("url", url);
    });

    socket.on("subtitles", (subtitles) => {
        socket.to(room).emit("subtitles", subtitles);
    });
});