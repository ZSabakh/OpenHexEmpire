import { Config } from './Config.js';

export class Bot {
  constructor(pathfinder) {
    this.pathfinder = pathfinder;
    this.mode = 'EXPANSION';
    this.threat = null; 
  }

  updateMode(state, partyId) {
    const party = state.parties[partyId];
    this.threat = null; 

    const capitalNeighbors = party.capital.neighbours;
    for(const n of capitalNeighbors) {
        if (n && n.army && n.army.party !== partyId) {
            this.threat = n.army; 
            this.mode = 'SURVIVAL';
            return;
        }
    }

    let closestThreatDist = Infinity;
    
    for (const armyId in state.armies) {
         const enemy = state.armies[armyId];
         if (enemy.party !== partyId && enemy.party >= 0) {
             const d = this.pathfinder.getDistance(enemy.field, party.capital);
             
             if (d <= 5 && enemy.count > 15) {
                 if (d < closestThreatDist) {
                     closestThreatDist = d;
                     this.threat = enemy;
                 }
             }
         }
    }

    if (this.threat) {
        this.mode = 'SURVIVAL';
        return;
    }

    let maxEnemyPower = 0;
    state.parties.forEach(p => {
        if (p.id !== partyId && p.status > 0) {
            const pPower = p.totalCount + p.morale; 
            if (pPower > maxEnemyPower) maxEnemyPower = pPower;
        }
    });
    const myPower = party.totalCount + party.morale;

    if (myPower > maxEnemyPower * 1.5) {
        this.mode = 'AGGRESSION';
    } else if (party.towns.length < 3) {
        this.mode = 'EXPANSION';
    } else {
        this.mode = 'AGGRESSION';
    }
  }

  getStrategicMove(army, partyId, state) {
    if (this.mode === 'SURVIVAL' && this.threat) {
        return this.getNextStepTowards(army, this.threat.field);
    }

    let targets = [];
    
    state.parties.forEach(p => {
        if (p.id !== partyId && p.status > 0) {
            targets.push(p.capital);
        }
    });

    if (state.allTowns) {
        for(const town of state.allTowns) {
            if (town.party !== partyId) {
                targets.push(town);
            }
        }
    } else {
         for (let x = 0; x < state.width; x++) {
            for (let y = 0; y < state.height; y++) {
                let field = state.getField(x, y);
                if ((field.estate === "town" || field.estate === "port") && field.party !== partyId) {
                    targets.push(field);
                }
            }
        }
    }

    let bestTarget = null;
    let minDist = Infinity;

    targets.forEach(target => {
        let dist = this.pathfinder.getDistance(army.field, target);
        if (dist < minDist) {
            minDist = dist;
            bestTarget = target;
        }
    });

    if (bestTarget) {
        return this.getNextStepTowards(army, bestTarget);
    }
    return null;
  }

  getNextStepTowards(army, targetField) {
      if (!targetField) return null;
      
      const distToTarget = this.pathfinder.getDistance(army.field, targetField);
      
      if (army.count < 10 && distToTarget > 5) {
         return this.getGreedyStep(army.field, targetField); 
      }

      let avoidWater = true;
      if (army.field.type === 'water' || army.field.estate === 'port') avoidWater = false;
      const isBlocked = null; 

      let path = this.pathfinder.findPath(army.field, targetField, [], avoidWater, isBlocked); 
      
      if ((!path || path.length === 0) && avoidWater) {
           path = this.pathfinder.findPath(army.field, targetField, [], false, isBlocked);
      }

      if (path && path.length > 0) {
          return path[0]; 
      }
      return null;
  }

  getGreedyStep(start, target) {
      let bestDist = Infinity;
      let bestNeighbor = null;
      
      for (const neighbor of start.neighbours) {
          if (neighbor) {
              const dist = this.pathfinder.getDistance(neighbor, target);
              if (dist < bestDist) {
                  bestDist = dist;
                  bestNeighbor = neighbor;
              }
          }
      }
      return bestNeighbor;
  }

  isAttackMove(move, partyId) {
    return move && move.army && move.army.party !== partyId;
  }

