import { Config } from './shared/Config.js';

export class GameLogicServer {
    constructor(gameModel, pathfinder) {
        this.gameModel = gameModel;
        this.pathfinder = pathfinder;
    }

    
    executeMove(fromField, toField) {
        const army = fromField.army;
        if (!army) {
            return { success: false, error: 'No army at source field' };
        }

        
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

        
        if (toField.army) {
            if (toField.army.party !== army.party) {
                
                const combatEvents = this.attack(army, toField.army, toField);
                result.events.push(...combatEvents);
                
                const combatResult = combatEvents.find(e => e.type === 'combat');
                
                if (combatResult && combatResult.winner === army.id) {
                    toField.army = army;
                    const annexEvents = this.annexLand(army.party, toField);
                    result.events.push(...annexEvents);
                }
            } else {
                
                const joinEvents = this.joinUnits(army, toField.army);
                result.events.push(...joinEvents);
                toField.army.moved = true;
                const annexEvents = this.annexLand(army.party, toField);
                result.events.push(...annexEvents);
            }
        } else {
            
            toField.army = army;
            const annexEvents = this.annexLand(army.party, toField);
            result.events.push(...annexEvents);
        }

        return result;
    }

    attack(attacker, defender, field) {
        const events = [];
        const attPower = attacker.count + attacker.morale;
        const defPower = defender.count + defender.morale;

        const result = {
            type: 'combat',
            attacker: {
                id: attacker.id,
                party: attacker.party,
                initialCount: attacker.count,
                initialMorale: attacker.morale
            },
            defender: {
                id: defender.id,
                party: defender.party,
                initialCount: defender.count,
                initialMorale: defender.morale
            }
        };

        if (attPower > defPower) {
            
            const ratio = defPower / attPower;
            let losses = Math.floor(ratio * attacker.count);
            attacker.count -= losses;
            if (attacker.count <= 0) attacker.count = 1;
            if (attacker.morale > attacker.count) attacker.morale = attacker.count;

            result.winner = attacker.id;
            result.loser = defender.id;
            result.attacker.finalCount = attacker.count;
            result.attacker.finalMorale = attacker.morale;
            result.attacker.losses = losses;

            
            defender.remove = true;
            defender.remove_time = 36;
            
            const moraleUpdate = this.addMoraleForAll(-Math.floor(defender.count / 10), defender.party);
            if (moraleUpdate) events.push(moraleUpdate);
            
        } else {
            
            const ratio = attPower / defPower;
            let losses = Math.floor(ratio * defender.count);
            defender.count -= losses;
            if (defender.count <= 0) defender.count = 1;
            if (defender.morale > defender.count) defender.morale = defender.count;

            result.winner = defender.id;
            result.loser = attacker.id;
            result.defender.finalCount = defender.count;
            result.defender.finalMorale = defender.morale;
            result.defender.losses = losses;

            
            attacker.remove = true;
            attacker.remove_time = 36;
            
            const moraleUpdate = this.addMoraleForAll(-Math.floor(attacker.count / 10), attacker.party);
            if (moraleUpdate) events.push(moraleUpdate);
        }

        events.unshift(result);
        return events;
    }

