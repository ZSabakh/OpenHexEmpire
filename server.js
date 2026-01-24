import http from 'http';
import express from 'express';
import serveStatic from 'serve-static';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Server } from 'socket.io';
import { GameRoom } from './GameRoom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameRooms = new Map(); 

// Settings
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(serveStatic(__dirname + '/public'));

app.use('/shared', serveStatic(__dirname + '/shared'));

const homepage = function(req, res) {
  res.render('index', {});
};

app.get('/', homepage);

io.on('connection', (socket) => {
    console.log(`[Server] Client connected: ${socket.id}`);
    
    socket.emit('connected', { 
        message: 'Connected to Server',
        socketId: socket.id 
    });

    socket.on('create_game', (data) => {
        const roomId = data.roomId || `room_${Date.now()}`;
        const mapSeed = data.mapSeed || Math.floor(Math.random() * 999999);
        const playerName = data.playerName || 'Player';

        const gameRoom = new GameRoom(roomId, mapSeed);
        gameRooms.set(roomId, gameRoom);

        const result = gameRoom.addPlayer(socket.id, playerName);
        
        if (result.success) {
            socket.join(roomId);
            socket.emit('game_created', {
                success: true,
                roomId: roomId,
                mapSeed: mapSeed,
                partyId: result.partyId,
                playerName: result.playerName,
                gameState: gameRoom.getGameState()
            });

            console.log(`[Server] Game room ${roomId} created by ${playerName}`);
        } else {
            socket.emit('game_created', {
                success: false,
                error: result.error
            });
        }
    });

    socket.on('join_game', (data) => {
        const roomId = data.roomId;
        const playerName = data.playerName || 'Player';

        const gameRoom = gameRooms.get(roomId);
        
        if (!gameRoom) {
            socket.emit('game_joined', {
                success: false,
                error: 'Game room not found'
            });
            return;
        }

        const result = gameRoom.addPlayer(socket.id, playerName);
        
        if (result.success) {
            socket.join(roomId);
            socket.emit('game_joined', {
                success: true,
                roomId: roomId,
                partyId: result.partyId,
                playerName: result.playerName,
                gameState: gameRoom.getGameState()
            });

            socket.to(roomId).emit('player_joined', {
                playerName: result.playerName,
                partyId: result.partyId,
                playerCount: gameRoom.getPlayerCount()
            });

            console.log(`[Server] ${playerName} joined room ${roomId}`);
        } else {
            socket.emit('game_joined', {
                success: false,
                error: result.error
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Server] Client disconnected: ${socket.id}`);
        
        for (const [roomId, gameRoom] of gameRooms.entries()) {
            if (gameRoom.removePlayer(socket.id)) {
                // Notify other players
                io.to(roomId).emit('player_left', {
                    playerCount: gameRoom.getPlayerCount()
                });

                if (gameRoom.isEmpty()) {
                    gameRooms.delete(roomId);
                    console.log(`[Server] Room ${roomId} deleted (empty)`);
                }
                break;
            }
        }
    });
});

server.listen(app.get('port'), function(){
    console.log('OpenHexEmpire is listening on port ' + app.get('port'));
});
