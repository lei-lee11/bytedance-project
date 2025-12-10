import { v4 as uuidv4 } from 'uuid';
import { FileManager } from './fileManager.js';
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
import { join } from 'path'; // 需要导入 path 模块

/**
 * 会话管理器
 * 负责管理所有会话的生命周期
 */
export class SessionManager implements ISessionManager {
    private fileManager: FileManager;
    private config: StorageConfig;

    constructor(config?: Partial<StorageConfig>) {
        this.config = {
            // 默认在项目根目录下创建 ai-agent-storage 文件夹
            basePath: process.env.AI_AGENT_STORAGE_PATH || join(process.cwd(), 'ai-agent-storage'),
            maxHistoryRecords: 1000,
            maxCheckpoints: 100,
            ...config
        };

        this.fileManager = new FileManager(this.config);
    }

    /**
     * 初始化存储系统
     */
    async initialize(): Promise<void> {
        await this.fileManager.initializeStorage();
    }

    /**
     * 创建新会话
     */
    async createSession(options: {
        title?: string;
        programmingLanguage?: string;
        initialMessage?: string;
    } = {}): Promise<{ threadId: string; metadata: SessionMetadata }> {
        const threadId = `cli-session-${uuidv4().slice(0, 8)}`;
        const now = Date.now();

        const metadata: SessionMetadata = {
            thread_id: threadId,
            title: options.title || ' ',
            created_at: now,
            updated_at: now,
            message_count: 0,
            status: 'active',
        };

        // 保存元数据
        await this.fileManager.writeMetadata(threadId, metadata);

        // 如果有初始消息，添加到历史记录
        if (options.initialMessage) {
            const historyRecord: HistoryRecord = {
                timestamp: now,
                event_type: 'session_created',
                content: options.initialMessage,
                display_priority: 'low',
                metadata: {
                    title: metadata.title,
                    programming_language: options.programmingLanguage
                }
            };
            await this.fileManager.appendHistory(threadId, historyRecord);
        }

        return { threadId, metadata };
    }

    /**
     * 获取会话信息
     */
    async getSessionInfo(threadId: string): Promise<SessionInfo | null> {
        if (!(await this.fileManager.sessionExists(threadId))) {
            return null;
        }

        const [metadata, checkpoints, history] = await Promise.all([
            this.fileManager.readMetadata(threadId),
            this.fileManager.readCheckpoints(threadId),
            this.fileManager.readHistory(threadId)
        ]);

        return {
            metadata: metadata!,
            hasActiveCheckpoint: checkpoints.length > 0,
            checkpointCount: checkpoints.length,
            historyCount: history.length,
        };
    }

    /**
     * 更新会话元数据
     */
    async updateSessionMetadata(
        threadId: string,
        updates: Partial<SessionMetadata>,
        options?: SaveOptions
    ): Promise<SessionMetadata> {
        const existing = await this.fileManager.readMetadata(threadId);
        if (!existing) {
            throw new Error(`Session ${threadId} not found`);
        }

        const updated = { ...existing, ...updates };
        await this.fileManager.writeMetadata(threadId, updated, options);
        return updated;
    }

    /**
     * 保存检查点（支持完整的 AgentState）
     */
    async saveCheckpoint(
        threadId: string,
        state: AgentState,
        checkpointId?: string
    ): Promise<string> {
        const now = Date.now();
        const cpId = checkpointId || `agent_ckpt_${String(now).slice(-6)}`;

        // 获取当前检查点数量
        const existingCheckpoints = await this.fileManager.readCheckpoints(threadId);
        const step = existingCheckpoints.length + 1;

        const checkpointRecord: CheckpointRecord = {
            timestamp: now,
            thread_id: threadId,
            checkpoint: {
                id: cpId,
                step,
                channel_values: state
            }
        };

        await this.fileManager.appendCheckpoint(threadId, checkpointRecord);

        // 更新会话元数据中的最后检查点
        await this.updateSessionMetadata(threadId, {
            last_checkpoint: cpId
        }, { updateTimestamp: true });

        // 清理旧检查点
        if (this.config.maxCheckpoints) {
            await this.fileManager.cleanupOldCheckpoints(threadId, this.config.maxCheckpoints);
        }

        return cpId;
    }

    /**
     * 获取最新检查点
     */
    async getLatestCheckpoint(threadId: string): Promise<CheckpointRecord | null> {
        return await this.fileManager.readLatestCheckpoint(threadId);
    }

    /**
     * 获取指定检查点
     */
    async getCheckpoint(threadId: string, checkpointId: string): Promise<CheckpointRecord | null> {
        const checkpoints = await this.fileManager.readCheckpoints(threadId);
        return checkpoints.find(cp => cp.checkpoint.id === checkpointId) || null;
    }

