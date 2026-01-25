import { Config } from '../../shared/Config.js';
import { Pathfinder } from '../../shared/Pathfinder.js';
import { Utils, Random } from './Utils.js';
import { GameView } from './GameView.js';
import { MapRender } from './MapRender.js';
import { MapGeneratorClient } from './MapGeneratorClient.js';
import { GameLogic } from './GameLogic.js';
import { Bot } from './Bot.js';
import { Animations } from './Animations.js';

export class Game {

  constructor() {
    this.mapRender = new MapRender();
    this.pathfinder = new Pathfinder();
    this.bot = new Bot(this.pathfinder);
    this.images = this.prepareImages();
    this.state = null;
    this.mapNumber = -1;
    this.humanMovesLeft = 0;
    this.selectedArmy = null;
    this.hoveredField = null;
    this.cursorPos = { x: 0, y: 0 };
    this.totalMovesForTurn = 0;
    this.battleStarted = false;
    this.waitingForReady = false;
    this.isMultiplayer = false;
    this.socketManager = null;
    this.roomId = null;
    
    
    this.lastTime = 0;
    this.loop = this.loop.bind(this);
  }

  loop(timestamp) {
    if (this.state) {
      if (this.logic) {
         this.logic.tick();
      }
      this.drawGame();
    }
    requestAnimationFrame(this.loop);
  }

  prepareImages() {
    const images = {};
    const cfg = Config.IMAGES;
    
    
    for (let i = 1; i <= cfg.GRASS_BG.count; i++) {
      images["grassBg" + i] = { img: null, path: Utils.getImagePath(cfg.GRASS_BG.prefix + i + '.png'), status: 'none' };
    }
    for (let i = 1; i <= cfg.SEA_BG.count; i++) {
      images["seaBg" + i] = { img: null, path: Utils.getImagePath(cfg.SEA_BG.prefix + i + '.png'), status: 'none' };
    }
    for (let i = 1; i <= cfg.TOWN_BG_GRASS.count; i++) {
       
       images["townBgGrass" + i] = { img: null, path: Utils.getImagePath(cfg.TOWN_BG_GRASS.prefix + i + '.png'), status: 'none' };
    }
    
    
    images["city"] = { img: null, path: Utils.getImagePath(cfg.CITY), status: 'none' };
    images["port"] = { img: null, path: Utils.getImagePath(cfg.PORT), status: 'none' };
    
    
    cfg.CAPITALS.forEach((path, idx) => {
        images["capital" + idx] = { img: null, path: Utils.getImagePath(path), status: 'none' };
    });
    
    
    for (const [key, path] of Object.entries(cfg.UNITS)) {
        images[key] = { img: null, path: Utils.getImagePath(path), status: 'none' };
    }

    return images;
  }

  loadImage(ref) {
    return new Promise((resolve) => {
      ref.img = new Image();
      ref.img.onload  = () => { ref.status='Image loaded'; resolve(); };
      ref.img.onerror = () => { ref.status='Failed to load image'; resolve(); };
      ref.img.src = ref.path;
    });
  }

  generateRandomMap() {
    const mapNumber = Math.floor(Math.random() * 999999);
    this.generateNewMap(mapNumber);
  }

  generateNewMap(mapNumber) {
    this.mapNumber = mapNumber;
    
    
    const staticCanvas = document.getElementById('staticCanvas');
    const dynamicCanvas = document.getElementById('dynamicCanvas');
    
    const width = Config.MAP.WIDTH;
    const height = Config.MAP.HEIGHT;
    const hexWidth = Config.MAP.HEX_WIDTH;
    const hexHeight = Config.MAP.HEX_HEIGHT;
    const pixelWidth = Math.ceil((width - 1) * (hexWidth * 0.75) + hexWidth);
    const pixelHeight = (height - 1) * hexHeight + hexHeight + (hexHeight / 2);

    if (staticCanvas) {
      staticCanvas.width = pixelWidth * 2;
      staticCanvas.height = pixelHeight * 2;
    }
    
    if (dynamicCanvas) {
      dynamicCanvas.width = pixelWidth * 2;
      dynamicCanvas.height = pixelHeight * 2;
    }

    
    const imagesToLoad = [];
    for (const key in this.images) {
      imagesToLoad.push(this.loadImage(this.images[key]));
    }

    return Promise.all(imagesToLoad).then(() => {
        this.startNewGame(mapNumber);
        requestAnimationFrame(this.loop);
    });
  }

