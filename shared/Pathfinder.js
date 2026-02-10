
class Queue {
  constructor() {
    this.items = [];
    this.head = 0;
  }

  push(item) {
    this.items.push(item);
  }

  isEmpty() {
    return this.head >= this.items.length;
  }

  get length() {
    return this.items.length - this.head;
  }

  popLowest() {
    if (this.isEmpty()) return null;

    let bestIndex = this.head;
    let bestDC = this.items[bestIndex].dc;

    for (let i = this.head + 1; i < this.items.length; i++) {
      if (this.items[i].dc < bestDC) {
        bestDC = this.items[i].dc;
        bestIndex = i;
      }
    }

    if (bestIndex !== this.head) {
        const temp = this.items[this.head];
        this.items[this.head] = this.items[bestIndex];
        this.items[bestIndex] = temp;
    }
    
    const item = this.items[this.head];
    this.items[this.head] = null; 
    this.head++;
    return item;
  }
}

class Pathfinder {
  findPath(startf, endf, avoid_estate, avoid_water, custom_is_blocked) {
    if (!startf || !endf) {
       return null;
    }
    if (avoid_water == undefined) {
       avoid_water = true;
    }
    if (startf.type == "water") {
      avoid_water = false;
    }
    var self = this;
    var c_Walk = function(a, b) {
      if (custom_is_blocked && custom_is_blocked(b)) return false;
      return self.canWalk(a, b, avoid_estate, avoid_water);
    };
    
    var queue = new Queue();
    var path = [];
    var field1 = {};
    var field2 = {};
    
    queue.push({ field: startf, tc: 0 }); 
    
    const move_cost = [5, 5, 5, 5, 5, 5];
    
    while ((path.length == 0 || (path.length > 0 && path[path.length - 1].field != endf)) && !queue.isEmpty()) {
      var currentTile = queue.popLowest();
      
      for (var neighborNum = 0; neighborNum < 6; neighborNum++) {
        if(c_Walk(currentTile.field, currentTile.field.neighbours[neighborNum])
          || currentTile.field.neighbours[neighborNum] == endf) {
          var newTile = {};
          newTile.field = currentTile.field.neighbours[neighborNum];
          var distance = this.getDistance(newTile.field, endf);
          newTile.parent = currentTile;
          newTile.dc = move_cost[neighborNum] + distance;
          newTile.tc = currentTile.tc + move_cost[neighborNum];
          
          var fieldStr = this.getFieldStrO(newTile.field);
          
          if (field2[fieldStr] == undefined) {
            if (field1[fieldStr] == undefined) {
              field1[fieldStr] = true;
              queue.push(newTile);
            }
          } else if (path[field2[fieldStr]].tc > newTile.tc) {
            path[field2[fieldStr]] = newTile;
          }
        }
      }
      field2[this.getFieldStrO(currentTile.field)] = path.length;
      path.push(currentTile);
    }
    
    if (path.length == 0 || path[path.length - 1].field != endf) {
       return null;
    }
    var finalPath = [];
    var pathIndex = path.length - 1;
    while (finalPath[finalPath.length - 1] != startf)
    {
       finalPath.push(path[pathIndex].field);
       if (!path[pathIndex].parent) {
         break;
       }
       pathIndex = field2[this.getFieldStrO(path[pathIndex].parent.field)];
    }
    finalPath.reverse();
    return finalPath;
  }

  canWalk(a, b, avoid_estate, avoid_water) {
    if (!a || !b) {
      return false;
    }
    for (var n = 0; n < avoid_estate.length; n++) {
      if (b.estate == avoid_estate[n]) {
        return false;
      }
    }
    if (!avoid_water) {
      return true;
    }
    if (a.type == "water" && b.type == "water") {
      return true;
    }
    if (a.type == "land" && b.type == "land") {
      return true;
    }
    if (a.type == "water" && b.type == "land") {
      return true;
    }
    if (b.type == "water" && a.estate == "port") {
      return true;
    }
    return false;
  }

  getFieldStrO(field) {
    return "f" + field.fx + "x" + field.fy;
  }

  getDistance(a, b) {
    var aq = a.fx;
    var ar = a.fy - (a.fx - (a.fx & 1)) / 2;
    
    var bq = b.fx;
    var br = b.fy - (b.fx - (b.fx & 1)) / 2;
    
    var dq = Math.abs(aq - bq);
    var dr = Math.abs(ar - br);
    var ds = Math.abs((aq + ar) - (bq + br)); 
    
    return (dq + dr + ds) / 2;
  }