    joinUnits(movingArmy, targetArmy) {
        const events = [];
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
                initialMorale: targetArmy.morale
            }
        };

        const newCount = targetArmy.count + movingArmy.count;
        const newMorale = Math.floor((targetArmy.count * targetArmy.morale + movingArmy.count * movingArmy.morale) / newCount);

        targetArmy.count = newCount > Config.UNITS.MAX_COUNT ? Config.UNITS.MAX_COUNT : newCount;
        targetArmy.morale = newMorale;
        if (targetArmy.morale > targetArmy.count) targetArmy.morale = targetArmy.count;

        result.targetArmy.finalCount = targetArmy.count;
        result.targetArmy.finalMorale = targetArmy.morale;

        
        movingArmy.remove = true;
        movingArmy.remove_time = 24;

        events.push(result);
        return events;
    }

    annexLand(partyId, field) {
        const events = [];
        if (field.type !== "land") return events;
        
        
        const oldParty = field.party;
        if (oldParty >= 0 && oldParty !== partyId) {
            
            const lostAmount = this.calcMoraleLost(oldParty, field);
            const moraleUpdate = this.addMoraleForAll(lostAmount, oldParty);
            if (moraleUpdate) events.push(moraleUpdate);
        }

        
        if (field.party !== partyId) {
             const earned = this.calcMoraleEarned(partyId, field);
             
             
             const moraleUpdate = this.addMoraleForAll(earned[0], partyId);
             if (moraleUpdate) events.push(moraleUpdate);
             
             
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

        
        field.party = partyId;

        
        for (const n of field.neighbours) {
            if (n && n.type === "land" && !n.estate && !n.army && n.party !== partyId) {
                if (n.party !== partyId) {
                     const earnedN = this.calcMoraleEarned(partyId, n);
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

    addMoraleForAll(amount, partyId) {
        if (amount === 0) return null;
        
        const updates = [];
        for (const key in this.gameModel.armies) {
             const army = this.gameModel.armies[key];
             if (army.party === partyId && !army.remove) {
                 let m = army.morale + amount;
                 if (m < 0) m = 0;
                 if (m > army.count) m = army.count;
                 
                 if (army.morale !== m) {
                     army.morale = m;
                     updates.push({ id: army.id, morale: m });
                 }
             }
        }
        
        if (updates.length > 0) {
            return {
                type: 'morale_update',
                updates: updates
            };
        }
        return null;
    }

    calcMoraleEarned(partyId, field) {
         if (field.capital !== undefined && field.capital >= 0) {
             if (field.capital === field.party) {
                 return [50, 30]; 
             }
             return [30, 20]; 
         }
         
         if (field.estate === "town") return [10, 10];
         if (field.estate === "port") return [5, 5];
         if (field.type === "land") return [1, 0];
         return [0, 0];
    }
    
    calcMoraleLost(partyId, field) {
        if (field.capital !== undefined && field.capital >= 0) {
             return -30;
        }
        if (field.estate === "town") return -10;
        if (field.estate === "port") return -5;
        return 0;
    }

    spawnUnits(partyId) {
        const events = [];
        const party = this.gameModel.parties[partyId];
        
        
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

        
        const capitalField = this.gameModel.getField(party.capital.fx, party.capital.fy);
        if (capitalField && capitalField.party === partyId) {
            const event = this.addUnitsToField(capitalField, 5, party.morale, partyId);
            events.push(event);
        }

        
        for (const town of towns) {
            const townField = this.gameModel.getField(town.fx, town.fy);
            if (townField) {
                const event = this.addUnitsToField(townField, 5 + ucount, party.morale, partyId);
                events.push(event);
            }
        }
        
        console.log(`[GameLogicServer] Spawned units for party ${partyId} (${party.name})`);
        return events;
    }

    cleanupTurn(partyId) {
        
        for (const key in this.gameModel.armies) {
            const army = this.gameModel.armies[key];
            if (army.party === partyId && !army.remove) {
                if (army.moved) {
                    army.moved = false;
                } else {
                    army.morale--;
                    if (army.morale < 0) army.morale = 0;
                }
            }
        }
    }

    addUnitsToField(field, count, morale, partyId) {
        let event = {
            type: 'spawn',
            field: { fx: field.fx, fy: field.fy },
            party: partyId
        };

        if (field.army) {
            
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
            
            const army = {
                id: `army${this.gameModel.armyIdCounter++}`,
                field: field,
                party: partyId,
                count: count > Config.UNITS.MAX_COUNT ? Config.UNITS.MAX_COUNT : count,
                morale: morale,
                moved: false,
                remove: false,
                remove_time: -1
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

    syncPartyArmies() {
        
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
}