  loadServerMap(mapData) {
    this.mapNumber = mapData.mapSeed;
    
    
    const staticCanvas = document.getElementById('staticCanvas');
    const dynamicCanvas = document.getElementById('dynamicCanvas');
    
    const width = Config.MAP.WIDTH;
    const height = Config.MAP.HEIGHT;
    const hexWidth = Config.MAP.HEX_WIDTH;
    const hexHeight = Config.MAP.HEX_HEIGHT;
    const pixelWidth = Math.ceil((width - 1) * (hexWidth * 0.75) + hexWidth);
    const pixelHeight = (height - 1) * hexHeight + hexHeight + (hexHeight / 2);

    if (staticCanvas) {
      staticCanvas.width = pixelWidth * 2;
      staticCanvas.height = pixelHeight * 2;
    }
    
    if (dynamicCanvas) {
      dynamicCanvas.width = pixelWidth * 2;
      dynamicCanvas.height = pixelHeight * 2;
    }

    
    const imagesToLoad = [];
    for (const key in this.images) {
      imagesToLoad.push(this.loadImage(this.images[key]));
    }

    return Promise.all(imagesToLoad).then(() => {
        this.startGameFromServerData(mapData);
        requestAnimationFrame(this.loop);
    });
  }

  startGameFromServerData(mapData) {
     this.state = new GameView();
     this.bot.clearCache();
     const random = new Random(mapData.mapSeed);
     
     
     this.logic = new GameLogic(this.state, this.pathfinder, this.bot);
     
     
     this.reconstructMapFromServer(mapData, random);
     
     
     this.mapRender.renderStaticBackground(this.state, this.images, random);
     this.mapRender.renderSeaBackground(this.state, this.images, random);

     
     this.calcAIHelpers();
     
     
     this.initUnits();

     
     const mapStatus = document.getElementById('mapStatus');
     if (mapStatus) {
         mapStatus.innerHTML = `<b>Map</b> ${mapData.mapSeed}, <b>Turn</b> ${this.state.turn + 1}`;
     }
     
     const mapNumberInput = document.getElementById('mapNumberInput');
     if (mapNumberInput) {
         mapNumberInput.value = mapData.mapSeed;
     }
     
     const startBtn = document.getElementById('startBattleButton');
     if (startBtn) startBtn.disabled = false;
     
     const topBarStartBtn = document.getElementById('topBarStartBattle');
     if (topBarStartBtn) topBarStartBtn.disabled = false;

     
     this.initializeTopBar();

     
     this.mapRender.drawMap(this.state, this.images);
  }

  reconstructMapFromServer(mapData, random) {
     
     for (const fieldData of mapData.fields) {
         const field = {
             fx: fieldData.fx,
             fy: fieldData.fy,
             type: fieldData.type,
             estate: fieldData.estate,
             party: fieldData.party,
             capital: fieldData.capital,
             army: null,
             neighbours: new Array(6),
             town_name: fieldData.town_name,
             profitability: [0, 0, 0, 0],
             n_capital: [false, false, false, false],
             n_town: false,
             land_id: fieldData.land_id,
         };
         
         
         field._x = fieldData.fx * (this.state.hexWidth * 0.75) + this.state.hexWidth / 2;
         field._y = (fieldData.fx % 2 === 0) 
             ? fieldData.fy * this.state.hexHeight + this.state.hexHeight / 2 
             : fieldData.fy * this.state.hexHeight + this.state.hexHeight;
         
         this.state.setField(fieldData.fx, fieldData.fy, field);
     }
     
     
     for (let x = 0; x < this.state.width; x++) {
         for (let y = 0; y < this.state.height; y++) {
             const field = this.state.getField(x, y);
             if (field) {
                 this.findNeighbours(field);
             }
         }
     }
     
     
     for (let i = 0; i < this.state.parties.length; i++) {
         const partyData = mapData.parties[i];
         if (partyData.capital) {
             const capitalField = this.state.getField(partyData.capital.fx, partyData.capital.fy);
             this.state.parties[i].capital = capitalField;
         }
     }
     
     
     this.state.allTowns = [];
     for (let x = 0; x < this.state.width; x++) {
         for (let y = 0; y < this.state.height; y++) {
             const field = this.state.getField(x, y);
             if (field && (field.estate === "town" || field.estate === "port")) {
                 this.state.allTowns.push(field);
             }
         }
     }
  }

