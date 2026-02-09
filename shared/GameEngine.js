import { Config } from './Config.js';
import { GameRules } from './GameRules.js';

/**
 * GameEngine - Shared game logic for both client and server
 * This class contains the core game mechanics that are identical on both sides
 */
export class GameEngine {
    constructor(gameModel, pathfinder) {
        this.gameModel = gameModel;
        this.pathfinder = pathfinder;
    }

    /**
     * Execute a move from one field to another
     * Returns an object with success status and events that occurred
     */
    executeMove(fromField, toField) {
        const army = fromField.army;
        if (!army) {
            return { success: false, error: 'No army at source field' };
        }

        // Move the army
        fromField.army = null;
        army.field = toField;
        army.moved = true;

        const result = {
            success: true,
            fromField: { fx: fromField.fx, fy: fromField.fy },
            toField: { fx: toField.fx, fy: toField.fy },
            armyId: army.id,
            events: []
        };

        // Handle different scenarios
        if (toField.army) {
            if (toField.army.party !== army.party) {
                // Attack enemy army
                const combatEvents = this.attack(army, toField.army, toField);
                result.events.push(...combatEvents);
                
                const combatResult = combatEvents.find(e => e.type === 'combat');
                
                if (combatResult && combatResult.winner === army.id) {
                    toField.army = army;
                    const annexEvents = this.annexLand(army.party, toField);
                    result.events.push(...annexEvents);
                }
            } else {
                // Join friendly army
                const joinEvents = this.joinUnits(army, toField.army);
                result.events.push(...joinEvents);
                toField.army.moved = true;
                const annexEvents = this.annexLand(army.party, toField);
                result.events.push(...annexEvents);
            }
        } else {
            // Move to empty field
            toField.army = army;
            const annexEvents = this.annexLand(army.party, toField);
            result.events.push(...annexEvents);
        }

        return result;
    }

    /**
     * Handle combat between two armies
     */
    attack(attacker, defender, field) {
        const events = [];
        const combatResult = GameRules.calculateCombat(attacker, defender);

        const result = {
            type: 'combat',
            attacker: {
                id: attacker.id,
                party: attacker.party,
                initialCount: attacker.count,
                initialMorale: attacker.morale,
                finalCount: combatResult.attNewCount,
                finalMorale: combatResult.attNewMorale,
                losses: combatResult.winner === 'attacker' ? combatResult.losses : 0 
            },
            defender: {
                id: defender.id,
                party: defender.party,
                initialCount: defender.count,
                initialMorale: defender.morale,
                finalCount: combatResult.defNewCount,
                finalMorale: combatResult.defNewMorale,
                losses: combatResult.winner === 'defender' ? combatResult.losses : 0
            },
            winner: combatResult.winner === 'attacker' ? attacker.id : defender.id,
            loser: combatResult.loser === 'attacker' ? attacker.id : defender.id
        };

        // Apply results
        attacker.count = combatResult.attNewCount;
        attacker.morale = combatResult.attNewMorale;
        defender.count = combatResult.defNewCount;
        defender.morale = combatResult.defNewMorale;

        if (combatResult.winner === 'attacker') {
            defender.remove = true;
            const penalty = GameRules.calculateMoralePenalty(result.defender.initialCount);
            const moraleUpdate = this.addMoraleForAll(penalty, defender.party);
            if (moraleUpdate) events.push(moraleUpdate);
        } else {
            attacker.remove = true;
            const penalty = GameRules.calculateMoralePenalty(result.attacker.initialCount);
            const moraleUpdate = this.addMoraleForAll(penalty, attacker.party);
            if (moraleUpdate) events.push(moraleUpdate);
        }

        events.unshift(result);
        return events;
    }

    /**
     * Join two friendly armies
     */
    joinUnits(movingArmy, targetArmy) {
        const events = [];
        const joinResult = GameRules.calculateJoin(movingArmy, targetArmy);

        const result = {
            type: 'join',
            movingArmy: {
                id: movingArmy.id,
                count: movingArmy.count,
                morale: movingArmy.morale
            },
            targetArmy: {
                id: targetArmy.id,
                initialCount: targetArmy.count,
                initialMorale: targetArmy.morale,
                finalCount: joinResult.count,
                finalMorale: joinResult.morale
            }
        };

        targetArmy.count = joinResult.count;
        targetArmy.morale = joinResult.morale;

        if (joinResult.remainder > 0) {
            // Overflow: Moving army keeps remainder and stays
            movingArmy.count = joinResult.remainder;
            movingArmy.remove = false;
            result.movingArmy.finalCount = joinResult.remainder;
        } else {
            // Full merge
            movingArmy.remove = true;
        }

        events.push(result);
        return events;
    }

