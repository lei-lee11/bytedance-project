import { SessionManager } from './sessionManager.js';
import { LockManager } from './lockManagerSimple.js';
import {
    SessionMetadata,
    CheckpointRecord,
    HistoryRecord,
    SessionInfo,
    SessionListResult,
    StorageConfig,
    SaveOptions,
    QueryOptions,
    AgentState,
    ISessionManager
} from './types.js';
import { BaseMessage } from '@langchain/core/messages';

/**
 * 增强版会话管理器 - 带文件锁机制
 * 负责管理所有会话的生命周期，提供并发安全保证
 *
 * 设计模式：组合模式
 * - 复用 SessionManager 的核心逻辑
 * - 添加会话级文件锁机制
 * - 保证高并发场景下的数据一致性
 */
export class SessionManagerWithLock implements ISessionManager {
    private sessionManager: SessionManager;
    private lockManager: LockManager;

    constructor(config?: Partial<StorageConfig>) {
        this.sessionManager = new SessionManager(config);
        this.lockManager = new LockManager();
    }

    /**
     * 初始化存储系统
     */
    async initialize(): Promise<void> {
        await this.sessionManager.initialize();
    }

    /**
     * 会话锁装饰器 - 确保操作的原子性
     *
     * 关键特性：
     * - 会话级别的细粒度锁定
     * - 避免全局锁带来的性能瓶颈
     * - 支持锁排队，防止死锁
     * - 自动释放机制，防止资源泄露
     */
    private async withSessionLock<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
        const releaseLock = await this.lockManager.acquireLock(threadId);
        try {
            return await operation();
        } finally {
            releaseLock();
        }
    }

    /**
     * 创建新会话
     *
     * 并发安全策略：
     * - 会话创建是原子操作，需要锁保护
     * - 防止多个并发请求创建相同ID的会话
     * - 保证元数据写入和历史记录添加的一致性
     */
    async createSession(options: {
        title?: string;
        programmingLanguage?: string;
        initialMessage?: string;
    } = {}): Promise<{ threadId: string; metadata: SessionMetadata }> {
        // 复用基础会话管理器的创建逻辑，但在锁保护下执行
        return await this.withSessionLock('create-session-lock', async () => {
            return await this.sessionManager.createSession(options);
        });
    }

    /**
     * 获取会话信息
     *
     * 并发安全策略：
     * - 读取操作也需要锁保护，防止读-改-写竞态条件
     * - 保证返回的信息是最新且一致的
     */
    async getSessionInfo(threadId: string): Promise<SessionInfo | null> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.getSessionInfo(threadId);
        });
    }

    /**
     * 更新会话元数据
     *
     * 并发安全策略：
     * - 防止多个并发更新导致的数据不一致
     * - 保证读-改-写操作的完整性
     * - 避免元数据损坏
     */
    async updateSessionMetadata(
        threadId: string,
        updates: Partial<SessionMetadata>,
        options?: SaveOptions
    ): Promise<SessionMetadata> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.updateSessionMetadata(threadId, updates, options);
        });
    }

    /**
     * 保存检查点
     *
     * 并发安全策略：
     * - 检查点保存涉及多个文件操作，需要原子性
     * - 防止检查点编号冲突
     * - 保证检查点和元数据的一致性
     */
    async saveCheckpoint(
        threadId: string,
        state: AgentState,
        checkpointId?: string
    ): Promise<string> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.saveCheckpoint(threadId, state, checkpointId);
        });
    }

    /**
     * 获取最新检查点
     *
     * 并发安全策略：
     * - 读取最新检查点需要一致性视图
     * - 防止在读取过程中检查点被修改
     */
    async getLatestCheckpoint(threadId: string): Promise<CheckpointRecord | null> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.getLatestCheckpoint(threadId);
        });
    }

    /**
     * 获取指定检查点
     *
     * 并发安全策略：
     * - 保证读取的检查点信息是完整的
     * - 防止检查点在读取过程中被删除或修改
     */
    async getCheckpoint(threadId: string, checkpointId: string): Promise<CheckpointRecord | null> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.getCheckpoint(threadId, checkpointId);
        });
    }

    /**
     * 添加历史记录
     *
     * 并发安全策略：
     * - 消息计数准确性是关键
     * - 防止历史记录丢失或重复
     * - 保证消息顺序的一致性
     */
    async addHistoryRecord(
        threadId: string,
        event: Omit<HistoryRecord, 'timestamp'>
    ): Promise<void> {
        return await this.withSessionLock(threadId, async () => {
            // 复用基础实现，但在锁保护下保证原子性
            await this.sessionManager.addHistoryRecord(threadId, event);
        });
    }

    /**
     * 获取历史记录
     *
     * 并发安全策略：
     * - 保证返回的历史记录是完整和一致的
     * - 防止在读取过程中历史被修改
     */
    async getHistory(threadId: string, options?: QueryOptions): Promise<HistoryRecord[]> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.getHistory(threadId, options);
        });
    }

    /**
     * 列出所有会话
     *
     * 并发安全策略：
     * - 每个会话独立加锁，避免全局锁
     * - 保证会话列表的一致性
     */
    async listSessions(options?: {
        status?: 'active' | 'archived';
        limit?: number;
        offset?: number;
    }): Promise<SessionListResult> {
        // 获取基础会话列表（无锁，因为是只读操作）
        const baseResult = await this.sessionManager.listSessions(options);

        // 为每个会话信息获取加锁，确保数据一致性
        const sessionsWithConsistentData = await Promise.all(
            baseResult.sessions.map(async (sessionInfo) => {
                return await this.withSessionLock(
                    sessionInfo.metadata.thread_id,
                    async () => sessionInfo
                );
            })
        );

        return {
            sessions: sessionsWithConsistentData,
            total: baseResult.total,
            hasMore: baseResult.hasMore
        };
    }

    /**
     * 删除会话
     *
     * 并发安全策略：
     * - 防止并发删除同一个会话
     * - 保证删除操作的完整性
     */
    async deleteSession(threadId: string): Promise<void> {
        return await this.withSessionLock(threadId, async () => {
            await this.sessionManager.deleteSession(threadId);
        });
    }

    /**
     * 归档会话
     */
    async archiveSession(threadId: string): Promise<void> {
        return await this.withSessionLock(threadId, async () => {
            await this.sessionManager.archiveSession(threadId);
        });
    }

    /**
     * 恢复会话
     */
    async restoreSession(threadId: string): Promise<void> {
        return await this.withSessionLock(threadId, async () => {
            await this.sessionManager.restoreSession(threadId);
        });
    }

    /**
     * 获取会话统计信息
     */
    async getSessionStats(threadId: string) {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.getSessionStats(threadId);
        });
    }

    /**
     * 生成会话标题
     */
    async generateSessionTitle(threadId: string): Promise<string> {
        return await this.withSessionLock(threadId, async () => {
            return await this.sessionManager.generateSessionTitle(threadId);
        });
    }

    /**
     * 从消息创建历史记录
     *
     * 说明：纯函数，无副作用，不需要锁保护
     */
    createHistoryFromMessage(
        message: BaseMessage,
        eventType: 'user_message' | 'ai_response'
    ): Omit<HistoryRecord, 'timestamp'> {
        // 纯函数，直接委托给基础实现
        return this.sessionManager.createHistoryFromMessage(message, eventType);
    }

    /**
     * 创建工具调用历史记录
     *
     * 说明：纯函数，无副作用，不需要锁保护
     */
    createToolCallHistory(
        toolName: string,
        args: Record<string, any>,
        result?: any,
        error?: string
    ): Omit<HistoryRecord, 'timestamp'> {
        // 纯函数，直接委托给基础实现
        return this.sessionManager.createToolCallHistory(toolName, args, result, error);
    }

    /**
     * 创建系统总结历史记录
     *
     * 说明：纯函数，无副作用，不需要锁保护
     */
    createSummarizeHistory(
        oldCount: number,
        newCount: number,
        summary: string
    ): Omit<HistoryRecord, 'timestamp'> {
        // 纯函数，直接委托给基础实现
        return this.sessionManager.createSummarizeHistory(oldCount, newCount, summary);
    }

    /**
     * 获取锁状态（用于调试和监控）
     */
    getLockStatus() {
        return this.lockManager.getLockStatus();
    }

    /**
     * 强制释放所有锁（错误恢复）
     */
    forceReleaseAllLocks(): void {
        this.lockManager.forceReleaseAll();
    }
}