import { Config } from './Config.js';

export class GameRules {
    
    static calculateCombat(attacker, defender) {
        const attPower = attacker.count + attacker.morale;
        const defPower = defender.count + defender.morale;
        
        const result = {
            winner: null,
            loser: null,
            attNewCount: attacker.count,
            defNewCount: defender.count,
            attNewMorale: attacker.morale,
            defNewMorale: defender.morale,
            losses: 0
        };

        if (attPower > defPower) {
            result.winner = 'attacker';
            result.loser = 'defender';
            
            const ratio = defPower / attPower;
            result.losses = Math.floor(ratio * attacker.count);
            result.attNewCount -= result.losses;
            if (result.attNewCount <= 0) result.attNewCount = 1;
            
            if (result.attNewMorale > result.attNewCount) result.attNewMorale = result.attNewCount;
        } else {
            result.winner = 'defender';
            result.loser = 'attacker';
            
            const ratio = attPower / defPower;
            result.losses = Math.floor(ratio * defender.count);
            result.defNewCount -= result.losses;
            if (result.defNewCount <= 0) result.defNewCount = 1;
            
            if (result.defNewMorale > result.defNewCount) result.defNewMorale = result.defNewCount;
        }
        
        return result;
    }

    static calculateJoin(movingArmy, targetArmy) {
        const totalCount = targetArmy.count + movingArmy.count;
        const maxCount = Config.UNITS.MAX_COUNT;
        
        if (totalCount <= maxCount) {
            const newMorale = Math.floor((targetArmy.count * targetArmy.morale + movingArmy.count * movingArmy.morale) / totalCount);
            let finalMorale = newMorale;
            if (finalMorale > totalCount) finalMorale = totalCount;
            
            return {
                count: totalCount,
                morale: finalMorale,
                remainder: 0
            };
        } else {
            // Overflow
            const joinedCount = maxCount - targetArmy.count;
            const remainder = movingArmy.count - joinedCount;
            
            // Weighted average for the merged part
            const newMorale = Math.floor((targetArmy.count * targetArmy.morale + joinedCount * movingArmy.morale) / maxCount);
            let finalMorale = newMorale;
            if (finalMorale > maxCount) finalMorale = maxCount;
            
            return {
                count: maxCount,
                morale: finalMorale,
                remainder: remainder
            };
        }
    }

    static calculateMoraleEarned(partyId, field) {
         if (field.capital !== undefined && field.capital >= 0) {
             if (field.capital === field.party) {
                 return [50, 30]; // Conquered faction: [PartyMorale, ArmyMorale]
             }
             return [30, 20]; // Captured capital
         }
         if (field.estate === "town") return [10, 10];
         if (field.estate === "port") return [5, 5];
         if (field.type === "land") return [1, 0];
         return [0, 0];
    }
    
    static calculateMoraleLost(partyId, field) {
        if (field.capital !== undefined && field.capital >= 0) {
             return -20;
        }
        if (field.estate === "town") return -10;
        if (field.estate === "port") return -5;
        return 0;
    }

    static calculateMoralePenalty(count) {
        return -Math.floor(count / 10);
    }

    static calculateGlobalMoraleUpdates(armies, partyId, amount) {
        if (amount === 0) return null;
        
        const updates = [];
        // armies can be an object (server) or array (client party.armies) or object (client state.armies)
        // We will assume it's an iterable of army objects OR an object map.
        
        let armyList = [];
        if (Array.isArray(armies)) {
            armyList = armies;
        } else {
            armyList = Object.values(armies);
        }

        for (const army of armyList) {
             if (army.party === partyId && !army.remove) {
                 let effectiveAmount = amount;
                 
                 if (amount < 0) {
                     const factor = army.morale / 100;
                     // Ensure at least 1 point loss if amount is significant, but scale it down
                     effectiveAmount = Math.ceil(amount * factor);
                     // If it rounded to 0 but amount was negative, force at least -1 (unless morale is 0)
                     if (effectiveAmount === 0 && army.morale > 0) effectiveAmount = -1;
                 }

                 let m = army.morale + effectiveAmount;
                 if (m < 0) m = 0;
                 if (m > army.count) m = army.count;
                 
                 if (army.morale !== m) {
                     updates.push({ id: army.id, morale: m });
                 }
             }
        }
        
        if (updates.length > 0) {
            return updates;
        }
        return null;
    }

    /**
     * Calculate the number of move points for a party's turn
     * @param {Array} movableArmies - Array of armies that can move (not yet moved this turn)
     * @returns {number} The number of moves allowed this turn
     */
    static getMovePoints(movableArmies) {
        let points = 5;
        const movableCount = movableArmies.length;
        if (points > movableCount) points = movableCount;
        return points;
    }
}