  findNeighbours(field) {
    const x = field.fx;
    const y = field.fy;
    const get = (nx, ny) => this.state.getField(nx, ny);

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

  startNewGame(mapNumber) {
     this.state = new GameView();
     this.bot.clearCache();
     const random = new Random(mapNumber);
     
     
     this.mapGenerator = new MapGeneratorClient(this.state, random, this.pathfinder);
     this.logic = new GameLogic(this.state, this.pathfinder, this.bot);

     
     this.mapGenerator.generate();
     
     
     this.mapRender.renderStaticBackground(this.state, this.images, random);
     this.mapRender.renderSeaBackground(this.state, this.images, random);

     
     this.calcAIHelpers();
     
     
     this.initUnits();

     
     const mapStatus = document.getElementById('mapStatus');
     if (mapStatus) {
         mapStatus.innerHTML = `<b>Map</b> ${mapNumber}, <b>Turn</b> ${this.state.turn + 1}`;
     }
     
     const mapNumberInput = document.getElementById('mapNumberInput');
     if (mapNumberInput) {
         mapNumberInput.value = mapNumber;
     }
     
     const startBtn = document.getElementById('startBattleButton');
     if (startBtn) startBtn.disabled = false;
     
     const topBarStartBtn = document.getElementById('topBarStartBattle');
     if (topBarStartBtn) topBarStartBtn.disabled = false;

     
     this.initializeTopBar();

     
     this.mapRender.drawMap(this.state, this.images);
  }
  
  calcAIHelpers() {
      
      
      
      for (let p = 0; p < this.state.parties.length; p++) {
          const capital = this.state.parties[p].capital;
          for (let x = 0; x < this.state.width; x++) {
              for (let y = 0; y < this.state.height; y++) {
                  const field = this.state.getField(x, y);
                  
                  
                  const path = this.pathfinder.findPath(field, capital, [], true);
                  if (!path) {
                      continue;
                  }
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
  }

  initUnits() {
      for (const party of this.state.parties) {
          this.logic.unitsSpawn(party.id);
          this.logic.updateBoard(); 
      }
  }

  setHumanPlayer(partyId) {
    this.state.humanPlayerId = partyId;
    this.state.parties[partyId].control = "human";
  }

  startBattle() {
    this.battleStarted = true;
    this.state.turn = 0;
    this.state.turnParty = -1;
    this.nextTurn();
  }

  nextTurn() {
    this.state.turnParty++;
    if (this.state.turnParty >= this.state.parties.length) {
      this.state.turnParty = 0;
      this.state.turn++;
      this.logic.updateGameLog("Turn " + (this.state.turn + 1));

      if (this.state.turn >= 150) {
         this.enableMenuControls();
         return;
      }
    }
    
    this.updateMapStatus();
    this.updateTopBar();

    
    if (this.state.humanPlayerId >= 0 && !this.state.isSpectating) {
      const humanParty = this.state.parties[this.state.humanPlayerId];
      
      
      if (humanParty.status === 0) {
        this.showGameEndModal('defeat');
        return;
      }
      
      
      if (humanParty.provincesCp && humanParty.provincesCp.length === this.state.parties.length - 1) {
        this.showGameEndModal('victory');
        return;
      }
    }

    
    if (this.state.isSpectating) {
        let activeParties = [];
        for(const p of this.state.parties) {
            if (p.status > 0) activeParties.push(p);
        }
        
        if (activeParties.length === 1) {
            this.showGameEndModal('spectator_victory', activeParties[0].name);
            return;
        }
    }

    
    if (this.state.parties[this.state.turnParty].status === 0) {
        this.nextTurn();
        return;
    }

    this.logic.cleanupTurn();
    this.logic.updateBoard();

    const currentParty = this.state.parties[this.state.turnParty];
    if (currentParty.control === "computer") {
        if (this.waitingForReady) {
            console.log('Waiting for all players to be ready, skipping AI turn');
            return;
        }
        this.runComputerTurn(currentParty.id);
    } else {
        
        this.totalMovesForTurn = this.getMovePoints(currentParty.id);
        this.humanMovesLeft = this.totalMovesForTurn;
        this.updateMapStatus();
        this.updateTopBar();

        if (this.humanMovesLeft <= 0 || !this.checkHumanCanMove()) {
            this.endHumanTurn();
            return;
        }
        
        const endBtn = document.getElementById('endTurnButton');
        if (endBtn) {
            endBtn.style.display = 'inline-block';
            endBtn.onclick = () => this.endHumanTurn();
        }
        
        const topBarEndBtn = document.getElementById('topBarEndTurn');
        if (topBarEndBtn) {
            topBarEndBtn.style.display = 'inline-block';
            topBarEndBtn.onclick = () => this.endHumanTurn();
        }
    }
  }

  getMovePoints(partyId) {
     let points = 5;
     const movableCount = this.bot.getMovableArmies(partyId, this.state).length;
     if (points > movableCount) points = movableCount;
     return points;
  }

  checkHumanCanMove() {
      const movableArmies = this.bot.getMovableArmies(this.state.humanPlayerId, this.state);
      for (const army of movableArmies) {
          const moves = this.pathfinder.getPossibleMoves(army.field, true, false);
          if (moves.length > 0) return true;
      }
      return false;
  }

  endHumanTurn() {
      const endBtn = document.getElementById('endTurnButton');
      if (endBtn) endBtn.style.display = 'none';
      
      const topBarEndBtn = document.getElementById('topBarEndTurn');
      if (topBarEndBtn) topBarEndBtn.style.display = 'none';
      
      this.logic.unitsSpawn(this.state.humanPlayerId);
      this.selectedArmy = null;
      this.drawGame();
      this.nextTurn();
  }

  runComputerTurn(partyId) {
     
     this.bot.clearCache();

     
     let surviving = 0;
     for (const p of this.state.parties) {
         if (p.capital.party === p.id) surviving++;
     }
     this.state.duel = (surviving < 3);

     const movePoints = this.getMovePoints(partyId);
     this.logic.cleanupTurn();
     this.logic.updateBoard();

     let moveIndex = 0;
     const executeMove = () => {
        if (moveIndex >= movePoints) {
            this.logic.unitsSpawn(partyId);
            this.drawGame();
            setTimeout(() => this.nextTurn(), 200);
            return;
        }

        this.logic.makeMove(partyId);
        this.logic.updateBoard();

        let animating = false;
        if (typeof gsap !== 'undefined') {
            for (const key in this.state.armies) {
                const army = this.state.armies[key];
                if (army.visual && gsap.isTweening(army.visual)) {
                    animating = true;
                    break;
                }
            }
        }

        moveIndex++;
        if (animating) {
            setTimeout(executeMove, Config.ANIMATION.MOVE_WAIT); 
        } else {
            setTimeout(executeMove, Config.ANIMATION.MOVE_WAIT_MIN); 
        }
     };

     executeMove();
  }

  updateMapStatus() {
    let mapStatus = document.getElementById('mapStatus');
    if (!mapStatus) return;
    
    let status = `<b>Map</b> ${this.mapNumber}, <b>Turn</b> ${this.state.turn + 1}`;
    status += ` | Player: ${this.state.parties[this.state.turnParty].name}`;
    
    if (this.state.turnParty === this.state.humanPlayerId) {
      status += ` | Moves: ${this.humanMovesLeft}`;
    }
    mapStatus.innerHTML = status;
  }

  drawGame() {
    this.mapRender.drawMap(this.state, this.images, this.cursorPos);
    if (this.selectedArmy) {
      this.mapRender.drawSelection(this.selectedArmy.field);
      const possibleMoves = this.pathfinder.getPossibleMoves(this.selectedArmy.field, true, false);
      this.mapRender.drawValidMoves(possibleMoves, this.state);
    }
    if (this.hoveredField) {
      this.mapRender.drawHover(this.hoveredField);
    }
  }

  handleMouseMove(event) {
    if (!this.state) return;
    
    const canvas = document.getElementById('dynamicCanvas');
    const pos = this.getMousePos(canvas, event);
    this.cursorPos = pos;
    const fieldXY = this.getFieldXYFromScreenXY(pos.x, pos.y);
    
    if (fieldXY) {
       this.hoveredField = this.state.getField(fieldXY.fx, fieldXY.fy);
    } else {
       this.hoveredField = null;
    }
    this.drawGame();
  }

  handleInput(event) {
      if (!this.state) return;
      if (this.state.turnParty !== this.state.humanPlayerId) return;
      if (this.humanMovesLeft <= 0) return;

      const canvas = document.getElementById('dynamicCanvas');
      const pos = this.getMousePos(canvas, event);
      const fieldXY = this.getFieldXYFromScreenXY(pos.x, pos.y);
      if (!fieldXY) return;

      const field = this.state.getField(fieldXY.fx, fieldXY.fy);
      if (!field) return;

      
      if (this.selectedArmy && this.selectedArmy.party === this.state.humanPlayerId) {
          const possibleMoves = this.pathfinder.getPossibleMoves(this.selectedArmy.field, true, false);
          if (possibleMoves.includes(field)) {
              if (this.isMultiplayer && this.socketManager) {
                  
                  const moveData = {
                      armyId: this.selectedArmy.id,
                      fromField: { fx: this.selectedArmy.field.fx, fy: this.selectedArmy.field.fy },
                      toField: { fx: field.fx, fy: field.fy }
                  };
                  this.socketManager.moveUnit(this.roomId, moveData);
                  
                  this.selectedArmy = null;
                  this.drawGame();
                  return;
              } else {
                  
                  const success = this.logic.moveArmy(this.selectedArmy, field);
                  
                  if (success) {
                      this.humanMovesLeft--;
                      this.selectedArmy = null;
                      this.updateMapStatus();
                      this.updateTopBar();
                      this.logic.updateBoard();
                      this.drawGame();
                      
                      
                      if (this.state.humanPlayerId >= 0) {
                        const humanParty = this.state.parties[this.state.humanPlayerId];
                        if (humanParty.provincesCp && humanParty.provincesCp.length === this.state.parties.length - 1) {
                          
                          const topBarEndTurn = document.getElementById('topBarEndTurn');
                          if (topBarEndTurn) topBarEndTurn.style.display = 'none';
                          
                          this.showGameEndModal('victory');
                          return;
                        }
                      }
                      
                      if (this.humanMovesLeft <= 0 || !this.checkHumanCanMove()) {
                          this.endHumanTurn();
                      }
                      return;
                  }
              }
          }
      }

      
      if (field.army && field.army.party === this.state.humanPlayerId) {
          if (field.army.moved) return;

          if (this.selectedArmy === field.army) {
              this.selectedArmy = null;
          } else {
              this.selectedArmy = field.army;
          }
          this.drawGame();
          return;
      }

      
      if (this.selectedArmy) {
          this.selectedArmy = null;
          this.drawGame();
      }
  }

  handleMoveExecuted(moveData) {
      
      const fromField = this.state.getField(moveData.fromField.fx, moveData.fromField.fy);
      const toField = this.state.getField(moveData.toField.fx, moveData.toField.fy);
      
      if (!fromField || !toField) {
          console.error('Invalid move data received from server');
          return;
      }

      
      const army = fromField.army;
      if (army) {
          
          let combatOccurred = false;
          if (moveData.events) {
              for (const event of moveData.events) {
                  this.applyServerEvent(event);
                  if (event.type === 'combat') combatOccurred = true;
              }
          }

          
          if (combatOccurred) {
              if (typeof gsap !== 'undefined') {
                  gsap.delayedCall(0.8, () => {
                      Animations.animateMove(army, toField._x, toField._y);
                  });
              } else {
                  Animations.animateMove(army, toField._x, toField._y);
              }
          } else {
              Animations.animateMove(army, toField._x, toField._y);
          }

          fromField.army = null;
          army.field = toField;
          toField.army = army;
          army.moved = true;
      }
      
      
      if (this.isMultiplayer && this.state.turnParty === this.state.humanPlayerId) {
          this.humanMovesLeft--;
          
          if (this.humanMovesLeft <= 0 || !this.checkHumanCanMove()) {
              this.socketManager.endTurn(this.roomId);
          }
      }
      
      this.updateMapStatus();
      this.updateTopBar();
      this.drawGame();
  }

  handleUnitsSpawned(data) {
      if (!data.events) return;
      
      for (const event of data.events) {
          const field = this.state.getField(event.field.fx, event.field.fy);
          if (!field) continue;
          
          if (event.isNew) {
              
              const army = {
                  id: event.armyId,
                  field: field,
                  party: event.party,
                  count: event.newCount,
                  morale: event.newMorale,
                  moved: false,
                  remove: false,
                  remove_time: -1,
                  visual: { x: field._x, y: field._y }
              };
              
              field.army = army;
              this.state.armies[army.id] = army;
          } else {
              
              let army = field.army;
              
              if (army && army.id !== event.armyId) {
                  
                  delete this.state.armies[army.id];
                  army.id = event.armyId;
                  this.state.armies[army.id] = army;
              }
              
              if (!army) {
                  
                  army = {
                      id: event.armyId,
                      field: field,
                      party: event.party,
                      count: event.newCount,
                      morale: event.newMorale,
                      moved: false,
                      remove: false,
                      remove_time: -1,
                      visual: { x: field._x, y: field._y }
                  };
                  field.army = army;
                  this.state.armies[army.id] = army;
              } else {
                  army.count = event.newCount;
                  army.morale = event.newMorale;
              }
          }
      }
      this.drawGame();
  }

  applyServerEvent(event) {
      
      if (event.type === 'combat') {
          
          const winner = this.findArmyById(event.winner);
          const loser = this.findArmyById(event.loser);
          
          const attacker = this.findArmyById(event.attacker.id);
          const defender = this.findArmyById(event.defender.id);

          if (attacker && defender) {
              Animations.animateAttack(attacker, defender);
          }
          
          if (winner && event.attacker && event.attacker.id === event.winner) {
              winner.count = event.attacker.finalCount;
              winner.morale = event.attacker.finalMorale;
          } else if (winner && event.defender && event.defender.id === event.winner) {
              winner.count = event.defender.finalCount;
              winner.morale = event.defender.finalMorale;
          }
          
          if (loser) {
              Animations.animateExplosion(loser);
              loser.remove = true;
              loser.remove_time = 36;
          }
      } else if (event.type === 'join') {
          
          const targetArmy = this.findArmyById(event.targetArmy.id);
          const movingArmy = this.findArmyById(event.movingArmy.id);
          
          if (movingArmy && targetArmy) {
              Animations.animateMerge(movingArmy, targetArmy);
          }

          if (targetArmy) {
              targetArmy.count = event.targetArmy.finalCount;
              targetArmy.morale = event.targetArmy.finalMorale;
          }
          
          if (movingArmy) {
              movingArmy.remove = true;
              movingArmy.remove_time = 24;
          }
      } else if (event.type === 'annex') {
          
          const field = this.state.getField(event.field.fx, event.field.fy);
          if (field) {
              field.party = event.newParty;
          }
      } else if (event.type === 'morale_update') {
          
          if (event.updates) {
              for (const update of event.updates) {
                  const army = this.findArmyById(update.id);
                  if (army) {
                      army.morale = update.morale;
                  }
              }
          }
      }
  }

  findArmyById(armyId) {
      return this.state.armies[armyId];
  }

  handleNewTurn(turnData) {
      
      this.state.turn = turnData.turn;
      this.state.turnParty = turnData.turnParty;
      
      console.log(`New turn: ${turnData.turn + 1}, Party: ${turnData.partyName}, Control: ${turnData.control}`);
      
      this.updateMapStatus();
      this.updateTopBar();

      
      if (this.state.parties[this.state.turnParty].status === 0) {
          return;
      }

      this.logic.cleanupTurn();
      this.logic.updateBoard();

      const currentParty = this.state.parties[this.state.turnParty];
      
      
      if (this.isMultiplayer) {
          
          if (currentParty.control === "human" && this.state.turnParty === this.state.humanPlayerId) {
              
              this.totalMovesForTurn = this.getMovePoints(currentParty.id);
              this.humanMovesLeft = this.totalMovesForTurn;
              this.updateMapStatus();
              this.updateTopBar();

              if (this.humanMovesLeft <= 0 || !this.checkHumanCanMove()) {
                  this.socketManager.endTurn(this.roomId);
                  return;
              }
              
              const endBtn = document.getElementById('endTurnButton');
              if (endBtn) {
                  endBtn.style.display = 'inline-block';
                  endBtn.onclick = () => this.socketManager.endTurn(this.roomId);
              }
              
              const topBarEndBtn = document.getElementById('topBarEndTurn');
              if (topBarEndBtn) {
                  topBarEndBtn.style.display = 'inline-block';
                  topBarEndBtn.onclick = () => this.socketManager.endTurn(this.roomId);
              }
          } else {
              
              const endBtn = document.getElementById('endTurnButton');
              if (endBtn) endBtn.style.display = 'none';
              
              const topBarEndBtn = document.getElementById('topBarEndTurn');
              if (topBarEndBtn) topBarEndBtn.style.display = 'none';
              
              console.log(`Waiting for ${turnData.partyName} (${turnData.control}) to play`);
          }
      } else {
          
          if (currentParty.control === "computer") {
              this.runComputerTurn(currentParty.id);
          } else {
              
              this.totalMovesForTurn = this.getMovePoints(currentParty.id);
              this.humanMovesLeft = this.totalMovesForTurn;
              this.updateMapStatus();
              this.updateTopBar();

              if (this.humanMovesLeft <= 0 || !this.checkHumanCanMove()) {
                  this.endHumanTurn();
                  return;
              }
              
              const endBtn = document.getElementById('endTurnButton');
              if (endBtn) {
                  endBtn.style.display = 'inline-block';
                  endBtn.onclick = () => this.endHumanTurn();
              }
              
              const topBarEndBtn = document.getElementById('topBarEndTurn');
              if (topBarEndBtn) {
                  topBarEndBtn.style.display = 'inline-block';
                  topBarEndBtn.onclick = () => this.endHumanTurn();
              }
          }
      }
  }

  setMultiplayerMode(socketManager, roomId) {
      this.isMultiplayer = true;
      this.socketManager = socketManager;
      this.roomId = roomId;
      console.log('Game set to multiplayer mode');
  }


  enableMenuControls() {
      const ids = ['mapNumberInput', 'changeMapButton', 'randomMapButton'];
      ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = false;
      });
      
      
      const topBarStartBattle = document.getElementById('topBarStartBattle');
      if (topBarStartBattle) {
          topBarStartBattle.style.display = 'inline-block';
          topBarStartBattle.disabled = false;
      }
  }

  getMousePos(canvas, event) {
    if (!this.state) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.state.pixelWidth / rect.width),
      y: (event.clientY - rect.top) * (this.state.pixelHeight / rect.height)
    };
  }

