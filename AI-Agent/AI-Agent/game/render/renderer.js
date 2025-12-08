export class Renderer {
    constructor(ctx, cellSize) {
        this.ctx = ctx;
        this.cellSize = cellSize;
    }

    // 清除画布
    clearCanvas(width, height) {
        this.ctx.clearRect(0, 0, width, height);
        this.ctx.fillStyle = '#fffaf0';
        this.ctx.fillRect(0, 0, width, height);
    }

    // 绘制蛇
    drawSnake(snake) {
        this.ctx.fillStyle = '#2ecc71';
        this.ctx.strokeStyle = '#27ae60';
        snake.forEach(segment => {
            this.ctx.fillRect(
                segment.x * this.cellSize,
                segment.y * this.cellSize,
                this.cellSize - 2,
                this.cellSize - 2
            );
            this.ctx.strokeRect(
                segment.x * this.cellSize,
                segment.y * this.cellSize,
                this.cellSize - 2,
                this.cellSize - 2
            );
        });
    }

    // 绘制食物
    drawFood(food) {
        this.ctx.fillStyle = '#e74c3c';
        this.ctx.strokeStyle = '#c0392b';
        this.ctx.beginPath();
        this.ctx.arc(
            (food.x * this.cellSize) + this.cellSize/2,
            (food.y * this.cellSize) + this.cellSize/2,
            this.cellSize/2 - 2,
            0,
            Math.PI * 2
        );
        this.ctx.fill();
        this.ctx.stroke();
    }
}