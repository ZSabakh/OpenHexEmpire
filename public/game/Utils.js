// Random class moved to shared/Random.js for server-client synchronization
export { Random } from '../../shared/Random.js';

export const Utils = {
    // Helper to get image path
    getImagePath: (name) => `images/${name}`,
    
    // Degrees to Radians
    degToRad: (deg) => (Math.PI / 180) * deg,
};