  getFieldXYFromScreenXY(screenX, screenY) {
    if (!this.state) return null;
    
    
    const board = this.state; 
    const hw_fw = board.hexWidth;
    const hw_fh = board.hexHeight;
    const hw_xmax = board.width;
    const hw_ymax = board.height;

    const approxX = Math.floor((screenX - (hw_fw / 2)) / (hw_fw / 4 * 3));
    const approxY = Math.floor((screenY - (hw_fh / 2)) / hw_fh);

    let bestDist = Infinity;
    let bestField = null;

    for (let dx = -1; dx <= 2; dx++) {
      for (let dy = -1; dy <= 2; dy++) {
         const fx = approxX + dx;
         const fy = approxY + dy;
         
         if (fx < 0 || fx >= hw_xmax || fy < 0 || fy >= hw_ymax) continue;

         const centerX = fx * (hw_fw * 0.75) + hw_fw / 2;
         let centerY;
         if (fx % 2 === 0) {
           centerY = fy * hw_fh + hw_fh / 2;
         } else {
           centerY = fy * hw_fh + hw_fh;
         }

         const dist = Math.pow(screenX - centerX, 2) + Math.pow(screenY - centerY, 2);
         if (dist < bestDist) {
           bestDist = dist;
           bestField = { fx, fy };
         }
      }
    }
    return bestField;
  }

