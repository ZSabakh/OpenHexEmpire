import { MapGenerator } from '../../shared/MapGenerator.js';
import { MapRender } from './MapRender.js';

export class MapGeneratorClient extends MapGenerator {
    constructor(gameModel, random, pathfinder) {
        super(gameModel, random, pathfinder);
    }

    generate() {
        super.generate();
        this.addPixelCoordinates();
    }

    addPixelCoordinates() {
        const hexWidth = this.model.hexWidth;
        const hexHeight = this.model.hexHeight;

        for (let x = 0; x < this.model.width; x++) {
            for (let y = 0; y < this.model.height; y++) {
                const field = this.model.getField(x, y);
                // Use the static helper from MapRender for consistency
                const coords = MapRender.getPixelCoordinates(x, y, hexWidth, hexHeight);
                field._x = coords.x;
                field._y = coords.y;
            }
        }
    }
}