import { expect, test, vi } from 'vitest';
import { Game } from '../core/game.js';
import { getRandomPosition } from '../utils/position.js';

vi.mock('../utils/position.js', () => ({
    getRandomPosition: () => ({ x: 10, y: 10 })
}));

test('游戏初始化状态正确', () => {
    const canvas = document.createElement('canvas');
    const game = new Game(canvas);
    expect(game.score).toBe(0);
    expect(game.gameOver).toBe(false);
    expect(game.snake).toEqual([{ x: 5, y: 5 }]);
    expect(game.food).toEqual({ x: 10, y: 10 });
});

test('生成食物不会与蛇重叠', () => {
    const canvas = document.createElement('canvas');
    const game = new Game(canvas);
    game.snake = [{ x: 10, y: 10 }];
    vi.mocked(getRandomPosition).mockReturnValueOnce({ x: 10, y: 10 });
    vi.mocked(getRandomPosition).mockReturnValueOnce({ x: 11, y: 11 });
    const food = game.generateFood();
    expect(food).toEqual({ x: 11, y: 11 });
});

test('吃到食物后分数增加且蛇变长', () => {
    const canvas = document.createElement('canvas');
    const game = new Game(canvas);
    game.food = { x: 6, y: 5 };
    game.update();
    expect(game.score).toBe(1);
    expect(game.snake.length).toBe(2);
});