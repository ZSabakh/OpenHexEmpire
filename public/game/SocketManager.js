export class SocketManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.roomId = null;
        this.partyId = null;
        this.playerName = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = io();

            this.socket.on('connected', (data) => {
                console.log('Connected to Server:', data.message);
                console.log('Socket ID:', data.socketId);
                this.connected = true;
                resolve(data);
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                reject(error);
            });

            // Set up other event listeners
            this.setupEventListeners();
        });
    }

    setupEventListeners() {
        this.socket.on('game_created', (data) => {
            console.log('Game created:', data);
            if (data.success) {
                this.roomId = data.roomId;
                this.partyId = data.partyId;
                this.playerName = data.playerName;
                
                // Dispatch custom event for the game to handle
                window.dispatchEvent(new CustomEvent('gameCreated', { detail: data }));
            } else {
                console.error('Failed to create game:', data.error);
            }
        });

        this.socket.on('game_joined', (data) => {
            console.log('Game joined:', data);
            if (data.success) {
                this.roomId = data.roomId;
                this.partyId = data.partyId;
                this.playerName = data.playerName;
                
                // Dispatch custom event for the game to handle
                window.dispatchEvent(new CustomEvent('gameJoined', { detail: data }));
            } else {
                console.error('Failed to join game:', data.error);
            }
        });

        this.socket.on('map_data', (data) => {
            console.log('Map data received:', data);
            window.dispatchEvent(new CustomEvent('mapDataReceived', { detail: data }));
        });

        this.socket.on('player_joined', (data) => {
            console.log('Player joined:', data);
            window.dispatchEvent(new CustomEvent('playerJoined', { detail: data }));
        });

        this.socket.on('player_left', (data) => {
            console.log('Player left:', data);
            window.dispatchEvent(new CustomEvent('playerLeft', { detail: data }));
        });

        this.socket.on('faction_selected', (data) => {
            console.log('Faction selected:', data);
            window.dispatchEvent(new CustomEvent('factionSelected', { detail: data }));
        });

        this.socket.on('existing_factions', (data) => {
            console.log('Existing factions received:', data);
            window.dispatchEvent(new CustomEvent('existingFactions', { detail: data }));
        });

        this.socket.on('ready_status_update', (data) => {
            console.log('Ready status update:', data);
            window.dispatchEvent(new CustomEvent('readyStatusUpdate', { detail: data }));
        });

        this.socket.on('all_players_ready', () => {
            console.log('All players ready, starting game');
            window.dispatchEvent(new CustomEvent('allPlayersReady'));
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.connected = false;
        });
    }

    createGame(mapSeed, playerName = 'Player') {
        if (!this.connected) {
            console.error('Not connected to server');
            return;
        }

        this.socket.emit('create_game', {
            mapSeed: mapSeed,
            playerName: playerName
        });
    }

    joinGame(roomId, playerName = 'Player') {
        if (!this.connected) {
            console.error('Not connected to server');
            return;
        }

        this.socket.emit('join_game', {
            roomId: roomId,
            playerName: playerName
        });
    }

    isConnected() {
        return this.connected;
    }

    getRoomId() {
        return this.roomId;
    }

    getPartyId() {
        return this.partyId;
    }

    getPlayerName() {
        return this.playerName;
    }

    selectFaction(roomId, partyId, playerName) {
        if (!this.connected) {
            console.error('Not connected to server');
            return;
        }

        this.socket.emit('faction_selected', {
            roomId: roomId,
            partyId: partyId,
            playerName: playerName
        });
    }

    setReady(roomId, isReady) {
        if (!this.connected) {
            console.error('Not connected to server');
            return;
        }

        this.socket.emit('player_ready', {
            roomId: roomId,
            isReady: isReady
        });
    }
}