    /**
     * Annex land for a party
     */
    annexLand(partyId, field) {
        const events = [];
        if (field.type !== "land") return events;
        
        // Check if we are taking it from someone else
        const oldParty = field.party;
        if (oldParty >= 0 && oldParty !== partyId) {
            // Lost territory logic
            const lostAmount = GameRules.calculateMoraleLost(oldParty, field);
            const moraleUpdate = this.addMoraleForAll(lostAmount, oldParty);
            if (moraleUpdate) events.push(moraleUpdate);
        }

        // Earned logic
        if (field.party !== partyId) {
             const earned = GameRules.calculateMoraleEarned(partyId, field);
             
             // Party morale
             const moraleUpdate = this.addMoraleForAll(earned[0], partyId);
             if (moraleUpdate) events.push(moraleUpdate);
             
             // Specific army morale (the one on this field)
             if (field.army && field.army.party === partyId) {
                 let m = field.army.morale + earned[1];
                 if (m < 0) m = 0;
                 if (m > field.army.count) m = field.army.count;
                 
                 if (m !== field.army.morale) {
                     field.army.morale = m;
                 }
             }
        }

        const result = {
            type: 'annex',
            field: { fx: field.fx, fy: field.fy },
            oldParty: field.party,
            newParty: partyId
        };

        // Change ownership
        field.party = partyId;

        // Auto-annex empty neighbours
        for (const n of field.neighbours) {
            if (n && n.type === "land" && !n.estate && !n.army && n.party !== partyId) {
                if (n.party !== partyId) {
                     const earnedN = GameRules.calculateMoraleEarned(partyId, n);
                     const moraleUpdateN = this.addMoraleForAll(earnedN[0], partyId);
                     if (moraleUpdateN) events.push(moraleUpdateN);
                }
                
                n.party = partyId;
                
                events.push({
                    type: 'annex',
                    field: { fx: n.fx, fy: n.fy },
                    oldParty: n.party,
                    newParty: partyId
                });
            }
        }
        
        events.unshift(result);
        return events;
    }

    /**
     * Add morale to all armies of a party
     */
    addMoraleForAll(amount, partyId) {
        const updates = GameRules.calculateGlobalMoraleUpdates(this.gameModel.armies, partyId, amount);
        
        if (updates && updates.length > 0) {
            // Apply updates
            for (const update of updates) {
                const army = this.gameModel.armies[update.id];
                if (army) {
                    army.morale = update.morale;
                }
            }
            return {
                type: 'morale_update',
                updates: updates
            };
        }
        return null;
    }

    /**
     * Spawn units for a party at the start of their turn
     */
    spawnUnits(partyId) {
        const events = [];
        const party = this.gameModel.parties[partyId];
        
        // Count territories
        let landCount = 0;
        let portCount = 0;
        const towns = [];
        
        for (const key in this.gameModel.fields) {
            const field = this.gameModel.fields[key];
            if (field.party === partyId) {
                if (field.estate === "town") {
                    towns.push(field);
                } else if (field.estate === "port") {
                    portCount++;
                } else if (field.type === "land") {
                    landCount++;
                }
            }
        }

        const ucount = Math.floor((landCount + portCount * 5) / (towns.length || 1));

        // Capital spawn
        const capitalField = this.gameModel.getField(party.capital.fx, party.capital.fy);
        if (capitalField && capitalField.party === partyId) {
            const event = this.addUnitsToField(capitalField, 5, party.morale, partyId);
            events.push(event);
        }

        // Towns spawn
        for (const town of towns) {
            const townField = this.gameModel.getField(town.fx, town.fy);
            if (townField) {
                const event = this.addUnitsToField(townField, 5 + ucount, party.morale, partyId);
                events.push(event);
            }
        }
        
        return events;
    }

    /**
     * Cleanup turn - reset moved flags and decrease morale for unmoved armies
     */
    cleanupTurn(partyId) {
        const updates = [];
        for (const key in this.gameModel.armies) {
            const army = this.gameModel.armies[key];
            if (army.party === partyId && !army.remove) {
                if (army.moved) {
                    army.moved = false;
                } else {
                    const oldMorale = army.morale;
                    army.morale--;
                    if (army.morale < 0) army.morale = 0;
                    
                    if (army.morale !== oldMorale) {
                        updates.push({ id: army.id, morale: army.morale });
                    }
                }
            }
        }
        return updates;
    }