  initializeTopBar() {
    const capitalsSection = document.getElementById('capitalsSection');
    if (!capitalsSection) return;

    
    capitalsSection.innerHTML = '';

    
    for (let i = 0; i < this.state.parties.length; i++) {
      const party = this.state.parties[i];
      const capitalItem = document.createElement('div');
      capitalItem.className = 'capital-item';
      capitalItem.id = `capital-item-${i}`;

      const capitalIcon = document.createElement('img');
      capitalIcon.className = 'capital-icon';
      capitalIcon.src = `/images/${Config.IMAGES.CAPITALS[i]}`;
      capitalIcon.alt = party.name;

      const capitalInfo = document.createElement('div');
      capitalInfo.className = 'capital-info';

      const capitalName = document.createElement('div');
      capitalName.className = 'capital-name';
      capitalName.id = `capital-name-${i}`;
      capitalName.textContent = party.name;

      const capitalStats = document.createElement('div');
      capitalStats.className = 'capital-stats';
      capitalStats.id = `capital-stats-${i}`;
      capitalStats.textContent = 'Armies: 0 | Power: 0';

      capitalInfo.appendChild(capitalName);
      capitalInfo.appendChild(capitalStats);
      capitalItem.appendChild(capitalIcon);
      capitalItem.appendChild(capitalInfo);
      capitalsSection.appendChild(capitalItem);
    }

    
    const topBar = document.getElementById('gameTopBar');
    if (topBar) topBar.classList.add('active');

    
    this.updateTopBar();
  }

