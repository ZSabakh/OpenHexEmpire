import { GameRules } from './GameRules.js';

/**
 * TurnExecutor - Shared logic for executing AI turns
 * Handles the time-delayed AI move loop with configurable delay callbacks
 */
export class TurnExecutor {
    /**
     * Execute an AI turn with time-delayed moves
     * @param {Object} config - Configuration object
     * @param {number} config.partyId - The party ID executing the turn
     * @param {Object} config.gameModel - The game model/state
     * @param {Object} config.gameLogic - The game logic/engine instance
     * @param {Object} config.bot - The bot instance for AI calculations
     * @param {Function} config.onMoveExecute - Callback to execute a single move (army, targetField)
     * @param {Function} config.onTurnComplete - Callback when all moves are complete
     * @param {Function} config.getDelay - Function that returns delay in ms (receives isAnimating boolean)
     * @param {Function} config.checkAnimating - Function that checks if animations are running
     * @param {number} config.initialDelay - Initial delay before starting moves (default: 1000ms)
     */
    static executeAITurn(config) {
        const {
            partyId,
            gameModel,
            gameLogic,
            bot,
            onMoveExecute,
            onTurnComplete,
            getDelay,
            checkAnimating,
            initialDelay = 1000
        } = config;

        // Clear bot cache for fresh calculations
        bot.clearCache();

        // Get movable armies and calculate move points
        const party = gameModel.parties[partyId];
        const movableArmies = party.armies.filter(army => !army.moved);
        const movePoints = GameRules.getMovePoints(movableArmies);

        console.log(`[TurnExecutor] Party ${partyId} has ${movableArmies.length} movable armies, ${movePoints} move points`);

        let moveIndex = 0;

        const executeMove = () => {
            // Check if all moves are complete
            if (moveIndex >= movePoints) {
                onTurnComplete();
                return;
            }

            // Calculate profitability for all movable armies
            const profitability = bot.calcArmiesProfitability(partyId, gameModel);

            if (profitability.length > 0) {
                // Sort by profitability, then by total power
                profitability.sort((a, b) => {
                    if (a.profitability > b.profitability) return -1;
                    if (a.profitability < b.profitability) return 1;
                    const aTotal = a.count + a.morale;
                    const bTotal = b.count + b.morale;
                    return bTotal - aTotal;
                });

                const bestArmy = profitability[0];
                const move = bestArmy.move;

                // Execute the move via callback
                onMoveExecute(bestArmy, move);
            }

            moveIndex++;

            // Determine delay based on animation state
            const isAnimating = checkAnimating ? checkAnimating() : false;
            const delay = getDelay(isAnimating);

            setTimeout(executeMove, delay);
        };

        // Start execution after initial delay
        setTimeout(executeMove, initialDelay);
    }
}