    /**
     * Add units to a field (spawn or reinforce)
     */
    addUnitsToField(field, count, morale, partyId) {
        let event = {
            type: 'spawn',
            field: { fx: field.fx, fy: field.fy },
            party: partyId
        };

        if (field.army) {
            // Reinforce existing army
            const newCount = field.army.count + count;
            const newMorale = Math.floor((field.army.count * field.army.morale + count * morale) / newCount);
            field.army.count = newCount > Config.UNITS.MAX_COUNT ? Config.UNITS.MAX_COUNT : newCount;
            field.army.morale = newMorale;
            if (field.army.morale > field.army.count) field.army.morale = field.army.count;
            
            event.armyId = field.army.id;
            event.newCount = field.army.count;
            event.newMorale = field.army.morale;
            event.isNew = false;
        } else {
            // Create new army
            const army = {
                id: `army${this.gameModel.armyIdCounter++}`,
                field: field,
                party: partyId,
                count: count > Config.UNITS.MAX_COUNT ? Config.UNITS.MAX_COUNT : count,
                morale: morale,
                moved: true,
                remove: false
            };
            if (army.morale > army.count) army.morale = army.count;
            field.army = army;
            this.gameModel.armies[army.id] = army;
            
            event.armyId = army.id;
            event.newCount = army.count;
            event.newMorale = army.morale;
            event.isNew = true;
        }
        return event;
    }

    /**
     * Sync party armies - update party army lists from field data
     */
    syncPartyArmies() {
        // Reset lists
        for (const party of this.gameModel.parties) {
            party.armies = [];
            party.totalCount = 0;
            party.totalPower = 0;
        }
        
        for (const key in this.gameModel.armies) {
            const army = this.gameModel.armies[key];
            if (!army.remove) {
                const party = this.gameModel.parties[army.party];
                if (party) {
                    party.armies.push(army);
                    party.totalCount += army.count;
                    party.totalPower += (army.count + army.morale);
                }
            }
        }
    }

    /**
     * Check party status and update based on capital ownership
     */
    checkPartyStatus(party) {
        const capitalField = party.capital;
        if (capitalField.party !== party.id) {
            party.status = 0;
            party.provincesCp = null;
            return;
        }
        const otherCapitals = [];
        for (const otherP of this.gameModel.parties) {
            if (otherP.id !== party.id && otherP.capital.party === party.id) {
                if (otherP.armies.length === 0) {
                    otherCapitals.push(otherP.capital);
                }
            }
        }
        if (otherCapitals.length > 0) {
            party.status = 1 + otherCapitals.length;
            party.provincesCp = otherCapitals;
        } else {
            party.status = 1;
            party.provincesCp = null;
        }
    }

    /**
     * Transfer land ownership from dead factions to their conquerors
     * This should be called after party status is updated
     */
    transferDeadFactionLands() {
        const events = [];
        
        for (const key in this.gameModel.fields) {
            const field = this.gameModel.fields[key];
            
            if (field.party >= 0) {
                let landOwner = this.gameModel.parties[field.party];
                
                // Follow the chain of dead factions to find the actual owner
                while (landOwner.status === 0 && landOwner.capital.party !== landOwner.id) {
                    const nextOwnerId = landOwner.capital.party;
                    // Prevent infinite loops
                    if (nextOwnerId === landOwner.id || nextOwnerId === field.party) break;
                    landOwner = this.gameModel.parties[nextOwnerId];
                }
                
                // Transfer ownership if needed
                if (field.party !== landOwner.id) {
                    const oldParty = field.party;
                    field.party = landOwner.id;
                    
                    events.push({
                        type: 'land_transfer',
                        field: { fx: field.fx, fy: field.fy },
                        oldParty: oldParty,
                        newParty: landOwner.id
                    });
                }
            }
            
            // Disband armies of dead factions
            if (field.army) {
                const armyPartyId = field.army.party;
                if (this.gameModel.parties[armyPartyId].status === 0) {
                    field.army.remove = true;
                    
                    events.push({
                        type: 'army_disbanded',
                        armyId: field.army.id,
                        party: armyPartyId,
                        field: { fx: field.fx, fy: field.fy }
                    });
                }
            }
        }
        
        return events;
    }

    /**
     * Update all party statuses and transfer lands from dead factions
     * Should be called after moves/combat to ensure consistency
     */
    updatePartyStatuses() {
        // First, update all party statuses
        for (const party of this.gameModel.parties) {
            this.checkPartyStatus(party);
        }
        
        // Then transfer lands from dead factions
        return this.transferDeadFactionLands();
    }
}