  updateMultiplayerPlayers(roomPlayers) {
    this.multiplayerPlayers = roomPlayers;
    for (let i = 0; i < this.state.parties.length; i++) {
      const capitalItem = document.getElementById(`capital-item-${i}`);
      const capitalName = document.getElementById(`capital-name-${i}`);
      
      if (roomPlayers[i]) {
        if (capitalName) {
          capitalName.textContent = roomPlayers[i];
        }
        if (capitalItem) {
          capitalItem.style.background = 'rgba(33, 150, 243, 0.2)';
          capitalItem.style.borderColor = 'rgba(33, 150, 243, 0.5)';
        }
      } else {
        if (capitalName) {
          capitalName.textContent = this.state.parties[i].name;
        }
        if (capitalItem) {
          capitalItem.style.background = '';
          capitalItem.style.borderColor = '';
        }
      }
    }
  }

  updateTopBar() {
    if (!this.state) return;

    
    const turnIndicator = document.getElementById('turnIndicator');
    if (turnIndicator) {
      turnIndicator.textContent = `Turn ${this.state.turn + 1}`;
    }

    
    for (let i = 0; i < this.state.parties.length; i++) {
      const party = this.state.parties[i];
      const capitalItem = document.getElementById(`capital-item-${i}`);
      const capitalStats = document.getElementById(`capital-stats-${i}`);

      if (!capitalItem || !capitalStats) continue;

      
      const armyCount = party.armies.length;
      const totalPower = party.totalPower || 0;
      capitalStats.textContent = `Armies: ${armyCount} | Power: ${totalPower}`;

      
      if (this.state.turnParty === i && party.status === 1) {
        capitalItem.classList.add('active');
      } else {
        capitalItem.classList.remove('active');
      }

      
      if (party.status === 0) {
        capitalItem.classList.add('eliminated');
      } else {
        capitalItem.classList.remove('eliminated');
      }
    }

    
    const topBarEndTurn = document.getElementById('topBarEndTurn');
    const endTurnButton = document.getElementById('endTurnButton');
    const moveCounter = document.getElementById('moveCounter');
    
    if (this.state.turnParty === this.state.humanPlayerId && this.state.humanPlayerId >= 0) {
      if (topBarEndTurn) topBarEndTurn.style.display = 'inline-block';
      if (moveCounter) {
          moveCounter.style.display = 'block';
          moveCounter.textContent = `Moves: ${this.humanMovesLeft} / ${this.totalMovesForTurn}`;
      }
    } else {
      if (topBarEndTurn) topBarEndTurn.style.display = 'none';
      if (moveCounter) moveCounter.style.display = 'none';
    }
  }