    /**
     * 添加历史记录
     */
    async addHistoryRecord(
        threadId: string,
        event: Omit<HistoryRecord, 'timestamp'>
    ): Promise<void> {
        const historyRecord: HistoryRecord = {
            ...event,
            timestamp: Date.now()
        };

        await this.fileManager.appendHistory(threadId, historyRecord);

        // 更新消息计数 - 修复逻辑，避免重复计数
        const metadata = await this.fileManager.readMetadata(threadId);
        if (metadata) {
            // 获取所有历史记录，计算实际的用户消息和AI回复数量
            const allHistory = await this.fileManager.readHistory(threadId);
            const userMessages = allHistory.filter(record => record.event_type === 'user_message');
            const aiMessages = allHistory.filter(record => record.event_type === 'ai_response');

            // 基于实际的历史记录数更新计数，而不是简单+1
            const actualMessageCount = userMessages.length + aiMessages.length;

            await this.updateSessionMetadata(threadId, {
                message_count: actualMessageCount,
                updated_at: Date.now()
            });
        }

        // 清理旧历史记录
        if (this.config.maxHistoryRecords) {
            await this.fileManager.cleanupOldHistory(threadId, this.config.maxHistoryRecords);
        }
    }

    /**
     * 获取历史记录
     */
    async getHistory(threadId: string, options?: QueryOptions): Promise<HistoryRecord[]> {
        let history = await this.fileManager.readHistory(threadId);

        // 应用过滤器
        if (options) {
            if (options.priority) {
                history = history.filter(record => record.display_priority === options.priority);
            }

            if (options.eventType) {
                history = history.filter(record => record.event_type === options.eventType);
            }

            if (options.startTime) {
                history = history.filter(record => record.timestamp >= options.startTime!);
            }

            if (options.endTime) {
                history = history.filter(record => record.timestamp <= options.endTime!);
            }

            // 应用分页
            if (options.offset) {
                history = history.slice(options.offset);
            }

            if (options.limit) {
                history = history.slice(0, options.limit);
            }
        }

        return history.sort((a, b) => b.timestamp - a.timestamp); // 最新的在前
    }

    /**
     * 列出所有会话
     */
    async listSessions(options: {
        status?: 'active' | 'archived';
        limit?: number;
        offset?: number;
    } = {}): Promise<SessionListResult> {
        const threadIds = await this.fileManager.listSessions();
        const sessions: SessionInfo[] = [];

        for (const threadId of threadIds) {
            const sessionInfo = await this.getSessionInfo(threadId);
            if (sessionInfo) {
                // 应用状态过滤
                if (options.status && sessionInfo.metadata.status !== options.status) {
                    continue;
                }
                sessions.push(sessionInfo);
            }
        }

        // 按更新时间排序
        sessions.sort((a, b) => b.metadata.updated_at - a.metadata.updated_at);

        // 应用分页
        const { offset = 0, limit = 50 } = options;
        const startIndex = offset;
        const endIndex = offset + limit;
        const paginatedSessions = sessions.slice(startIndex, endIndex);

        return {
            sessions: paginatedSessions,
            total: sessions.length,
            hasMore: endIndex < sessions.length
        };
    }

    /**
     * 删除会话
     */
    async deleteSession(threadId: string): Promise<void> {
        const exists = await this.fileManager.sessionExists(threadId);
        if (!exists) {
            throw new Error(`Session ${threadId} not found`);
        }

        await this.fileManager.deleteSession(threadId);
    }

    /**
     * 归档会话
     */
    async archiveSession(threadId: string): Promise<void> {
        await this.updateSessionMetadata(threadId, {
            status: 'archived'
        }, { updateStatus: 'archived' });
    }

    /**
     * 恢复会话
     */
    async restoreSession(threadId: string): Promise<void> {
        await this.updateSessionMetadata(threadId, {
            status: 'active'
        }, { updateStatus: 'active' });
    }

    /**
     * 获取会话统计信息
     */
    async getSessionStats(threadId: string) {
        if (!(await this.fileManager.sessionExists(threadId))) {
            throw new Error(`Session ${threadId} not found`);
        }

        return await this.fileManager.getSessionStats(threadId);
    }

    /**
     * 生成会话标题（基于第一条用户消息）
     */
    async generateSessionTitle(threadId: string): Promise<string> {
        const history = await this.getHistory(threadId, {
            eventType: 'user_message',
            limit: 1
        });

        if (history.length === 0) {
            return '新会话';
        }

        const firstMessage = history[0].content;
        // 截取前50个字符作为标题
        const title = firstMessage.length > 50
            ? firstMessage.substring(0, 47) + '...'
            : firstMessage;

        // 更新元数据
        await this.updateSessionMetadata(threadId, { title });

        return title;
    }

}
