import { Config } from '../../shared/Config.js';
import { Game } from './Game.js';
import { SocketManager } from './SocketManager.js';

$(function(){
  const socketManager = new SocketManager();
  const game = new Game();
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  let myPartyId = null;
  let roomPlayers = {};
  let isMultiplayer = false;
  let isReady = false;
  let readyCount = 0;
  let totalPlayers = 0;

  socketManager.connect().then(() => {
    if (roomId) {
      socketManager.joinGame(roomId, 'Player');
    }
  });

  window.addEventListener('gameCreated', (e) => {
    const data = e.detail;
    isMultiplayer = true;
    updateMultiplayerUI(data.roomId);
    history.pushState({}, '', `?room=${data.roomId}`);
  });

  window.addEventListener('gameJoined', (e) => {
    const data = e.detail;
    isMultiplayer = true;
    updateMultiplayerUI(data.roomId);
  });

  window.addEventListener('mapDataReceived', (e) => {
    game.loadServerMap(e.detail).then(() => {
      if (Object.keys(roomPlayers).length > 0 && game.state) {
        game.updateMultiplayerPlayers(roomPlayers);
      }
    });
  });

  window.addEventListener('playerJoined', (e) => {
    M.toast({html: `${e.detail.playerName} joined!`, classes: 'green'});
  });

  window.addEventListener('factionSelected', (e) => {
    const { partyId, playerName } = e.detail;
    roomPlayers[partyId] = playerName;
    
    if (game.state) {
      game.updateMultiplayerPlayers(roomPlayers);
    }
    
    totalPlayers = Object.keys(roomPlayers).length;
    updateReadyStatus();
    
    console.log('Faction selected by', playerName, 'for party', partyId);
    console.log('Current room players:', roomPlayers);
  });

  window.addEventListener('existingFactions', (e) => {
    const { factionSelections } = e.detail;
    
    Object.assign(roomPlayers, factionSelections);
    
    if (game.state) {
      game.updateMultiplayerPlayers(roomPlayers);
    }
    
    console.log('Loaded existing factions:', roomPlayers);
  });

  window.addEventListener('playerLeft', (e) => {
    const { partyId } = e.detail;
    
    if (partyId !== null && partyId !== undefined) {
      delete roomPlayers[partyId];
      
      if (game.state) {
        game.updateMultiplayerPlayers(roomPlayers);
      }
      
      console.log('Player left, cleared faction', partyId);
      console.log('Current room players:', roomPlayers);
    }
  });

  function updateMultiplayerUI(roomId) {
    document.getElementById('multiplayerBar').style.display = 'block';
    document.getElementById('roomIdDisplay').textContent = roomId;
    
    const multiplayerHint = document.getElementById('multiplayerHint');
    if (multiplayerHint) {
      multiplayerHint.innerHTML = '<i class="material-icons" style="font-size: 14px; vertical-align: middle;">info</i> Click "Copy Link" button to invite friends to multiplayer!';
      multiplayerHint.style.display = 'block';
    }
  }

  document.getElementById('copyRoomUrl').onclick = () => {
    const url = window.location.origin + '?room=' + document.getElementById('roomIdDisplay').textContent;
    navigator.clipboard.writeText(url).then(() => {
      M.toast({html: 'Room URL copied!', classes: 'green'});
    });
  };

  
  M.AutoInit();

  const dynamicCanvas = document.getElementById('dynamicCanvas');
  var modalInstance = M.Modal.init(document.getElementById('countrySelectModal'));

  const countrySelectGrid = document.getElementById('countrySelectGrid');
  const factionNames = Config.COLORS.FACTION_NAMES;
  const capitalImages = Config.IMAGES.CAPITALS;
  const colors = ['#ff0000', '#ff00ff', '#00bbff', '#00ff00']; // Kept for now as Config doesn't have hex codes clearly (it has RGB strings)
  
  factionNames.forEach((name, index) => {
    const capitalItem = document.createElement('div');
    capitalItem.className = 'capital-item selectable country-select';
    capitalItem.setAttribute('data-country', index);
    
    const capitalIcon = document.createElement('img');
    capitalIcon.className = 'capital-icon';
    capitalIcon.src = `/images/${capitalImages[index]}`;
    
    const capitalInfo = document.createElement('div');
    capitalInfo.className = 'capital-info';
    
    const capitalName = document.createElement('div');
    capitalName.className = 'capital-name';
    capitalName.textContent = name;
    
    const capitalStats = document.createElement('div');
    capitalStats.className = 'capital-stats';
    capitalStats.id = `faction-${index}-player`;
    capitalStats.textContent = 'Click to select';
    
    capitalInfo.appendChild(capitalName);
    capitalInfo.appendChild(capitalStats);
    capitalItem.appendChild(capitalIcon);
    capitalItem.appendChild(capitalInfo);
    countrySelectGrid.appendChild(capitalItem);
  });

  
  modalInstance.options.onOpenStart = () => {
    factionNames.forEach((_, index) => {
      const statsEl = document.getElementById(`faction-${index}-player`);
      if (roomPlayers[index]) {
        statsEl.textContent = roomPlayers[index] + ' ✓';
        statsEl.style.color = colors[index];
        statsEl.style.fontWeight = 'bold';
      } else {
        statsEl.textContent = 'Available';
        statsEl.style.color = '#999';
        statsEl.style.fontWeight = 'normal';
      }
    });
  };

  game.generateRandomMap();

  var mapNumberInput = document.getElementById('mapNumberInput');
  var changeMapButton = document.getElementById('changeMapButton');
  changeMapButton.onclick = function() {
    var mapNumber = mapNumberInput.value.replace(/\D/g,'');
    if (mapNumber.length > 6) mapNumber = mapNumber.substring(0, 6);
    mapNumber = mapNumber ? parseInt(mapNumber, 10) : Math.floor(Math.random() * 999999);
    game.generateNewMap(mapNumber);
  };

  var randomMapButton = document.getElementById('randomMapButton');
  randomMapButton.onclick = function() {
    game.generateRandomMap();
    setTimeout(() => mapNumberInput.value = game.mapNumber, 100);
  };

  var topBarStartBattle = document.getElementById('topBarStartBattle');
  topBarStartBattle.disabled = true;
  
  const multiplayerHint = document.createElement('div');
  multiplayerHint.id = 'multiplayerHint';
  multiplayerHint.style.cssText = 'text-align: center; color: #aaa; font-size: 12px; margin-top: 10px; padding: 10px; background: rgba(33, 150, 243, 0.1); border-radius: 4px;';
  multiplayerHint.innerHTML = '<i class="material-icons" style="font-size: 14px; vertical-align: middle;">info</i> Click "Start Battle" to create a multiplayer room and share the URL with friends!';
  document.querySelector('.container .section .row .col').insertBefore(multiplayerHint, document.getElementById('multiplayerBar'));
  
  topBarStartBattle.onclick = function() {
    if (multiplayerHint) multiplayerHint.style.display = 'none';
    
    if (!roomId && !isMultiplayer) {
      socketManager.createGame(game.mapNumber, 'Player');
      return; 
    }
    modalInstance.open();
  };
  
  window.addEventListener('gameCreated', () => {
    setTimeout(() => modalInstance.open(), 500);
  });

  $('.country-select').click(function() {
    var country = $(this).data('country');
    
    
    if (isMultiplayer && roomPlayers[country]) {
      M.toast({html: factionNames[country] + ' is already taken!', classes: 'orange'});
      return;
    }
    
    modalInstance.close();
    
    mapNumberInput.value = game.mapNumber;
    mapNumberInput.disabled = true;
    changeMapButton.disabled = true;
    randomMapButton.disabled = true;
    topBarStartBattle.style.display = 'none';

    if (isMultiplayer) {
      const currentRoomId = socketManager.getRoomId();
      roomPlayers[country] = 'Player';
      myPartyId = country;
      
      socketManager.selectFaction(currentRoomId, country, 'Player');
      
      if (game.state) {
        game.updateMultiplayerPlayers(roomPlayers);
      }
    }

    game.setHumanPlayer(parseInt(country));
    
    if (isMultiplayer) {
      showReadyButton();
      game.waitingForReady = true;
    } else {
      game.startBattle();
    }
  });

  window.addEventListener('readyStatusUpdate', (e) => {
    const { readyCount: newReadyCount, totalPlayers: newTotalPlayers, readyStatus } = e.detail;
    readyCount = newReadyCount;
    totalPlayers = newTotalPlayers;
    
    updateReadyStatus();
    console.log(`Ready status: ${readyCount}/${totalPlayers}`, readyStatus);
  });

  window.addEventListener('allPlayersReady', () => {
    console.log('All players ready, starting battle!');
    hideReadyButton();
    game.waitingForReady = false;
    game.battleStarted = true;
    
    
    const currentRoomId = socketManager.getRoomId();
    game.setMultiplayerMode(socketManager, currentRoomId);
    
    
  });

  window.addEventListener('newTurn', (e) => {
    const turnData = e.detail;
    console.log('New turn event received:', turnData);
    game.handleNewTurn(turnData);
  });

  window.addEventListener('moveExecuted', (e) => {
    const moveData = e.detail;
    console.log('Move executed event received:', moveData);
    game.handleMoveExecuted(moveData);
  });

  window.addEventListener('unitsSpawned', (e) => {
    const data = e.detail;
    console.log('Units spawned event received:', data);
    game.handleUnitsSpawned(data);
  });


  window.addEventListener('moveError', (e) => {
    const { error } = e.detail;
    M.toast({html: `Move error: ${error}`, classes: 'red'});
    game.handleMoveError(error);
  });

  window.addEventListener('turnError', (e) => {
    const { error } = e.detail;
    M.toast({html: `Turn error: ${error}`, classes: 'red'});
  });

  window.addEventListener('gameEnded', (e) => {
    const { reason, winnerPartyId } = e.detail;
    
    // If I am the winner
    if (reason === 'victory' && winnerPartyId === game.state.humanPlayerId) {
        game.showGameEndModal('victory');
    } 
    // If someone else won (Spectator Victory)
    else if (reason === 'victory') {
        const winnerName = game.state.parties[winnerPartyId].name;
        game.showGameEndModal('spectator_victory', winnerName);
    }
    else {
        M.toast({html: `Game ended: ${reason}`, classes: 'orange'});
    }
  });

  function showReadyButton() {
    totalPlayers = Object.keys(roomPlayers).length;
    
    let readyContainer = document.getElementById('readyContainer');
    if (!readyContainer) {
      readyContainer = document.createElement('div');
      readyContainer.id = 'readyContainer';
      readyContainer.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000; text-align: center; background: rgba(0,0,0,0.9); padding: 30px; border-radius: 10px; border: 2px solid #2196F3;';
      
      const readyStatus = document.createElement('div');
      readyStatus.id = 'readyStatusText';
      readyStatus.style.cssText = 'color: white; font-size: 24px; margin-bottom: 20px; font-weight: bold;';
      readyStatus.textContent = `READY 0/${totalPlayers}`;
      
      const readyButton = document.createElement('button');
      readyButton.id = 'readyButton';
      readyButton.className = 'game-control-btn start-battle';
      readyButton.style.cssText = 'width: 200px; padding: 15px; font-size: 18px;';
      readyButton.innerHTML = '<i class="material-icons" style="vertical-align: middle; margin-right: 8px;">check_circle</i>READY';
      
      readyButton.onclick = toggleReady;
      
      readyContainer.appendChild(readyStatus);
      readyContainer.appendChild(readyButton);
      document.body.appendChild(readyContainer);
    }
    
    readyContainer.style.display = 'block';
    updateReadyStatus();
  }

  function hideReadyButton() {
    const readyContainer = document.getElementById('readyContainer');
    if (readyContainer) {
      readyContainer.style.display = 'none';
    }
  }

  function toggleReady() {
    isReady = !isReady;
    const currentRoomId = socketManager.getRoomId();
    socketManager.setReady(currentRoomId, isReady);
    
    const readyButton = document.getElementById('readyButton');
    if (isReady) {
      readyButton.style.background = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
      readyButton.innerHTML = '<i class="material-icons" style="vertical-align: middle; margin-right: 8px;">check_circle</i>READY ✓';
    } else {
      readyButton.style.background = '';
      readyButton.innerHTML = '<i class="material-icons" style="vertical-align: middle; margin-right: 8px;">check_circle</i>READY';
    }
  }

  function updateReadyStatus() {
    const readyStatusText = document.getElementById('readyStatusText');
    if (readyStatusText) {
      readyStatusText.textContent = `READY ${readyCount}/${totalPlayers}`;
    }
  }

  window.addEventListener('resize', () => game.drawGame());
  dynamicCanvas.addEventListener('mousedown', (e) => game.handleInput(e));
  dynamicCanvas.addEventListener('mousemove', (e) => game.handleMouseMove(e));
});