  findUnmovedNeighbors(army, partyId) {
    const support = [];
    for (const n of army.field.neighbours) {
      if (!n || !n.army) continue;
      if (n.army.party === partyId && !n.army.moved && n.army !== army) {
        support.push(n.army);
      }
    }
    return support;
  }

  orderGroupAttack(army, support, target) {
    for (const sup of support) {
      const isNeighbor = sup.field.neighbours.includes(target);
      if (isNeighbor) {
        sup.orderedMove = target;
        sup.orderedProfitability = Config.AI_WEIGHTS.GROUP_ATTACK_ORDER; 
      }
    }
  }

  calcArmiesProfitability(partyId, state) {
    const self = this;
    const party = state.parties[partyId];
    
    this.updateMode(state, partyId);

    const movableArmies = this.getMovableArmies(partyId, state);
    for (const army of movableArmies) {
      army.orderedMove = null;
      army.orderedProfitability = 0;
    }

    movableArmies.sort((a,b) => b.count - a.count);

    const isSafe = (f) => {
        return f.neighbours.every(n => !n || n.party === partyId);
    };

    function finalProfitability(field, army) {
      let totalProfitability = Config.AI_WEIGHTS.CAPITAL_THREAT;
      let canTakeCapital = false;

      // 1. Base Logic & Betrayal
      for (const otherParty of state.parties) {
        if (otherParty.id !== partyId) {
          let profitability = Config.AI_WEIGHTS.CAPITAL_THREAT;
          if (otherParty.capital.party === otherParty.capital.capital) {
            profitability = field.profitability[otherParty.id];
            if (otherParty.control === "human") {
              profitability += state.difficulty * 2;
            }
          }
          if (state.peace === partyId && otherParty.id === state.humanPlayerId && !state.duel) {
            profitability -= 500;
          }
          if (totalProfitability < profitability) {
            totalProfitability = profitability;
          }
        }
      }

      if (state.peace === partyId && state.humanPlayerId === field.party && !state.duel) {
        profitability += Config.AI_WEIGHTS.BETRAYAL_PENALTY;
      }

      if (field.type === "land" && field.party !== partyId) {
        if (field.capital >= 0 && field.capital === field.party && army.count + army.morale > (field.army ? field.army.count + field.army.morale : 0)) {
          totalProfitability += Config.AI_WEIGHTS.TAKE_CAPITAL;
          canTakeCapital = true;
        } else if (field.capital >= 0) {
          totalProfitability += Config.AI_WEIGHTS.THREAT_CAPITAL;
        } else if (field.estate === "town") {
          totalProfitability += Config.AI_WEIGHTS.THREAT_TOWN;
        } else if (field.estate === "port") {
          totalProfitability += Config.AI_WEIGHTS.THREAT_PORT;
        } else if (field.n_town) {
          totalProfitability += Config.AI_WEIGHTS.THREAT_N_TOWN;
        }
      }

      if (field.army && field.army.party !== partyId) {
        const myPower = army.count + army.morale;
        const enemyPower = field.army.count + field.army.morale;
        const isStaticTarget = field.estate === "town" || field.capital >= 0;

        const isCapitalThreat = (field.army === self.threat);

        let isSuicidal = myPower < enemyPower;
        let siegeBonus = false;

        if (isSuicidal && isStaticTarget && army.count > 40) {
            siegeBonus = true;
            isSuicidal = false;
            totalProfitability += Config.AI_WEIGHTS.COMBAT_SIEGE;
        }

        if (isSuicidal) {
             let sacrificialBonus = false;
             let friendlySupport = null;

             const ratio = myPower / enemyPower;
             const remainingEnemyCount = field.army.count - Math.floor(ratio * field.army.count);
             const remainingEnemyPower = remainingEnemyCount + field.army.morale;
             
             for (const n of field.neighbours) {
                 if (n && n.army && n.army.party === partyId && n.army !== army) {
                     const friendPower = n.army.count + n.army.morale;
                     if (friendPower > remainingEnemyPower * 1.2) {
                         sacrificialBonus = true;
                         friendlySupport = n.army;
                         break;
                     }
                 }
             }

             if (isCapitalThreat && self.mode === 'SURVIVAL') {
                 totalProfitability += 2000; 
             } else if (sacrificialBonus) {
                 totalProfitability += Config.AI_WEIGHTS.COMBAT_SACRIFICE;
                 if (friendlySupport) {
                     self.orderGroupAttack(army, [friendlySupport], field);
                 }
             } else {
                 totalProfitability += Config.AI_WEIGHTS.COMBAT_DESPERATE; 
             }
        } 
        else if (myPower < enemyPower * 1.2) {
             if (isCapitalThreat) {
                 // If it's a threat to capital, take the risk
                 totalProfitability += 5000;
             } else if (field.capital >= 0 || field.estate === "town") {
                 totalProfitability += Config.AI_WEIGHTS.COMBAT_RISKY_OBJECTIVE;
             } else {
                 totalProfitability += Config.AI_WEIGHTS.COMBAT_RISKY;
             }
        }
        else {
             // We win
             totalProfitability += Config.AI_WEIGHTS.COMBAT_WIN;
             if (isCapitalThreat) {
                 totalProfitability += 10000; // MASSIVE priority to kill threat
             }
             if (field.party !== state.humanPlayerId) {
                 totalProfitability += Config.AI_WEIGHTS.COMBAT_WIN_ENEMY; 
             }
             if (field.estate === "town") {
                 totalProfitability += Config.AI_WEIGHTS.TAKE_TOWN;
             } else if (field.estate === "port") {
                 totalProfitability += Config.AI_WEIGHTS.TAKE_PORT;
             }
        }
        
        if (field.n_capital[partyId]) {
          totalProfitability += 1000; 
        }
      }

      if (field.army && field.army.party === partyId) {
        if (field.army.count > army.count && field.army.count < 70) {
          totalProfitability += Config.AI_WEIGHTS.JOIN_ARMY;
        }
      }

      if (army.field.capital === partyId && !field.army && state.turn < 5) {
        totalProfitability += Config.AI_WEIGHTS.STATION_CAPITAL;
      }

      if (self.mode === 'SURVIVAL') {
          let movingTowardsThreat = false;
          if (self.threat) {
              const currentDist = self.pathfinder.getDistance(army.field, self.threat.field);
              const newDist = self.pathfinder.getDistance(field, self.threat.field);
              if (newDist < currentDist) movingTowardsThreat = true;
          }

          if (movingTowardsThreat) {
              totalProfitability += 500;
          } else {
              const dist = self.pathfinder.getDistance(field, party.capital);
              totalProfitability -= dist * Config.AI_WEIGHTS.MODE_SURVIVAL_DIST;
          }

      } else if (self.mode === 'EXPANSION') {
          if (field.type === 'land' && field.party !== partyId && !field.army) {
              totalProfitability += Config.AI_WEIGHTS.MODE_EXPANSION_LAND;
          }
      } else if (self.mode === 'AGGRESSION') {
          if (field.army && field.army.party !== partyId) {
              totalProfitability += Config.AI_WEIGHTS.MODE_AGGRESSION_ARMY;
          }
      }

      if (isSafe(army.field)) {
          if (isSafe(field)) {
              totalProfitability += Config.AI_WEIGHTS.FRONTLINE_SAFE_PENALTY;
          } else {
              totalProfitability += Config.AI_WEIGHTS.FRONTLINE_MOVE_BONUS;
          }
      } else {
          if (!isSafe(field)) {
              totalProfitability += Config.AI_WEIGHTS.FRONTLINE_MOVE; 
          }
      }

      return totalProfitability;
    }

    function findBestMoveVal(army) {
      if (army.orderedMove) {
          const move = army.orderedMove;
          move.tmp_prof = army.orderedProfitability;
          move.wait_for_support = false;
          return move;
      }

      const moves = self.pathfinder.getPossibleMoves(army.field, true, false);
      for (let i = 0; i < moves.length; i++) {
        moves[i].wait_for_support = false;
        moves[i].tmp_prof = finalProfitability(moves[i], army);
      }
      moves.sort((a, b) => b.tmp_prof - a.tmp_prof);

      const strategicTile = self.getStrategicMove(army, partyId, state);
      
      if (strategicTile) {
          let stratBonus = Config.AI_WEIGHTS.STRATEGIC_BONUS;
          if (isSafe(army.field)) {
              stratBonus += Config.AI_WEIGHTS.STRATEGIC_SAFE_BONUS; 
          }
          if (self.threat && strategicTile === self.threat.field) {
              stratBonus += 10000;
          }

          for(let i=0; i<moves.length; i++) {
              if (moves[i] === strategicTile) {
                  moves[i].tmp_prof += stratBonus;
                  break;
              }
          }
          moves.sort((a, b) => b.tmp_prof - a.tmp_prof);
      }

      return moves[0];
    }

    for (const army of movableArmies) {
      const bestMove = findBestMoveVal(army);
      if (!bestMove) continue;

      if (self.isAttackMove(bestMove, partyId)) {
        let support = self.findUnmovedNeighbors(army, partyId);
        if (support.length > 0 && bestMove.army && army.count < bestMove.army.count) {
             self.orderGroupAttack(army, support, bestMove);
             bestMove.tmp_prof += Config.AI_WEIGHTS.GROUP_ATTACK_BOOST; 
        }
      }

      army.move = bestMove;
      army.profitability = army.move.tmp_prof;
      
      const isAttackingThreat = (army.move.army === self.threat);
      if (army.field.capital === army.party && state.turn > 5 && !isAttackingThreat) {
        army.profitability += Config.AI_WEIGHTS.CAPITAL_LEAVE_PENALTY;
      }
    }
    
    return movableArmies;
  }
  
