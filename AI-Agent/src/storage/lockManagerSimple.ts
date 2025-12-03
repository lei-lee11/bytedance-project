/**
 * 简化版文件锁管理器
 * 提供会话级别的并发控制机制
 */

export class LockManager {
    private locks = new Map<string, boolean>();
    private queues = new Map<string, Array<() => void>>();

    /**
     * 获取会话锁
     * @param threadId 会话ID
     * @returns 锁释放函数
     */
    async acquireLock(threadId: string): Promise<() => void> {
        const lockKey = `session_${threadId}`;

        // 如果锁被占用，等待队列
        if (this.locks.get(lockKey)) {
            await new Promise<void>((resolve) => {
                if (!this.queues.has(lockKey)) {
                    this.queues.set(lockKey, []);
                }
                this.queues.get(lockKey)!.push(resolve);
            });
        }

        // 占用锁
        this.locks.set(lockKey, true);

        // 返回释放函数
        return () => {
            this.locks.delete(lockKey);

            // 如果有等待的队列，唤醒下一个
            const queue = this.queues.get(lockKey);
            if (queue && queue.length > 0) {
                const next = queue.shift()!;
                next();
            } else {
                // 清理空队列
                this.queues.delete(lockKey);
            }
        };
    }

    /**
     * 检查是否持有锁
     * @param threadId 会话ID
     */
    hasLock(threadId: string): boolean {
        const lockKey = `session_${threadId}`;
        return this.locks.has(lockKey);
    }

    /**
     * 强制释放所有锁（用于错误恢复）
     */
    forceReleaseAll(): void {
        // 释放所有锁
        this.locks.clear();

        // 唤醒所有等待的队列
        for (const [_lockKey, queue] of this.queues) {
            for (const resolve of queue) {
                resolve();
            }
        }
        this.queues.clear();
    }

    /**
     * 获取当前锁状态（用于调试）
     */
    getLockStatus(): {
        activeLocks: string[];
        pendingLocks: Record<string, number>;
        totalLocks: number;
    } {
        const pendingLocks: Record<string, number> = {};
        for (const [key, queue] of this.queues) {
            pendingLocks[key] = queue.length;
        }

        return {
            activeLocks: Array.from(this.locks.keys()),
            pendingLocks,
            totalLocks: this.locks.size
        };
    }
}
