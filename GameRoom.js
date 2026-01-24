import { GameModel } from './shared/GameModel.js';
import { MapGenerator } from './shared/MapGenerator.js';
import { Pathfinder } from './shared/Pathfinder.js';
import { Random } from './shared/Random.js';

export class GameRoom {
    constructor(roomId, mapSeed) {
        this.roomId = roomId;
        this.mapSeed = mapSeed;
        this.players = new Map();
        this.gameModel = null;
        this.maxPlayers = 4;
        this.gameStarted = false;
        
        this.initializeGame();
    }

    initializeGame() {
        this.gameModel = new GameModel();
        const random = new Random(this.mapSeed);
        const pathfinder = new Pathfinder();
        
        const mapGenerator = new MapGenerator(this.gameModel, random, pathfinder);
        mapGenerator.generate();
        
        console.log(`[GameRoom ${this.roomId}] Map generated with seed ${this.mapSeed}`);
    }

    addPlayer(socketId, playerName) {
        if (this.players.size >= this.maxPlayers) {
            return { success: false, error: 'Room is full' };
        }

        if (this.gameStarted) {
            return { success: false, error: 'Game already started' };
        }

        // Assign next available party
        const partyId = this.players.size;
        
        this.players.set(socketId, {
            playerId: socketId,
            partyId: partyId,
            name: playerName || `Player ${partyId + 1}`
        });

        console.log(`[GameRoom ${this.roomId}] Player ${playerName} joined as party ${partyId}`);

        return {
            success: true,
            partyId: partyId,
            playerName: playerName || `Player ${partyId + 1}`
        };
    }

    removePlayer(socketId) {
        const player = this.players.get(socketId);
        if (player) {
            this.players.delete(socketId);
            console.log(`[GameRoom ${this.roomId}] Player ${player.name} left`);
            return true;
        }
        return false;
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

    startGame() {
        if (this.players.size < 1) {
            return { success: false, error: 'Not enough players' };
        }

        this.gameStarted = true;
        console.log(`[GameRoom ${this.roomId}] Game started with ${this.players.size} players`);
        
        return { success: true };
    }

    getPlayerCount() {
        return this.players.size;
    }

    isEmpty() {
        return this.players.size === 0;
    }
}