  calcNeighboursInfo(partyId, field) {
    let power = 0;
    let count = 0;
    let nonEnemyLand = 0;
    let waitForSupport = false;
    const furtherNeighbours = this.pathfinder.getFurtherNeighbours(field);
    
    for (const n of furtherNeighbours) {
      if (!n) continue;

      if (n.army && n.army.party === partyId) {
        power += (n.army.count + n.army.morale);
        count++;
      }
      if (n.type === field.type && (n.party === partyId || n.party < 0)) {
        nonEnemyLand++;
      }
      if (n.wait_for_support) {
        waitForSupport = true;
      }
    }
    return {
      power: power,
      count: count,
      non_enemy_land: nonEnemyLand,
      wait_for_support: waitForSupport,
    };
  }

  calcEnemyNeighboursPower(partyId, field) {
    const furtherNeighbours = this.pathfinder.getFurtherNeighbours(field);
    let power = 0;
    for (const n of furtherNeighbours) {
      if (!n) continue;
      if (n.army && n.army.party !== partyId) {
        power += (n.army.count + n.army.morale);
      }
    }
    return power;
  }
  
  supportArmy(partyId, army, field, state) {
    const self = this;
    const party = state.parties[partyId];

    function findBestMoveVal(army) {
      const moves = self.pathfinder.getPossibleMoves(army.field, true, false);
      const supportMoves = [];

      for (const m of moves) {
        if (m !== field && (!m.army || m.army.party < 0 || m.army.party === partyId)) {
          m.tmp_prof = -self.pathfinder.getDistance(m, field);
          supportMoves.push(m);
        }
      }
      supportMoves.sort((a, b) => b.tmp_prof - a.tmp_prof);
      return supportMoves[0];
    }

    const movableArmies = this.getMovableArmies(partyId, state);
    const supportArmies = [];
    
    for (const a of movableArmies) {
      if (a !== army && a.field.capital !== partyId) {
        const bestMove = findBestMoveVal(a);
        if (!bestMove) continue;
        
        a.move = bestMove;
        a.profitability = a.move.tmp_prof;
        
        if (a.move !== field
          && (!a.move.army || a.move.army.party < 0 || a.move.army.party === partyId)
        ) {
          supportArmies.push(a);
        }
      }
    }
    return supportArmies;
  }

  getMovableArmies(partyId, state) {
    const movableArmies = [];
    const armies = state.parties[partyId].armies;
    for (const army of armies) {
      if (!army.moved) {
        movableArmies.push(army);
      }
    }
    return movableArmies;
  }
}