  getFurtherNeighbours(field) {
    var additionalNeighbours = [];
    if (field.neighbours[0]) {
      additionalNeighbours.push(field.neighbours[0].neighbours[0]);
      additionalNeighbours.push(field.neighbours[0].neighbours[1]);
    }
    if (field.neighbours[1]) {
      additionalNeighbours.push(field.neighbours[1].neighbours[1]);
      additionalNeighbours.push(field.neighbours[1].neighbours[2]);
    }
    if (field.neighbours[2]) {
      additionalNeighbours.push(field.neighbours[2].neighbours[2]);
    }
    if (field.neighbours[3]) {
      additionalNeighbours.push(field.neighbours[3].neighbours[3]);
      additionalNeighbours.push(field.neighbours[3].neighbours[4]);
    }
    if (field.neighbours[4]) {
      additionalNeighbours.push(field.neighbours[4].neighbours[4]);
      additionalNeighbours.push(field.neighbours[4].neighbours[5]);
    }
    if (field.neighbours[5]) {
      additionalNeighbours.push(field.neighbours[5].neighbours[5]);
    }

    additionalNeighbours.push(!field.neighbours[0] ? (field.neighbours[5] ? field.neighbours[5].neighbours[0] : undefined) : field.neighbours[0].neighbours[5]);
    additionalNeighbours.push(!field.neighbours[2] ? (field.neighbours[3] ? field.neighbours[3].neighbours[2] : undefined) : field.neighbours[2].neighbours[3]);
    return field.neighbours.concat(additionalNeighbours);
  }

  getPossibleMoves(field, no_self, check_power) {
    function joinCnd(field1, field2) {
      if (!field1) {
        return false;
      }
      if (field1 == field2) {
        return false;
      }
      if (!field1.army) {
        return true;
      }
      if (!field2.army) {
        return false;
      }
      if (check_power && field1.army && field2.army && field1.army.party != field2.army.party) {
        var ap = field1.army.count + field1.army.morale;
        var bp = field2.army.count + field2.army.morale;
        if (bp < 0.75 * ap) {
          return false;
        }
      }
      return field1.army.party != field2.army.party || field1.type != "water" && field1.army.count < 99;
    }
    var reachableFields;
    if (!no_self) {
      reachableFields = new Array(field);
    } else {
      reachableFields = new Array();
    }
    if (field.estate == "port") {
      for (var n = 0; n < 6; n++) {
        if (joinCnd(field.neighbours[n], field)) {
          reachableFields.push(field.neighbours[n]);
          if (field.neighbours[n].type == "water" && !field.neighbours[n].army) {
            for (var n2 = 0; n2 < 6; n2++) {
              if (!field.neighbours[n].neighbours[n2]) {
                continue;
              }
              if (field.neighbours[n].neighbours[n2].type == "water"
                && joinCnd(field.neighbours[n].neighbours[n2], field)) {
                  reachableFields.push(field.neighbours[n].neighbours[n2]);
              }
            }
          } else if (field.neighbours[n].type == "land"
            && !field.neighbours[n].estate
            && !field.neighbours[n].army) {
              for (var n2 = 0; n2 < 6; n2++) {
                if (!field.neighbours[n].neighbours[n2]) {
                  continue;
                }
                if (field.neighbours[n].neighbours[n2].type == "land"
                  && joinCnd(field.neighbours[n].neighbours[n2], field)) {
                    reachableFields.push(field.neighbours[n].neighbours[n2]);
                }
              }
          }
        }
      }
    } else if (field.type == "water") {
      for (var n = 0; n < 6; n++) {
        if (joinCnd(field.neighbours[n], field)) {
          reachableFields.push(field.neighbours[n]);
          if (field.neighbours[n].type == "water" && !field.neighbours[n].army) {
            for (var n2 = 0; n2 < 6; n2++) {
              if (joinCnd(field.neighbours[n].neighbours[n2], field)) {
                reachableFields.push(field.neighbours[n].neighbours[n2]);
              }
            }
          }
        }
      }
    } else if (field.type == "land") {
      for (var n = 0; n < 6; n++) {
        if (!field.neighbours[n]) {
          continue;
        }
        if (field.neighbours[n].type == "land" && joinCnd(field.neighbours[n], field)) {
          reachableFields.push(field.neighbours[n]);
          if (!field.neighbours[n].estate && !field.neighbours[n].army) {
            for (var n2 = 0; n2 < 6; n2++) {
              if (!field.neighbours[n].neighbours[n2]) {
                continue;
              }
              if (field.neighbours[n].neighbours[n2].type == "land" && joinCnd(field.neighbours[n].neighbours[n2],field)) {
                reachableFields.push(field.neighbours[n].neighbours[n2]);
              }
            }
          }
        }
      }
    }
    return reachableFields;
  }
}

export { Pathfinder }
