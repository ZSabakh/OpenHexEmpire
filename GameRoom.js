import { GameModel } from './shared/GameModel.js';
import { MapGenerator } from './shared/MapGenerator.js';
import { Pathfinder } from './shared/Pathfinder.js';
import { Random } from './shared/Random.js';
import { GameLogicServer } from './GameLogicServer.js';
import { Bot } from './public/game/Bot.js';

export class GameRoom {
    constructor(roomId, mapSeed) {
        this.roomId = roomId;
        this.mapSeed = mapSeed;
        this.players = new Map();
        this.factionSelections = {};
        this.readyStatus = {};
        this.gameModel = null;
        this.pathfinder = null;
        this.gameLogic = null;
        this.bot = null;
        this.maxPlayers = 4;
        this.gameStarted = false;
        
        this.initializeGame();
    }

    initializeGame() {
        this.gameModel = new GameModel();
        const random = new Random(this.mapSeed);
        this.pathfinder = new Pathfinder();
        this.bot = new Bot(this.pathfinder);
        
        const mapGenerator = new MapGenerator(this.gameModel, random, this.pathfinder);
        mapGenerator.generate();
        
        
        this.linkNeighbours();
        
        
        this.gameLogic = new GameLogicServer(this.gameModel, this.pathfinder);
        
        
        this.calcAIHelpers();
        
        console.log(`[GameRoom ${this.roomId}] Map generated with seed ${this.mapSeed}`);
    }

    linkNeighbours() {
        for (let x = 0; x < this.gameModel.width; x++) {
            for (let y = 0; y < this.gameModel.height; y++) {
                const field = this.gameModel.getField(x, y);
                if (field) {
                    this.findNeighbours(field);
                }
            }
        }
    }

    findNeighbours(field) {
        const x = field.fx;
        const y = field.fy;
        const get = (nx, ny) => this.gameModel.getField(nx, ny);

        if (x % 2 === 0) {
            field.neighbours[0] = get(x + 1, y);
            field.neighbours[1] = get(x, y + 1);
            field.neighbours[2] = get(x - 1, y);
            field.neighbours[3] = get(x - 1, y - 1);
            field.neighbours[4] = get(x, y - 1);
            field.neighbours[5] = get(x + 1, y - 1);
        } else {
            field.neighbours[0] = get(x + 1, y + 1);
            field.neighbours[1] = get(x, y + 1);
            field.neighbours[2] = get(x - 1, y + 1);
            field.neighbours[3] = get(x - 1, y);
            field.neighbours[4] = get(x, y - 1);
            field.neighbours[5] = get(x + 1, y);
        }
    }
    
    calcAIHelpers() {
        for (let p = 0; p < this.gameModel.parties.length; p++) {
            const capital = this.gameModel.parties[p].capital;
            if (!capital) continue; 
            
            for (let x = 0; x < this.gameModel.width; x++) {
                for (let y = 0; y < this.gameModel.height; y++) {
                    const field = this.gameModel.getField(x, y);
                    
                    const path = this.pathfinder.findPath(field, capital, [], true);
                    if (!path) continue;
                    field.profitability[p] = -path.length;
                    
                    const neighbours = this.pathfinder.getFurtherNeighbours(field);
                    const checkList = [...neighbours, field];
                    
                    for (const n of checkList) {
                        if (!n) continue;
                        if (n.capital === p) field.n_capital[p] = true;
                        if (n.estate === "town") field.n_town = true;
                    }
                }
            }
        }
        console.log(`[GameRoom ${this.roomId}] AI Helpers calculated`);
    }

