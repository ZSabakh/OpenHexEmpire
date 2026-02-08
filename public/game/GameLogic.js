import { Config } from '../../shared/Config.js';
import { Animations } from './Animations.js';
import { GameRules } from '../../shared/GameRules.js';
import { GameEngine } from '../../shared/GameEngine.js';

/**
 * GameLogic - Client-side game logic with visual effects
 * This class extends GameEngine and adds visual/animation concerns for single-player mode
 * In multiplayer mode, this class should NOT be used for state modifications
 */
export class GameLogic extends GameEngine {
    constructor(gameState, pathfinder, bot) {
        super(gameState, pathfinder);
        this.state = gameState; 
        this.bot = bot;
    }

    resetGameLog() {
        const gamelogElement = document.getElementById('gamelog');
        if (gamelogElement) gamelogElement.innerHTML = "";
    }

    updateGameLog(message) {
        const gamelogElement = document.getElementById('gamelog');
        if (gamelogElement) gamelogElement.innerHTML += message + "<br/>";
    }

    // Client-specific tick for visual cleanup
    tick() {
         for (const key in this.state.armies) {
             const army = this.state.armies[key];
             if (army.remove_time > 0) {
                 army.remove_time--;
                 if (army.remove_time === 0) {
                     this.deleteArmy(army);
                     delete this.state.armies[key];
                 }
             }
         }
    }

    cleanupTurn() {
        // Call parent to handle state changes
        return super.cleanupTurn(this.state.turnParty);
    }

    updateBoard() {
        // 1. Cleanup Dead Armies (Visual)
        this.cleanupArmies();

        // 2. Re-list armies (Syncs with Engine state)
        this.listArmies();

        // 3. Update Party Statuses
        let statusEvents = [];
        if (this.state.isMultiplayer) {
            // MULTIPLAYER FIX: 
            // We MUST update the status (Alive/Dead) locally so the UI knows if we lost.
            // But we MUST NOT transfer lands or disband armies locally (wait for server events).
            for (const party of this.state.parties) {
                this.checkPartyStatus(party); // This function is in GameEngine, safe to call
            }
        } else {
            statusEvents = super.updatePartyStatuses();
            
            // Handle visual effects for disbanded armies (Single Player only)
            for (const event of statusEvents) {
                if (event.type === 'army_disbanded') {
                    const army = this.state.armies[event.armyId];
                    if (army) {
                        Animations.animateExplosion(army);
                        this.setExplosion(army, army, null);
                        this.updateGameLog(`Disbanded ${this.state.parties[event.party].name} army at (${event.field.fx}, ${event.field.fy})`);
                    }
                }
            }
        }

        // 4. Update Party Territories & Morale
        for (const party of this.state.parties) {
            party.towns = [];
            party.ports = [];
            party.lands = [];
        }

        for (let x = 0; x < this.state.width; x++) {
            for (let y = 0; y < this.state.height; y++) {
                const field = this.state.getField(x, y);
                if (!field) continue;
                
                this.updateFieldVisuals(field); 

                // Add to lists
                if (field.party >= 0) {
                    const p = this.state.parties[field.party];
                    if (field.estate === "town") p.towns.push(field);
                    else if (field.estate === "port") p.ports.push(field);
                    else p.lands.push(field);
                }
            }
        }

        // 5. Update Party Morale
        // In single-player: Calculate morale locally
        // In multiplayer: Server sends morale values, don't overwrite them
        if (!this.state.isMultiplayer) {
            for (const party of this.state.parties) {
                let morale = 0;
                if (party.armies.length > 0) {
                    for (const army of party.armies) {
                        const minMorale = Math.floor(party.totalCount / 50);
                        if (army.morale < minMorale) army.morale = minMorale;
                        if (army.morale > army.count) army.morale = army.count;
                        morale += army.morale;
                    }
                    morale = Math.floor(morale / party.armies.length);
                } else {
                    morale = 10;
                }
                party.morale = morale;
            }
        }

        this.updateHumanCondition();
    }

    listArmies() {
        for (const party of this.state.parties) {
            party.armies = [];
            party.totalCount = 0;
            party.totalPower = 0;
        }

        for (let x = 0; x < this.state.width; x++) {
            for (let y = 0; y < this.state.height; y++) {
                const field = this.state.getField(x, y);
                if (field && field.army && field.army.remove_time < 0) {
                    const party = this.state.parties[field.army.party];
                    party.armies.push(field.army);
                    party.totalCount += field.army.count;
                    party.totalPower += (field.army.count + field.army.morale);
                }
            }
        }
    }

    cleanupArmies() {
        for (const key in this.state.armies) {
            const army = this.state.armies[key];
            if (army.remove && army.remove_time < 0) {
                if (army.waiting) army.waiting.is_waiting = false;
                this.deleteArmy(army);
                delete this.state.armies[key];
            }
        }
    }

    deleteArmy(army) {
        if (army.field && army.field.army === army) {
            army.field.army = null;
        }
    }

    updateHumanCondition() {
        const humanParty = this.state.parties[this.state.humanPlayerId];
        if (!humanParty) return;
        const humanTotalPower = humanParty.morale + humanParty.totalCount;
        let condition = 1;
        for (const party of this.state.parties) {
            if (party.id !== this.state.humanPlayerId && party.status > 0) {
                const enemyPower = party.morale + party.totalCount;
                if (humanTotalPower < 0.3 * enemyPower) condition = 3;
                else if (condition < 3 && humanTotalPower < 0.6 * enemyPower) condition = 2;
                else if (humanParty.provincesCp && humanParty.provincesCp.length >= 2 && humanTotalPower > 2 * enemyPower) condition = 0;
            }
        }
        this.state.humanCondition = condition;
    }