  showGameEndModal(type, winnerName) {
    const modal = document.getElementById('gameEndModal');
    if (!modal) return;

    const title = document.getElementById('gameEndTitle');
    const message = document.getElementById('gameEndMessage');
    const buttonsContainer = document.getElementById('gameEndButtons');

    if (type === 'victory') {
      title.textContent = 'Victory!';
      title.style.color = '#4CAF50';
      message.textContent = 'You have conquered all enemy capitals and achieved total domination!';
      
      buttonsContainer.innerHTML = `
        <button type="button" class="game-control-btn start-battle" id="playAgainButton" style="width: 100%; padding: 15px;">
          <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">replay</i>
          Play Again
        </button>
        <button type="button" class="game-control-btn" id="newMapButton" style="width: 100%; padding: 15px; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);">
          <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">map</i>
          New Map
        </button>
      `;
    } else if (type === 'spectator_victory') {
      title.textContent = 'Game Over';
      title.style.color = '#ffd700';
      message.textContent = `${winnerName} has conquered the world!`;
      
      buttonsContainer.innerHTML = `
        <button type="button" class="game-control-btn start-battle" id="playAgainButton" style="width: 100%; padding: 15px;">
          <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">replay</i>
          Restart Map
        </button>
        <button type="button" class="game-control-btn" id="newMapButton" style="width: 100%; padding: 15px; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);">
          <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">map</i>
          New Map
        </button>
      `;
    } else {
      title.textContent = 'Your Capital Has Fallen!';
      title.style.color = '#ff5252';
      message.textContent = 'Your empire has been defeated. What would you like to do?';
      
      if (this.isMultiplayer) {
          buttonsContainer.innerHTML = `
            <button type="button" class="game-control-btn" id="spectateButton" style="width: 100%; padding: 15px; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);">
              <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">visibility</i>
              Spectate Game
            </button>
            <button type="button" class="game-control-btn" id="leaveGameButton" style="width: 100%; padding: 15px; margin-top: 10px; background-color: #757575;">
              <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">exit_to_app</i>
              Leave Game
            </button>
          `;
      } else {
          buttonsContainer.innerHTML = `
            <button type="button" class="game-control-btn start-battle" id="restartSameMapButton" style="width: 100%; padding: 15px;">
              <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">refresh</i>
              Restart with Same Map
            </button>
            <button type="button" class="game-control-btn" id="spectateButton" style="width: 100%; padding: 15px; background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%);">
              <i class="material-icons" style="vertical-align: middle; margin-right: 8px;">visibility</i>
              Watch AI Battle Continue
            </button>
          `;
      }
    }

    const modalInstance = M.Modal.init(modal, {
      dismissible: false
    });
    modalInstance.open();

    
    this.setupGameEndButtons(type);
  }

