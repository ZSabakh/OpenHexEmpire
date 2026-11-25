import http from "http";
import { randomUUID } from "node:crypto";
import express from "express";
import serveStatic from "serve-static";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { Server } from "socket.io";
import { GameRoom } from "./GameRoom.js";
import { TurnExecutor } from "./shared/TurnExecutor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameRooms = new Map();
const socketToRoom = new Map();

// Input sanitization helpers
function sanitizeString(str, maxLen = 30) {
  if (typeof str !== "string") return "";
  return str
    .replace(/[<>&"'/]/g, "")
    .trim()
    .substring(0, maxLen);
}

function sanitizeRoomId(id) {
  if (typeof id !== "string") return "";
  return id.replace(/[^a-zA-Z0-9_\-]/g, "").substring(0, 50);
}

// Simple per-socket rate limiter
const rateLimits = new Map();
function rateLimit(socketId, event, maxPerSec = 5) {
  const key = `${socketId}:${event}`;
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.start > 1000) {
    rateLimits.set(key, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > maxPerSec) return true;
  return false;
}

// Max concurrent rooms
const MAX_ROOMS = 100;

const RECONNECT_GRACE_MS = 90_000;

function deleteRoom(room) {
  room.cancelAITurn?.();
  for (const timer of room.reconnectTimers.values()) clearTimeout(timer);
  clearTimeout(room.outcomeTimer);
  gameRooms.delete(room.roomId);
}

function finishGame(room, outcome) {
  if (room.outcome) return;
  room.outcome = outcome;
  room.cancelAITurn?.();
  room.aiTurnInProgress = false;
  io.to(room.roomId).emit("game_ended", outcome);
  room.outcomeTimer = setTimeout(() => deleteRoom(room), RECONNECT_GRACE_MS);
}

function publishMove(room, result, playerId) {
  room.touchActivity();
  room.movesUsedThisTurn++;
  const victory = room.checkVictory();
  io.to(room.roomId).emit("move_executed", { ...result, playerId, outcome: victory });
  if (victory) finishGame(room, victory);
}

function advanceTurn(room) {
  const turn = room.nextTurn();
  if (turn.gameEnded) {
    finishGame(room, { reason: "Turn limit reached" });
    return;
  }
  room.gameLogic.syncPartyArmies();
  io.to(room.roomId).emit("new_turn", {
    ...turn,
    stateHash: room.gameLogic.computeStateHash(),
  });
  resumeRoom(room);
}

function finishTurn(room) {
  const events = room.gameLogic.spawnUnits(room.gameModel.turnParty);
  if (events.length) io.to(room.roomId).emit("units_spawned", { events });
  advanceTurn(room);
}

function resumeRoom(room) {
  // An AI turn already in flight can finish. Pause before starting another
  // when every human is temporarily disconnected.
  if (!room.gameStarted || room.outcome || room.aiTurnInProgress ||
      room.players.size === room.reconnectTimers.size) return;

  const partyId = room.gameModel.turnParty;
  if (room.gameModel.parties[partyId]?.control !== "computer") return;

  room.aiTurnInProgress = true;
  room.gameLogic.syncPartyArmies();
  room.cancelAITurn = TurnExecutor.executeAITurn({
    partyId,
    gameModel: room.gameModel,
    bot: room.bot,
    moveBudget: room.maxMovesThisTurn - room.movesUsedThisTurn,
    onMoveExecute: (army, move) => {
      const result = room.executeMove(army.field, move);
      if (result.success) publishMove(room, result, partyId);
    },
    onTurnComplete: () => {
      room.cancelAITurn = null;
      room.aiTurnInProgress = false;
      finishTurn(room);
    },
    getDelay: () => 500,
  });
}

function startWhenReady(room) {
  if (!room.areAllPlayersReady()) return;
  room.startGame();
  io.to(room.roomId).emit("all_players_ready");
  advanceTurn(room);
}

function releaseSeat(room, socketId) {
  clearTimeout(room.reconnectTimers.get(socketId));
  room.reconnectTimers.delete(socketId);
  const result = room.removePlayer(socketId);
  if (!result.removed) return;

  io.to(room.roomId).emit("player_left", {
    playerCount: room.getPlayerCount(),
    partyId: result.partyId,
  });
  if (room.isEmpty()) deleteRoom(room);
  else {
    startWhenReady(room);
    resumeRoom(room);
  }
}

function restoreSeat(room, socket, token) {
  if (typeof token !== "string") return null;
  const seat = [...room.players.entries()].find(([, player]) => player.reconnectToken === token);
  if (!seat || !room.reconnectTimers.has(seat[0])) return null;

  const [oldId, player] = seat;
  clearTimeout(room.reconnectTimers.get(oldId));
  room.reconnectTimers.delete(oldId);
  room.players.delete(oldId);
  player.playerId = socket.id;
  room.players.set(socket.id, player);
  if (player.partyId !== null) room.factionSelections[player.partyId].socketId = socket.id;
  return { success: true, partyId: player.partyId, playerName: player.name };
}

app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/views");
app.set("view engine", "ejs");

app.use(serveStatic(__dirname + "/public"));

app.use("/shared", serveStatic(__dirname + "/shared"));

const homepage = function (req, res) {
  res.render("index", {});
};

app.get("/", homepage);

io.on("connection", (socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  socket.emit("connected", {
    message: "Connected to Server",
    socketId: socket.id,
  });

  socket.on("create_game", (data) => {
    if (rateLimit(socket.id, "create_game", 2)) return;

    if (gameRooms.size >= MAX_ROOMS) {
      socket.emit("game_created", { success: false, error: "Server is full" });
      return;
    }

    if (socketToRoom.has(socket.id)) return;
    const roomId = `room_${randomUUID()}`;
    const mapSeed = Number.isFinite(data.mapSeed)
      ? data.mapSeed
      : Math.floor(Math.random() * 999999);
    const playerName = sanitizeString(data.playerName) || "Player";

    const gameRoom = new GameRoom(roomId, mapSeed);
    gameRooms.set(roomId, gameRoom);

    const result = gameRoom.addPlayer(socket.id, playerName);

    if (result.success) {
      socket.join(roomId);

      const reconnectToken = randomUUID();
      gameRoom.players.get(socket.id).reconnectToken = reconnectToken;
      const mapData = gameRoom.getMapData();

      socket.emit("game_created", {
        reconnectToken,
        success: true,
        roomId: roomId,
        mapSeed: mapSeed,
        partyId: result.partyId,
        playerName: result.playerName,
        gameState: gameRoom.getGameState(),
      });

      socket.emit("map_data", mapData);

      socketToRoom.set(socket.id, roomId);
      console.log(`[Server] Game room ${roomId} created by ${playerName}`);
    } else {
      socket.emit("game_created", {
        success: false,
        error: result.error,
      });
    }
  });

  socket.on("join_game", (data) => {
    if (rateLimit(socket.id, "join_game", 2)) return;

    const roomId = sanitizeRoomId(data.roomId);
    const playerName = sanitizeString(data.playerName) || "Player";

    const gameRoom = gameRooms.get(roomId);

    if (!gameRoom) {
      socket.emit("game_joined", {
        success: false,
        error: "Game room not found",
      });
      return;
    }

    if (socketToRoom.has(socket.id)) return;
    const restored = restoreSeat(gameRoom, socket, data.reconnectToken);
    const result = restored ?? gameRoom.addPlayer(socket.id, playerName);
    if (!result.success) {
      socket.emit("game_joined", { success: false, error: result.error });
      return;
    }

    const player = gameRoom.players.get(socket.id);
    player.reconnectToken ??= randomUUID();
    socket.join(roomId);
    socketToRoom.set(socket.id, roomId);
    gameRoom.touchActivity();

    socket.emit("game_joined", {
      ...result,
      roomId,
      reconnectToken: player.reconnectToken,
      resumed: Boolean(restored),
      gameState: gameRoom.getGameState(),
    });
    if (!restored) {
      socket.emit("map_data", gameRoom.getMapData());
      socket.to(roomId).emit("player_joined", {
        playerName: player.name,
        partyId: player.partyId,
        playerCount: gameRoom.getPlayerCount(),
      });
    }
    socket.emit("existing_factions", { factionSelections: gameRoom.getFactionSelections() });
    startWhenReady(gameRoom);
    resumeRoom(gameRoom);
  });

  socket.on("faction_selected", (data) => {
    try {
      if (rateLimit(socket.id, "faction_selected", 3)) return;

      const roomId = sanitizeRoomId(data.roomId);
      const partyId = parseInt(data.partyId, 10);
      const playerName = sanitizeString(data.playerName) || "Player";
      if (isNaN(partyId) || partyId < 0 || partyId > 3) return;

      const gameRoom = gameRooms.get(roomId);
      if (!gameRoom || socketToRoom.get(socket.id) !== roomId) return;

      const result = gameRoom.setFactionSelection(
        partyId,
        playerName,
        socket.id,
      );
      if (!result.success) {
        socket.emit("faction_error", { error: result.error });
        return;
      }

      const player = gameRoom.players.get(socket.id);
      if (player) {
        player.partyId = partyId;
      }

      console.log(
        `[Server] ${playerName} selected faction ${partyId} in room ${roomId}`,
      );

      io.to(roomId).emit("faction_selected", {
        partyId: partyId,
        playerName: playerName,
      });
    } catch (err) {
      console.error(`[Server] Error in faction_selected:`, err.message);
    }
  });

  socket.on("player_ready", (data) => {
    const roomId = data.roomId;
    const isReady = data.isReady;

    const gameRoom = gameRooms.get(roomId);
    if (gameRoom && gameRoom.setPlayerReady(socket.id, isReady === true)) {

      const readyCount = gameRoom.getReadyCount();
      const totalPlayers = gameRoom.getTotalPlayersWithFactions();

      console.log(
        `[Server] Ready status updated in room ${roomId}: ${readyCount}/${totalPlayers}`,
      );

      io.to(roomId).emit("ready_status_update", {
        readyCount: readyCount,
        totalPlayers: totalPlayers,
        readyStatus: gameRoom.getReadyStatus(),
      });

      startWhenReady(gameRoom);
    }
  });

  socket.on("move_unit", (data) => {
    try {
      if (rateLimit(socket.id, "move_unit", 10)) {
        socket.emit("move_error", { error: "Rate limited" });
        return;
      }

      const roomId = sanitizeRoomId(data.roomId);
      const moveData = data.moveData;

      // Validate moveData coordinates
      if (
        !moveData ||
        !moveData.fromField ||
        !moveData.toField ||
        !Number.isFinite(moveData.fromField.fx) ||
        !Number.isFinite(moveData.fromField.fy) ||
        !Number.isFinite(moveData.toField.fx) ||
        !Number.isFinite(moveData.toField.fy)
      ) {
        socket.emit("move_error", { error: "Invalid move data" });
        return;
      }

      const gameRoom = gameRooms.get(roomId);
      if (!gameRoom) {
        socket.emit("move_error", { error: "Game room not found" });
        return;
      }

      if (!gameRoom.gameStarted || gameRoom.outcome) return;

      // Block moves during AI turns
      if (gameRoom.aiTurnInProgress) {
        socket.emit("move_error", { error: "AI turn in progress" });
        return;
      }

      const validation = gameRoom.validateMove(socket.id, moveData);
      if (!validation.valid) {
        socket.emit("move_error", { error: validation.error });
        console.log(
          `[Server] Move rejected for ${socket.id} in room ${roomId}: ${validation.error}`,
        );
        return;
      }

      const result = gameRoom.executeMove(
        validation.fromField,
        validation.toField,
      );

      if (!result.success) {
        socket.emit("move_error", { error: result.error });
        return;
      }

      publishMove(gameRoom, result, gameRoom.players.get(socket.id).partyId);
    } catch (err) {
      console.error(`[Server] Error in move_unit:`, err.message);
      socket.emit("move_error", { error: "Server error processing move" });
    }
  });

  socket.on("end_turn", (data) => {
    let gameRoom = null;
    try {
      if (rateLimit(socket.id, "end_turn", 2)) return;

      const roomId = sanitizeRoomId(data.roomId);

      gameRoom = gameRooms.get(roomId);
      if (!gameRoom) {
        socket.emit("turn_error", { error: "Game room not found" });
        return;
      }

      if (!gameRoom.gameStarted || gameRoom.outcome) return;

      // Block end_turn during AI turns
      if (gameRoom.aiTurnInProgress) {
        socket.emit("turn_error", { error: "AI turn in progress" });
        return;
      }

      // Prevent double end_turn processing (race condition guard)
      if (gameRoom.turnEndInProgress) {
        console.warn(`[Server] Duplicate end_turn blocked for room ${roomId}`);
        return;
      }

      const player = gameRoom.players.get(socket.id);
      if (!player) {
        socket.emit("turn_error", { error: "Player not found" });
        return;
      }

      if (gameRoom.gameModel.turnParty !== player.partyId) {
        socket.emit("turn_error", { error: "Not your turn" });
        return;
      }

      gameRoom.turnEndInProgress = true;
      console.log(
        `[Server] Player ${player.name} ended their turn in room ${roomId}`,
      );

      gameRoom.touchActivity();
      finishTurn(gameRoom);
      gameRoom.turnEndInProgress = false;
    } catch (err) {
      console.error(`[Server] Error in end_turn:`, err.message);
      if (gameRoom) gameRoom.turnEndInProgress = false;
      socket.emit("turn_error", { error: "Server error processing turn" });
    }
  });

  socket.on("request_resync", (data) => {
    try {
      const roomId = data.roomId;
      const gameRoom = gameRooms.get(roomId);
      if (!gameRoom) {
        socket.emit("resync_error", { error: "Game room not found" });
        return;
      }

      console.log(
        `[Server] Resync requested by ${socket.id} for room ${roomId}`,
      );

      if (socketToRoom.get(socket.id) !== roomId) return;

      // Send full game state to the requesting client
      socket.emit("full_resync", gameRoom.getGameState());
    } catch (err) {
      console.error(`[Server] Error in request_resync:`, err.message);
      socket.emit("resync_error", { error: "Server error during resync" });
    }
  });

  socket.on("leave_game", (acknowledge) => {
    const room = gameRooms.get(socketToRoom.get(socket.id));
    socketToRoom.delete(socket.id);
    if (room) {
      socket.leave(room.roomId);
      releaseSeat(room, socket.id);
    }
    if (typeof acknowledge === "function") acknowledge();
  });

  socket.on("disconnect", (reason) => {
    console.log(`[Server] Client disconnected: ${socket.id} (${reason})`);
    const room = gameRooms.get(socketToRoom.get(socket.id));
    socketToRoom.delete(socket.id);
    if (room?.players.has(socket.id)) {
      room.touchActivity();
      room.reconnectTimers.set(socket.id, setTimeout(() => {
        releaseSeat(room, socket.id);
      }, RECONNECT_GRACE_MS));
    }

    rateLimits.forEach((_, key) => {
      if (key.startsWith(socket.id)) rateLimits.delete(key);
    });
  });
});

// Periodic cleanup of inactive game rooms (every 5 minutes)
setInterval(
  () => {
    for (const [roomId, gameRoom] of gameRooms.entries()) {
      if (gameRoom.isInactive()) {
        console.log(
          `[Server] Room ${roomId} cleaned up due to inactivity (${Math.round(gameRoom.inactivityTimeout / 60000)} min timeout)`,
        );
        deleteRoom(gameRoom);
      }
    }
  },
  5 * 60 * 1000,
);

server.listen(app.get('port'), "0.0.0.0", function(){
    console.log('OpenHexEmpire is listening on port ' + app.get('port'));
});