    updateFieldVisuals(field) {}

    /**
     * Make an AI move for the specified party
     * NOTE: This should ONLY be called in single-player mode
     */
    makeMove(partyId) {
        if (this.state.isMultiplayer) {
            console.warn('GameLogic.makeMove called in multiplayer mode! usage of this method is restricted to single player logic.');
            return;
        }

        // Safety check: Bot must exist for AI calculations
        if (!this.bot) {
            console.error('GameLogic.makeMove called but bot is null');
            return;
        }
        
        const profitability = this.bot.calcArmiesProfitability(partyId, this.state);
        profitability.sort((a, b) => {
            if (a.profitability > b.profitability) return -1;
            if (a.profitability < b.profitability) return 1;
            return (b.count + b.morale) - (a.count + a.morale);
        });

        if (profitability.length === 0) return;

        const bestArmy = profitability[0];
        const move = bestArmy.move;
        const party = this.state.parties[partyId];

        if (!move.wait_for_support) {
            party.waitForSupportField = null;
            party.waitForSupportCount = 0;
            this.moveArmy(bestArmy, move);
        } else {
             if (move === party.waitForSupportField) {
                 party.waitForSupportCount++;
             } else {
                 party.waitForSupportField = move;
                 party.waitForSupportCount = 0;
             }
             
             const supportArmies = this.bot.supportArmy(partyId, bestArmy, move, this.state);
             if (supportArmies.length > 0) {
                 supportArmies.sort((a, b) => b.tmp_prof - a.tmp_prof);
                 this.moveArmy(supportArmies[0], supportArmies[0].move);
             } else {
                 this.moveArmy(bestArmy, move);
             }
        }
    }

    /**
     * Move an army with visual effects
     * NOTE: This should ONLY be called in single-player mode
     * In multiplayer, use applyMoveWithVisuals() instead
     */
    moveArmy(army, targetField) {
        const sourceField = army.field;
        this.updateGameLog(`${this.state.parties[army.party].name} moved unit from (${sourceField.fx},${sourceField.fy}) to (${targetField.fx},${targetField.fy})`);

        // 1. EXECUTE LOGIC (State Changes happen here via GameEngine)
        const result = super.executeMove(sourceField, targetField);

        // 2. HANDLE VISUALS (Animations based on what GameEngine returned)
        if (result.success) {
            // Move Animation
            Animations.animateMove(army, targetField._x, targetField._y);
            
            // Combat/Join Animations
            this.handleEventsVisuals(result.events, army, targetField);
        }

        this.updateBoard();
        return result.success;
    }

    handleEventsVisuals(events, movingArmy, targetField) {
        let combatOccurred = false;

        for (const event of events) {
            if (event.type === 'combat') {
                combatOccurred = true;
                const attacker = this.state.armies[event.attacker.id];
                const defender = this.state.armies[event.defender.id];
                
                if (attacker && defender) {
                    Animations.animateAttack(attacker, defender);
                }
                
                const loser = this.state.armies[event.loser];
                if (loser) {
                    Animations.animateExplosion(loser);
                    const winningArmy = event.winner === movingArmy.id ? movingArmy : null;
                    this.setExplosion(winningArmy, loser, winningArmy); 
                }
            } else if (event.type === 'join') {
                const targetArmy = this.state.armies[event.targetArmy.id];
                const movingArmyRef = this.state.armies[event.movingArmy.id];
                
                if (movingArmyRef && targetArmy) {
                    Animations.animateMerge(movingArmyRef, targetArmy);
                    this.setArmyRemoval(movingArmyRef, targetArmy);
                }
            }
        }
    }

    setExplosion(attacking, exploding, waiting) {
        if (attacking) attacking.exploding = exploding;
        if (exploding) exploding.remove_time = 36; 
        if (waiting && attacking) {
            attacking.waiting = waiting;
            waiting.is_waiting = true;
        }
    }

    setArmyRemoval(army, waiting) {
        army.remove = true;
        army.remove_time = 24;
        if (waiting) {
            army.waiting = waiting;
            waiting.is_waiting = true;
        }
    }

    /**
     * Spawn units with visual initialization
     * NOTE: This should ONLY be called in single-player mode
     */
    spawnUnits(partyId) {
        // Use parent to spawn (handles state changes)
        const events = super.spawnUnits(partyId);
        
        // Initialize visual props for new units
        for (const event of events) {
            if (event.type === 'spawn') {
                const field = this.state.getField(event.field.fx, event.field.fy);
                if (field && field.army) {
                    if (!field.army.visual) {
                        field.army.visual = { x: field._x, y: field._y };
                    }
                    field.army.remove_time = -1;
                }
            }
        }
        
        return events;
    }

    /**
     * Apply a move that was already executed on the server
     * This only handles visual effects, not state changes
     */
    applyMoveWithVisuals(army, targetField, events) {
        // Animate the move
        Animations.animateMove(army, targetField._x, targetField._y);
        
        // Handle visual effects for events
        this.handleEventsVisuals(events, army, targetField);
    }

    getMovableArmies(partyId) {
        const movableArmies = [];
        const armies = this.state.parties[partyId].armies;
        for (const army of armies) {
            if (!army.moved) {
                movableArmies.push(army);
            }
        }
        return movableArmies;
    }
}
