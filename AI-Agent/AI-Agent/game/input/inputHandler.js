export class InputHandler {
    constructor(game) {
        this.game = game;
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
    }

    handleKeyPress(e) {
        switch(e.key) {
            case 'ArrowUp':
                if (this.game.direction.y !== 1) {
                    this.game.direction = { x: 0, y: -1 };
                }
                break;
            case 'ArrowDown':
                if (this.game.direction.y !== -1) {
                    this.game.direction = { x: 0, y: 1 };
                    if (!this.game.gameLoopInterval) {
                        this.game.startGameLoop();
                    }
                }
                break;
            case 'ArrowLeft':
                if (this.game.direction.x !== 1) {
                    this.game.direction = { x: -1, y: 0 };
                    if (!this.game.gameLoopInterval) {
                        this.game.startGameLoop();
                    }
                }
                break;
            case 'ArrowRight':
                if (this.game.direction.x !== -1) {
                    this.game.direction = { x: 1, y: 0 };
                }
                break;
        }
    }
}