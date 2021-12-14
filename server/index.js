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

io.on('connection', (socket) => {
    socket.onAny((...a)=>console.log(a))
    console.log('a user connected');
    let roomId = () => {
        for (r of socket.rooms.keys()) {
            if (r != socket.id) {
                return r;
            }
        }
        console.log(socket.rooms);
        throw "No room id";
    }

    socket.on('disconnect', () => {
        console.log('user disconnected, had rooms', socket.rooms);
    });

    socket.on("join", (roomIdNow) => {
        socket.join(roomIdNow);
        console.log("User joined");
    });


    socket.on("play", () => {
        socket.to(roomId()).emit("play");
    });

    socket.on("pause", () => {
        socket.to(roomId()).emit("pause");
    });

    socket.on("seek", (timestamp) => {
        socket.to(roomId()).emit("seek", timestamp);
    });

    socket.on("url", (url) => {
        socket.to(roomId()).emit("url", url);
    });

    socket.on("subtitles", (roomIdNow) => {
        //TODO
    });
});