import { MapGenerator } from '../../shared/MapGenerator.js';

export class MapGeneratorClient extends MapGenerator {
    constructor(gameView, random, pathfinder) {
        super(gameView.model, random, pathfinder);
        this.view = gameView;
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
                
                field._x = x * (hexWidth * 0.75) + hexWidth / 2;
                field._y = (x % 2 === 0) 
                    ? y * hexHeight + hexHeight / 2 
                    : y * hexHeight + hexHeight;
            }
        }
    }
}