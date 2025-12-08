import { Game } from './core/game.js';
import { InputHandler } from './input/inputHandler.js';

window.addEventListener('load', () => {
    const canvas = document.getElementById('gameCanvas');
    const game = new Game(canvas);
    new InputHandler(game);
});