  setupGameEndButtons(type) {
    if (type === 'victory' || type === 'spectator_victory') {
      const playAgainButton = document.getElementById('playAgainButton');
      if (playAgainButton) {
        playAgainButton.onclick = () => this.restartSameMap();
      }

      const newMapButton = document.getElementById('newMapButton');
      if (newMapButton) {
        newMapButton.onclick = () => this.startNewRandomMap();
      }
    } else {
      const restartButton = document.getElementById('restartSameMapButton');
      if (restartButton) {
        restartButton.onclick = () => this.restartSameMap();
      }

      const spectateButton = document.getElementById('spectateButton');
      if (spectateButton) {
        spectateButton.onclick = () => this.enterSpectatorMode();
      }
      
      const leaveButton = document.getElementById('leaveGameButton');
      if (leaveButton) {
        leaveButton.onclick = () => window.location.reload();
      }
    }
  }

  restartSameMap() {
    this.closeGameEndModal();
    if (this.state) {
      this.state.isSpectating = false;
    }
    
    
    this.enableMenuControls();
    
    
    this.generateNewMap(this.mapNumber);
  }

  startNewRandomMap() {
    this.closeGameEndModal();
    if (this.state) {
      this.state.isSpectating = false;
    }
    
    
    this.enableMenuControls();
    
    
    this.generateRandomMap();
  }

  enterSpectatorMode() {
    this.closeGameEndModal();
    
    if (this.state) {
      this.state.isSpectating = true;
      
      if (this.state.humanPlayerId >= 0) {
        this.state.parties[this.state.humanPlayerId].control = "computer";
      }

      const topBarEndTurn = document.getElementById('topBarEndTurn');
      if (topBarEndTurn) topBarEndTurn.style.display = 'none';

      this.selectedArmy = null;
      this.drawGame();
      this.nextTurn();
    }
  }

  closeGameEndModal() {
    const modal = document.getElementById('gameEndModal');
    if (modal) {
      const modalInstance = M.Modal.getInstance(modal);
      if (modalInstance) modalInstance.close();
    }
  }
}
