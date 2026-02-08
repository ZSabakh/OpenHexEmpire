import { GameModel } from './shared/GameModel.js';
import { MapGenerator } from './shared/MapGenerator.js';
import { Pathfinder } from './shared/Pathfinder.js';
import { Random } from './shared/Random.js';
import { GameEngine } from './shared/GameEngine.js';
import { Bot } from './shared/Bot.js';

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
        
        // Initialize server-side game logic using shared GameEngine
        this.gameLogic = new GameEngine(this.gameModel, this.pathfinder);
        
        // Calculate AI Helpers (Profitability, etc.)
        this.calcAIHelpers();
        
        this.initUnits();
        
        console.log(`[GameRoom ${this.roomId}] Map generated with seed ${this.mapSeed}`);
    }

    // Helper to spawn initial units for all factions
    initUnits() {
        for (const party of this.gameModel.parties) {
            this.gameLogic.spawnUnits(party.id);
            this.gameLogic.syncPartyArmies();
        }
    }
    
    calcAIHelpers() {
        for (let p = 0; p < this.gameModel.parties.length; p++) {
            const capital = this.gameModel.parties[p].capital;
            if (!capital) continue; // Should not happen if map generated correctly
            
            for (let x = 0; x < this.gameModel.width; x++) {
                for (let y = 0; y < this.gameModel.height; y++) {
                    const field = this.gameModel.getField(x, y);
                    // Use this.pathfinder
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
        
        // Mark this party as human-controlled in the game model
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
                delete this.readyStatus[player.partyId];
                
                // If game has started, convert the faction to AI control
                if (this.gameStarted && this.gameModel.parties[player.partyId]) {
                    this.gameModel.parties[player.partyId].control = "computer";
                    console.log(`[GameRoom ${this.roomId}] Converted faction ${player.partyId} (${this.gameModel.parties[player.partyId].name}) to AI control`);
                } else {
                    console.log(`[GameRoom ${this.roomId}] Cleared faction ${player.partyId} for leaving player`);
                }
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
            dynamicState: this.serializeDynamicState(),
            parties: this.serializeParties(),
            turn: this.gameModel.turn,
            turnParty: this.gameModel.turnParty
        };
    }

    serializeDynamicState() {
        // Only send dynamic state: ownership and armies
        // Client generates static map (terrain, estates) from seed
        const dynamicFields = [];
        for (const key in this.gameModel.fields) {
            const field = this.gameModel.fields[key];
            
            // Only include fields with dynamic state (ownership or armies)
            if (field.party !== -1 || field.army) {
                const fieldData = {
                    fx: field.fx,
                    fy: field.fy,
                    party: field.party
                };
                
                // Include army data if present
                if (field.army) {
                    fieldData.army = {
                        id: field.army.id,
                        party: field.army.party,
                        count: field.army.count,
                        morale: field.army.morale,
                        moved: field.army.moved
                    };
                }
                
                dynamicFields.push(fieldData);
            }
        }
        return dynamicFields;
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
        // Only send the seed - client will generate the map locally
        return {
            mapSeed: this.mapSeed,
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
        const activeParties = this.gameModel.parties.filter(p => p.status > 0);
        
        // Condition A: Only 1 party left (Total Domination)
        if (activeParties.length === 1 && this.players.size > 0) {
            console.log(`[GameRoom ${this.roomId}] Game Won by ${activeParties[0].name}`);
            return { 
                gameEnded: true, 
                reason: 'victory', 
                winner: activeParties[0].id 
            };
        }

        this.gameModel.turnParty++;
        if (this.gameModel.turnParty >= this.gameModel.parties.length) {
            this.gameModel.turnParty = 0;
            this.gameModel.turn++;
            console.log(`[GameRoom ${this.roomId}] Turn ${this.gameModel.turn + 1}`);

            if (this.gameModel.turn >= 150) {
                console.log(`[GameRoom ${this.roomId}] Game ended after 150 turns`);
                return { gameEnded: true, reason: 'turn_limit' };
            }
        }

        const currentParty = this.gameModel.parties[this.gameModel.turnParty];

        // Skip eliminated parties
        if (currentParty.status === 0) {
            return this.nextTurn();
        }

        console.log(`[GameRoom ${this.roomId}] Turn ${this.gameModel.turn + 1}, Party ${this.gameModel.turnParty} (${currentParty.name}) - ${currentParty.control}`);
        
        // Cleanup turn for the current party (reset movement, decay morale)
        const cleanupUpdates = this.gameLogic.cleanupTurn(this.gameModel.turnParty);

        return {
            gameEnded: false,
            turn: this.gameModel.turn,
            turnParty: this.gameModel.turnParty,
            partyName: currentParty.name,
            control: currentParty.control,
            moraleUpdates: cleanupUpdates
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

        // Check if the fields exist
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

        if (fromField.army.moved) {
            return { valid: false, error: 'Army has already moved' };
        }

        return { valid: true, fromField, toField };
    }

    executeMove(fromField, toField) {
        const result = this.gameLogic.executeMove(fromField, toField);
        
        const statusEvents = this.gameLogic.updatePartyStatuses();
        
        if (statusEvents && statusEvents.length > 0) {
            result.events.push(...statusEvents);
        }
        
        this.gameLogic.syncPartyArmies();
        
        return result;
    }

    getPlayerCount() {
        return this.players.size;
    }

    isEmpty() {
        return this.players.size === 0;
    }
}
