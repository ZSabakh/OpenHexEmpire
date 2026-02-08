import http from 'http';
import express from 'express';
import serveStatic from 'serve-static';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Server } from 'socket.io';
import { GameRoom } from './GameRoom.js';
import { TurnExecutor } from './shared/TurnExecutor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameRooms = new Map();


function handleAITurn(roomId, gameRoom, io) {
    console.log(`[Server] Handling AI turn for room ${roomId}, party ${gameRoom.gameModel.turnParty}`);
    
    // Sync party armies before AI calculations
    gameRoom.gameLogic.syncPartyArmies();
    
    const partyId = gameRoom.gameModel.turnParty;

    // Use shared TurnExecutor
    TurnExecutor.executeAITurn({
        partyId: partyId,
        gameModel: gameRoom.gameModel,
        gameLogic: gameRoom.gameLogic,
        bot: gameRoom.bot,
        onMoveExecute: (bestArmy, move) => {
            console.log(`[Server] AI executing move for army ${bestArmy.id} from (${bestArmy.field.fx},${bestArmy.field.fy}) to (${move.fx},${move.fy}) with prof ${bestArmy.profitability}`);
            
            // Execute the move
            const result = gameRoom.executeMove(bestArmy.field, move);
            
            if (result.success) {
                // Broadcast move to all clients
                io.to(roomId).emit('move_executed', {
                    success: true,
                    fromField: result.fromField,
                    toField: result.toField,
                    armyId: result.armyId,
                    events: result.events,
                    playerId: 'AI'
                });
            }
        },
        onTurnComplete: () => {
            // Spawn units for the CURRENT party (Ending Turn) BEFORE switching turns
            const currentPartyId = gameRoom.gameModel.turnParty;
            const spawnEvents = gameRoom.gameLogic.spawnUnits(currentPartyId);
            
            if (spawnEvents.length > 0) {
                io.to(roomId).emit('units_spawned', { events: spawnEvents });
            }

            // Proceed to next turn
            const turnResult = gameRoom.nextTurn();
            
            if (turnResult.gameEnded) {
                if (turnResult.reason === 'victory') {
                    io.to(roomId).emit('game_ended', { 
                        reason: 'victory', 
                        winnerPartyId: turnResult.winner 
                    });
                } else {
                    io.to(roomId).emit('game_ended', { reason: 'Turn limit reached' });
                }
            } else {
                io.to(roomId).emit('new_turn', {
                    turn: turnResult.turn,
                    turnParty: turnResult.turnParty,
                    partyName: turnResult.partyName,
                    control: turnResult.control,
                    moraleUpdates: turnResult.moraleUpdates
                });
                
                // If next turn is also AI, handle it
                if (turnResult.control === 'computer') {
                    handleAITurn(roomId, gameRoom, io);
                }
            }
        },
        getDelay: (isAnimating) => {
            // Server doesn't have animations, use fixed delay
            return 500;
        },
        checkAnimating: () => {
            // Server never has animations
            return false;
        },
        initialDelay: 1000 // Wait 1 second before starting AI moves
    });
}



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
            
            const mapData = gameRoom.getMapData();
            
            socket.emit('game_created', {
                success: true,
                roomId: roomId,
                mapSeed: mapSeed,
                partyId: result.partyId,
                playerName: result.playerName,
                gameState: gameRoom.getGameState()
            });

            socket.emit('map_data', mapData);

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
            
            const mapData = gameRoom.getMapData();
            
            socket.emit('game_joined', {
                success: true,
                roomId: roomId,
                partyId: result.partyId,
                playerName: result.playerName,
                gameState: gameRoom.getGameState()
            });

            socket.emit('map_data', mapData);

            const factionSelections = gameRoom.getFactionSelections();
            socket.emit('existing_factions', { factionSelections });

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

    socket.on('faction_selected', (data) => {
        const roomId = data.roomId;
        const partyId = data.partyId;
        const playerName = data.playerName;

        const gameRoom = gameRooms.get(roomId);
        if (gameRoom) {
            gameRoom.setFactionSelection(partyId, playerName);
            
            const player = gameRoom.players.get(socket.id);
            if (player) {
                player.partyId = partyId;
            }
        }

        console.log(`[Server] ${playerName} selected faction ${partyId} in room ${roomId}`);

        io.to(roomId).emit('faction_selected', {
            partyId: partyId,
            playerName: playerName
        });
    });

    socket.on('player_ready', (data) => {
        const roomId = data.roomId;
        const isReady = data.isReady;

        const gameRoom = gameRooms.get(roomId);
        if (gameRoom) {
            gameRoom.setPlayerReady(socket.id, isReady);
            
            const readyCount = gameRoom.getReadyCount();
            const totalPlayers = gameRoom.getTotalPlayersWithFactions();
            
            console.log(`[Server] Ready status updated in room ${roomId}: ${readyCount}/${totalPlayers}`);

            io.to(roomId).emit('ready_status_update', {
                readyCount: readyCount,
                totalPlayers: totalPlayers,
                readyStatus: gameRoom.getReadyStatus()
            });

            if (gameRoom.areAllPlayersReady()) {
                console.log(`[Server] All players ready in room ${roomId}, starting game`);
                gameRoom.startGame();
                io.to(roomId).emit('all_players_ready');
                
                const turnResult = gameRoom.nextTurn();
                
                // FIX: REMOVED spawnUnits call here. 
                // Units are now initialized in GameRoom.initializeGame().
                // Players play Turn 1 with starting units. Reinforcements come at end_turn.

                if (turnResult.gameEnded) {
                    if (turnResult.reason === 'victory') {
                        io.to(roomId).emit('game_ended', { 
                            reason: 'victory', 
                            winnerPartyId: turnResult.winner 
                        });
                    }
                } else {
                    io.to(roomId).emit('new_turn', {
                        turn: turnResult.turn,
                        turnParty: turnResult.turnParty,
                        partyName: turnResult.partyName,
                        control: turnResult.control,
                        moraleUpdates: turnResult.moraleUpdates
                    });
                    
                    // If next turn is also AI, handle it
                    if (turnResult.control === 'computer') {
                        handleAITurn(roomId, gameRoom, io);
                    }
                }
            }
        }
    });

    socket.on('move_unit', (data) => {
        const roomId = data.roomId;
        const moveData = data.moveData;

        const gameRoom = gameRooms.get(roomId);
        if (!gameRoom) {
            socket.emit('move_error', { error: 'Game room not found' });
            return;
        }

        
        const validation = gameRoom.validateMove(socket.id, moveData);
        if (!validation.valid) {
            socket.emit('move_error', { error: validation.error });
            console.log(`[Server] Move rejected for ${socket.id} in room ${roomId}: ${validation.error}`);
            return;
        }

        
        const result = gameRoom.executeMove(validation.fromField, validation.toField);
        
        if (!result.success) {
            socket.emit('move_error', { error: result.error });
            return;
        }

        console.log(`[Server] Move executed from ${socket.id} in room ${roomId}`);
        
        
        io.to(roomId).emit('move_executed', {
            success: true,
            fromField: result.fromField,
            toField: result.toField,
            armyId: result.armyId,
            events: result.events,
            playerId: socket.id
        });
    });

    socket.on('end_turn', (data) => {
        const roomId = data.roomId;

        const gameRoom = gameRooms.get(roomId);
        if (!gameRoom) {
            socket.emit('turn_error', { error: 'Game room not found' });
            return;
        }

        const player = gameRoom.players.get(socket.id);
        if (!player) {
            socket.emit('turn_error', { error: 'Player not found' });
            return;
        }

        if (gameRoom.gameModel.turnParty !== player.partyId) {
            socket.emit('turn_error', { error: 'Not your turn' });
            return;
        }

        console.log(`[Server] Player ${player.name} ended their turn in room ${roomId}`);

        // FIX: Spawn units for the CURRENT party (Ending Turn) BEFORE switching turns
        const currentPartyId = gameRoom.gameModel.turnParty;
        const spawnEvents = gameRoom.gameLogic.spawnUnits(currentPartyId);
        
        if (spawnEvents.length > 0) {
            io.to(roomId).emit('units_spawned', { events: spawnEvents });
        }
        
        const turnResult = gameRoom.nextTurn();
        
        if (turnResult.gameEnded) {
            if (turnResult.reason === 'victory') {
                io.to(roomId).emit('game_ended', { 
                    reason: 'victory', 
                    winnerPartyId: turnResult.winner 
                });
            } else {
                io.to(roomId).emit('game_ended', { reason: 'Turn limit reached' });
            }
        } else {
            io.to(roomId).emit('new_turn', {
                turn: turnResult.turn,
                turnParty: turnResult.turnParty,
                partyName: turnResult.partyName,
                control: turnResult.control,
                moraleUpdates: turnResult.moraleUpdates
            });
            
            if (turnResult.control === 'computer') {
                handleAITurn(roomId, gameRoom, io);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Server] Client disconnected: ${socket.id}`);
        
        for (const [roomId, gameRoom] of gameRooms.entries()) {
            const result = gameRoom.removePlayer(socket.id);
            if (result.removed) {
                io.to(roomId).emit('player_left', {
                    playerCount: gameRoom.getPlayerCount(),
                    partyId: result.partyId
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