    addPlayer(socketId, playerName) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, error: 'Room is full' };
        }

        if (this.gameStarted) {
            return { success: false, error: 'Game already started' };
        }

        this.players.set(socketId, {
            playerId: socketId,
            partyId: null,
            name: playerName || `Player ${this.players.size + 1}`
        });

        console.log(`[GameRoom ${this.roomId}] Player ${playerName} joined (faction not yet chosen)`);

        return {
            success: true,
            partyId: null,
            playerName: playerName || `Player ${this.players.size + 1}`
        };
    }

    setFactionSelection(partyId, playerName) {
        this.factionSelections[partyId] = playerName;
        
        
        if (this.gameModel.parties[partyId]) {
            this.gameModel.parties[partyId].control = "human";
            console.log(`[GameRoom ${this.roomId}] Faction ${partyId} set to human control for ${playerName}`);
        }
        
        console.log(`[GameRoom ${this.roomId}] Faction ${partyId} selected by ${playerName}`);
    }

    getFactionSelections() {
        return this.factionSelections;
    }

    setPlayerReady(socketId, isReady) {
        const player = this.players.get(socketId);
        if (player && player.partyId !== null) {
            this.readyStatus[player.partyId] = isReady;
            console.log(`[GameRoom ${this.roomId}] Player ${player.name} (faction ${player.partyId}) ready status: ${isReady}`);
            return true;
        }
        return false;
    }

    getReadyStatus() {
        return this.readyStatus;
    }

    getReadyCount() {
        return Object.values(this.readyStatus).filter(status => status === true).length;
    }

    getTotalPlayersWithFactions() {
        return Object.keys(this.factionSelections).length;
    }

    areAllPlayersReady() {
        const totalPlayers = this.getTotalPlayersWithFactions();
        const readyPlayers = this.getReadyCount();
        return totalPlayers > 0 && readyPlayers === totalPlayers;
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (player) {
            if (player.partyId !== null) {
                delete this.factionSelections[player.partyId];
                console.log(`[GameRoom ${this.roomId}] Cleared faction ${player.partyId} for leaving player`);
            }
            
            this.players.delete(socketId);
            console.log(`[GameRoom ${this.roomId}] Player ${player.name} left`);
            return { removed: true, partyId: player.partyId };
        }
        return { removed: false };
    }

    getGameState() {
        return {
            roomId: this.roomId,
            mapSeed: this.mapSeed,
            players: Array.from(this.players.values()),
            gameStarted: this.gameStarted,
            fields: this.serializeFields(),
            parties: this.serializeParties(),
            turn: this.gameModel.turn,
            turnParty: this.gameModel.turnParty
        };
    }

    serializeFields() {
        const fieldsArray = [];
        for (const key in this.gameModel.fields) {
            const field = this.gameModel.fields[key];
            fieldsArray.push({
                fx: field.fx,
                fy: field.fy,
                type: field.type,
                estate: field.estate,
                party: field.party,
                capital: field.capital,
                town_name: field.town_name,
                land_id: field.land_id
            });
        }
        return fieldsArray;
    }

    serializeParties() {
        return this.gameModel.parties.map(party => ({
            id: party.id,
            name: party.name,
            capital: party.capital ? { fx: party.capital.fx, fy: party.capital.fy } : null,
            morale: party.morale,
            status: party.status,
            totalCount: party.totalCount,
            totalPower: party.totalPower,
            control: party.control
        }));
    }

    getMapData() {
        return {
            mapSeed: this.mapSeed,
            fields: this.serializeFields(),
            parties: this.serializeParties(),
            width: this.gameModel.width,
            height: this.gameModel.height
        };
    }

    startGame() {
        if (this.players.size < 1) {
            return { success: false, error: 'Not enough players' };
        }

        this.gameStarted = true;
        this.gameModel.turn = 0;
        this.gameModel.turnParty = -1;
        
        console.log(`[GameRoom ${this.roomId}] Game started with ${this.players.size} players`);
        
        return { success: true };
    }

    nextTurn() {
        this.gameModel.turnParty++;
        if (this.gameModel.turnParty >= this.gameModel.parties.length) {
            this.gameModel.turnParty = 0;
            this.gameModel.turn++;
            console.log(`[GameRoom ${this.roomId}] Turn ${this.gameModel.turn + 1}`);

            if (this.gameModel.turn >= 150) {
                console.log(`[GameRoom ${this.roomId}] Game ended after 150 turns`);
                return { gameEnded: true };
            }
        }

        const currentParty = this.gameModel.parties[this.gameModel.turnParty];

        
        if (currentParty.status === 0) {
            return this.nextTurn();
        }

        console.log(`[GameRoom ${this.roomId}] Turn ${this.gameModel.turn + 1}, Party ${this.gameModel.turnParty} (${currentParty.name}) - ${currentParty.control}`);
        
        
        this.gameLogic.cleanupTurn(this.gameModel.turnParty);

        return {
            gameEnded: false,
            turn: this.gameModel.turn,
            turnParty: this.gameModel.turnParty,
            partyName: currentParty.name,
            control: currentParty.control
        };
    }

    validateMove(socketId, moveData) {
        const player = this.players.get(socketId);
        if (!player) {
            return { valid: false, error: 'Player not found' };
        }

        if (player.partyId === null) {
            return { valid: false, error: 'Player has not selected a faction' };
        }

        if (this.gameModel.turnParty !== player.partyId) {
            return { valid: false, error: 'Not your turn' };
        }

        
        const fromField = this.gameModel.getField(moveData.fromField.fx, moveData.fromField.fy);
        const toField = this.gameModel.getField(moveData.toField.fx, moveData.toField.fy);
        
        if (!fromField || !toField) {
            return { valid: false, error: 'Invalid field coordinates' };
        }

        if (!fromField.army) {
            return { valid: false, error: 'No army at source field' };
        }

        if (fromField.army.party !== player.partyId) {
            return { valid: false, error: 'Army does not belong to you' };
        }

        return { valid: true, fromField, toField };
    }

    executeMove(fromField, toField) {
        
        const result = this.gameLogic.executeMove(fromField, toField);
        return result;
    }

    getPlayerCount() {
        return this.players.size;
    }

    isEmpty() {
        return this.players.size === 0;
    }
}
