import { Config } from '../../shared/Config.js';
import { GameModel } from '../../shared/GameModel.js';

export class GameView {
    constructor() {
        // Create the underlying game model
        this.model = new GameModel();
        
        // Client-specific rendering properties
        this.pixelWidth = Math.ceil((this.model.width - 1) * (this.model.hexWidth * 0.75) + this.model.hexWidth);
        this.pixelHeight = (this.model.height - 1) * this.model.hexHeight + this.model.hexHeight + (this.model.hexHeight / 2);

        // Canvas references (DOM elements)
        this.backgroundCanvas = null;
        this.seaCanvas = null;
    }

    // Convenience accessors to model properties
    get width() { return this.model.width; }
    get height() { return this.model.height; }
    get hexWidth() { return this.model.hexWidth; }
    get hexHeight() { return this.model.hexHeight; }
    get fields() { return this.model.fields; }
    set fields(value) { this.model.fields = value; }
    get parties() { return this.model.parties; }
    set parties(value) { this.model.parties = value; }
    get turn() { return this.model.turn; }
    set turn(value) { this.model.turn = value; }
    get turnParty() { return this.model.turnParty; }
    set turnParty(value) { this.model.turnParty = value; }
    get humanPlayerId() { return this.model.humanPlayerId; }
    set humanPlayerId(value) { this.model.humanPlayerId = value; }
    get difficulty() { return this.model.difficulty; }
    set difficulty(value) { this.model.difficulty = value; }
    get duel() { return this.model.duel; }
    set duel(value) { this.model.duel = value; }
    get peace() { return this.model.peace; }
    set peace(value) { this.model.peace = value; }
    get pactJustBroken() { return this.model.pactJustBroken; }
    set pactJustBroken(value) { this.model.pactJustBroken = value; }
    get humanCondition() { return this.model.humanCondition; }
    set humanCondition(value) { this.model.humanCondition = value; }
    get isSpectating() { return this.model.isSpectating; }
    set isSpectating(value) { this.model.isSpectating = value; }
    get armies() { return this.model.armies; }
    set armies(value) { this.model.armies = value; }
    get armyIdCounter() { return this.model.armyIdCounter; }
    set armyIdCounter(value) { this.model.armyIdCounter = value; }
    get lands() { return this.model.lands; }
    set lands(value) { this.model.lands = value; }
    get allTowns() { return this.model.allTowns; }
    set allTowns(value) { this.model.allTowns = value; }

    getField(x, y) {
        return this.model.getField(x, y);
    }

    setField(x, y, field) {
        this.model.setField(x, y, field);
    }
}