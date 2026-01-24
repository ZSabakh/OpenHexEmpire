import { Game } from './Game.js';
import { SocketManager } from './SocketManager.js';

$(function(){
  // Initialize Socket.io connection
  const socketManager = new SocketManager();
  
  socketManager.connect().then((data) => {
    console.log('Socket connection established');
    
    // For testing: automatically create a game room
    // Soon this would be triggered by user action
    const testMapSeed = Math.floor(Math.random() * 999999);
    socketManager.createGame(testMapSeed, 'Player 1');
  }).catch((error) => {
    console.error('Failed to connect to server:', error);
  });

  window.addEventListener('gameCreated', (event) => {
    console.log('Game created event received:', event.detail);
  });

  window.addEventListener('gameJoined', (event) => {
    console.log('Game joined event received:', event.detail);
  });

  window.addEventListener('playerJoined', (event) => {
    console.log('Player joined event received:', event.detail);
  });

  window.addEventListener('playerLeft', (event) => {
    console.log('Player left event received:', event.detail);
  });

  // Initialize Materialize
  M.AutoInit();

  const dynamicCanvas = document.getElementById('dynamicCanvas');
  
  // Fixed canvas size for HiDPI support (handled in index.ejs and CSS)
  // Both canvases are styled in the HTML

  // Initialize modal explicitly
  var modalElem = document.getElementById('countrySelectModal');
  var modalInstance = M.Modal.init(modalElem);

  // Populate country selection modal
  const countrySelectGrid = document.getElementById('countrySelectGrid');
  const factionNames = ["Redosia", "Violetnam", "Bluegaria", "Greenland"];
  const capitalImages = ["capital_red.png", "capital_violet.png", "capital_blue.png", "capital_green.png"];
  
  factionNames.forEach((name, index) => {
    const capitalItem = document.createElement('div');
    capitalItem.className = 'capital-item selectable country-select';
    capitalItem.setAttribute('data-country', index);
    
    const capitalIcon = document.createElement('img');
    capitalIcon.className = 'capital-icon';
    capitalIcon.src = `/images/${capitalImages[index]}`;
    capitalIcon.alt = name;
    
    const capitalInfo = document.createElement('div');
    capitalInfo.className = 'capital-info';
    
    const capitalName = document.createElement('div');
    capitalName.className = 'capital-name';
    capitalName.textContent = name;
    
    const capitalStats = document.createElement('div');
    capitalStats.className = 'capital-stats';
    capitalStats.textContent = 'Click to select';
    
    capitalInfo.appendChild(capitalName);
    capitalInfo.appendChild(capitalStats);
    capitalItem.appendChild(capitalIcon);
    capitalItem.appendChild(capitalInfo);
    countrySelectGrid.appendChild(capitalItem);
  });

  const game = new Game();
  game.generateRandomMap();

  var mapNumberInput = document.getElementById('mapNumberInput');
  var changeMapButton = document.getElementById('changeMapButton');
  changeMapButton.onclick = function() {
    var mapNumber = mapNumberInput.value;
    // remove all non-digits
    mapNumber = mapNumber.replace(/\D/g,'');
    if (mapNumber.length > 6) {
      mapNumber = mapNumber.substring(0, 6);
    }
    if (mapNumber == "") {
      mapNumber = Math.floor(Math.random() * 999999);
    } else {
      // convert to integer, since map number is expected as an integer
      mapNumber = parseInt(mapNumber, 10);
    }

    game.generateNewMap(mapNumber);
  };

  var randomMapButton = document.getElementById('randomMapButton');
  randomMapButton.onclick = function() {
    game.generateRandomMap();
    // Update the input field with the new random map number
    setTimeout(() => {
      mapNumberInput.value = game.mapNumber;
    }, 100);
  };

  var topBarStartBattle = document.getElementById('topBarStartBattle');
  topBarStartBattle.disabled = true; // Disable until map is loaded
  
  topBarStartBattle.onclick = function() {
    modalInstance.open();
  };

  $('.country-select').click(function() {
    var country = $(this).data('country');
    modalInstance.close();
    
    let start = () => {
       mapNumberInput.value = game.mapNumber;
       mapNumberInput.disabled = true;
       changeMapButton.disabled = true;
       randomMapButton.disabled = true;
       topBarStartBattle.style.display = 'none';

       game.setHumanPlayer(parseInt(country));
       game.startBattle();
    };

    start();
  });

  // Re-draw on resize to prevent blank screen
  window.addEventListener('resize', () => {
      game.drawGame();
  });

  // Use dynamicCanvas for mouse events (it's on top)
  dynamicCanvas.addEventListener('mousedown', function(e) {
      game.handleInput(e);
  });
  dynamicCanvas.addEventListener('mousemove', function(e) {
      game.handleMouseMove(e);
  });

});
