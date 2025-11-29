import { SessionManager } from './sessionManager.js'; // 添加.js扩展名
import {
    CheckpointRecord,
    SessionState
    // 移除未使用的 QueryOptions
} from './types.js'; // 添加.js扩展名
import { BaseMessage } from '@langchain/core/messages';

/**
 * 检查点管理器
 * 提供专门的检查点恢复和状态管理功能
 */
export class CheckpointManager {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    /**
     * 创建检查点
     */
    async createCheckpoint(
        threadId: string,
        state: SessionState,
        metadata?: {
            description?: string;
            stepType?: string;
            node?: string;
            tags?: string[];
        }
    ): Promise<{
        checkpointId: string;
        timestamp: number;
        success: boolean;
    }> {
        try {
            const checkpointId = await this.sessionManager.saveCheckpoint(threadId, state);

            // 记录检查点创建历史
            await this.sessionManager.addHistoryRecord(threadId, {
                event_type: 'tool_call',
                content: metadata?.description || `创建检查点 ${checkpointId}`,
                display_priority: 'medium',
                metadata: {
                    tool_name: 'checkpoint_save',
                    checkpoint_id: checkpointId,
                    step_type: metadata?.stepType,
                    node: metadata?.node,
                    tags: metadata?.tags || [],
                    message_count: state.messages.length
                }
            });

            return {
                checkpointId,
                timestamp: Date.now(),
                success: true
            };
        } catch (error) {
            await this.sessionManager.addHistoryRecord(threadId, {
                event_type: 'error',
                content: `检查点保存失败: ${error}`,
                display_priority: 'high',
                metadata: {
                    error: String(error),
                    step_type: metadata?.stepType,
                    node: metadata?.node
                }
            });

            throw error;
        }
    }

    /**
     * 恢复检查点
     */
    async restoreCheckpoint(threadId: string, checkpointId?: string): Promise<{
        checkpoint: CheckpointRecord | null;
        state: SessionState | null;
        timestamp: number;
        success: boolean;
    }> {
        try {
            const checkpoint = checkpointId
                ? await this.sessionManager.getCheckpoint(threadId, checkpointId)
                : await this.sessionManager.getLatestCheckpoint(threadId);

            if (!checkpoint) {
                return {
                    checkpoint: null,
                    state: null,
                    timestamp: Date.now(),
                    success: false
                };
            }

            // 记录恢复操作
            await this.sessionManager.addHistoryRecord(threadId, {
                event_type: 'tool_call',
                content: `恢复检查点 ${checkpoint.checkpoint.id}`,
                display_priority: 'medium',
                metadata: {
                    tool_name: 'checkpoint_restore',
                    checkpoint_id: checkpoint.checkpoint.id,
                    step: checkpoint.checkpoint.step,
                    message_count: checkpoint.checkpoint.channel_values.messages.length
                }
            });

            return {
                checkpoint,
                state: checkpoint.checkpoint.channel_values,
                timestamp: Date.now(),
                success: true
            };
        } catch (error) {
            await this.sessionManager.addHistoryRecord(threadId, {
                event_type: 'error',
                content: `检查点恢复失败: ${error}`,
                display_priority: 'high',
                metadata: {
                    error: String(error),
                    checkpoint_id: checkpointId
                }
            });

            throw error;
        }
    }

    /**
     * 获取所有检查点列表
     */
    async listCheckpoints(threadId: string): Promise<Array<{
        id: string;
        step: number;
        timestamp: number;
        messageCount: number;
        hasSummary: boolean;
        currentTask?: string;
        programmingLanguage?: string;
    }>> {
        const checkpoints = await this.sessionManager.getHistory(threadId, {
            eventType: 'tool_call'
        });

        const checkpointRecords = checkpoints
            .filter(record => record.metadata?.tool_name === 'checkpoint_save')
            .map(record => {
                const metadata = record.metadata || {};
                return {
                    id: metadata.checkpoint_id,
                    step: metadata.step || 0,
                    timestamp: record.timestamp,
                    messageCount: metadata.message_count || 0,
                    hasSummary: false, // 将在下面更新
                    currentTask: '',
                    programmingLanguage: ''
                };
            });

        // 按时间戳排序
        return checkpointRecords.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * 比较两个检查点
     */
    async compareCheckpoints(
        threadId: string,
        checkpointId1: string,
        checkpointId2: string
    ): Promise<{
        checkpoint1: CheckpointRecord | null;
        checkpoint2: CheckpointRecord | null;
        differences: {
            messageCountChange: number;
            newMessages: BaseMessage[];
            stateChanges: Array<{
                field: string;
                oldValue: any;
                newValue: any;
            }>;
        };
    }> {
        const [cp1, cp2] = await Promise.all([
            this.sessionManager.getCheckpoint(threadId, checkpointId1),
            this.sessionManager.getCheckpoint(threadId, checkpointId2)
        ]);

        if (!cp1 || !cp2) {
            throw new Error('One or both checkpoints not found');
        }

        const state1 = cp1.checkpoint.channel_values;
        const state2 = cp2.checkpoint.channel_values;

        // 比较消息数量
        const messageCountChange = state2.messages.length - state1.messages.length;

        // 找出新消息
        const newMessages = state2.messages.slice(state1.messages.length);

        // 比较状态字段
        const stateChanges: Array<{
            field: string;
            oldValue: any;
            newValue: any;
        }> = [];

        const fieldsToCompare = ['currentTask', 'codeContext', 'programmingLanguage', 'summary'] as const;
        for (const field of fieldsToCompare) {
            const oldValue = state1[field];
            const newValue = state2[field];
            if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                stateChanges.push({ field, oldValue, newValue });
            }
        }

        return {
            checkpoint1: cp1,
            checkpoint2: cp2,
            differences: {
                messageCountChange,
                newMessages,
                stateChanges
            }
        };
    }

    /**
     * 获取检查点时间线
     */
    async getCheckpointTimeline(threadId: string): Promise<Array<{
        timestamp: number;
        checkpointId: string;
        step: number;
        description: string;
        state: {
            messageCount: number;
            currentTask?: string;
            programmingLanguage?: string;
            hasSummary: boolean;
        };
        event?: string;
    }>> {
        const history = await this.sessionManager.getHistory(threadId);

        // 提取检查点相关事件
        const timeline: Array<{
            timestamp: number;
            checkpointId: string;
            step: number;
            description: string;
            state: {
                messageCount: number;
                currentTask?: string;
                programmingLanguage?: string;
                hasSummary: boolean;
            };
            event?: string;
        }> = [];

        for (const record of history) {
            if (record.event_type === 'tool_call' && record.metadata?.tool_name === 'checkpoint_save') {
                const checkpointId = record.metadata.checkpoint_id;
                const checkpoint = await this.sessionManager.getCheckpoint(threadId, checkpointId);

                if (checkpoint) {
                    const state = checkpoint.checkpoint.channel_values;
                    timeline.push({
                        timestamp: record.timestamp,
                        checkpointId,
                        step: checkpoint.checkpoint.step,
                        description: record.content,
                        state: {
                            messageCount: state.messages.length,
                            currentTask: state.currentTask,
                            programmingLanguage: state.programmingLanguage,
                            hasSummary: !!state.summary
                        },
                        event: 'checkpoint_created'
                    });
                }
            } else if (record.event_type === 'tool_call' && record.metadata?.tool_name === 'checkpoint_restore') {
                timeline.push({
                    timestamp: record.timestamp,
                    checkpointId: record.metadata.checkpoint_id,
                    step: -1, // 表示恢复操作
                    description: record.content,
                    state: {
                        messageCount: 0,
                        hasSummary: false
                    },
                    event: 'checkpoint_restored'
                });
            }
        }

        return timeline.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * 清理旧检查点
     */
    async cleanupCheckpoints(
        threadId: string,
        options: {
            keepCount?: number;
            olderThanDays?: number;
            keepLatest?: boolean;
        } = {}
    ): Promise<{
        deletedCount: number;
        keptCount: number;
        totalSpaceFreed: number;
    }> {
        const {
            keepCount = 10,
            olderThanDays,
            keepLatest = true
        } = options;

        const timeline = await this.getCheckpointTimeline(threadId);
        const now = Date.now();
        const cutoffTime = olderThanDays ? now - (olderThanDays * 24 * 60 * 60 * 1000) : 0;

        const toDelete: Array<{ checkpointId: string; size: number }> = [];
        let toKeep: Array<{ checkpointId: string; size: number }> = []; // 改为 let

        for (const item of timeline) {
            const isOld = item.timestamp < cutoffTime;
            const shouldDelete = isOld && (!keepLatest || item.event !== 'checkpoint_restored');

            const estimatedSize = JSON.stringify(item).length;

            if (shouldDelete) {
                toDelete.push({ checkpointId: item.checkpointId, size: estimatedSize });
            } else {
                toKeep.push({ checkpointId: item.checkpointId, size: estimatedSize });
            }
        }

        // 如果指定了保留数量，只保留最新的N个
        if (keepCount && toKeep.length > keepCount) {
            const toDeleteFromKeep = toKeep.slice(keepCount);
            toDelete.push(...toDeleteFromKeep);
            toKeep = toKeep.slice(0, keepCount); // 现在可以正常赋值
        }

        const totalSpaceFreed = toDelete.reduce((sum, item) => sum + item.size, 0);

        return {
            deletedCount: toDelete.length,
            keptCount: toKeep.length,
            totalSpaceFreed
        };
    }

    /**
     * 导出检查点
     */
    async exportCheckpoint(
        threadId: string,
        checkpointId: string,
        format: 'json' | 'state' = 'json'
    ): Promise<string> {
        const checkpoint = await this.sessionManager.getCheckpoint(threadId, checkpointId);
        if (!checkpoint) {
            throw new Error(`Checkpoint ${checkpointId} not found`);
        }

        switch (format) {
            case 'json':
                return JSON.stringify({
                    checkpoint,
                    exported_at: Date.now(),
                    exported_by: 'checkpoint_manager'
                }, null, 2);

            case 'state':
                return JSON.stringify(checkpoint.checkpoint.channel_values, null, 2);

            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
     * 导入检查点
     */
    async importCheckpoint(
        targetThreadId: string,
        checkpointData: string,
        format: 'json' | 'state' = 'json'
    ): Promise<{
        checkpointId: string;
        success: boolean;
        messageCount: number;
    }> {
        try {
            let state: SessionState;
            let checkpointId: string;

            if (format === 'json') {
                const imported = JSON.parse(checkpointData);
                state = imported.checkpoint.checkpoint.channel_values;
                checkpointId = `imported_${imported.checkpoint.checkpoint.id}_${Date.now()}`;
            } else {
                state = JSON.parse(checkpointData);
                checkpointId = `imported_${Date.now()}`;
            }

            // 保存导入的检查点
            await this.sessionManager.saveCheckpoint(targetThreadId, state, checkpointId);

            // 记录导入操作
            await this.sessionManager.addHistoryRecord(targetThreadId, {
                event_type: 'tool_call',
                content: `导入检查点 ${checkpointId}`,
                display_priority: 'medium',
                metadata: {
                    tool_name: 'checkpoint_import',
                    checkpoint_id: checkpointId,
                    message_count: state.messages.length,
                    import_format: format
                }
            });

            return {
                checkpointId,
                success: true,
                messageCount: state.messages.length
            };
        } catch (error) {
            throw new Error(`Failed to import checkpoint: ${error}`);
        }
    }

    /**
     * 获取检查点统计信息
     */
    async getCheckpointStats(threadId: string): Promise<{
        totalCheckpoints: number;
        firstCheckpoint: number | null;
        lastCheckpoint: number | null;
        averageStateSize: number;
        checkpointFrequency: number; // 每小时平均检查点数量
        largestCheckpoint: {
            id: string;
            size: number;
            timestamp: number;
        } | null;
    }> {
        const timeline = await this.getCheckpointTimeline(threadId);
        const createdCheckpoints = timeline.filter(item => item.event === 'checkpoint_created');

        if (createdCheckpoints.length === 0) {
            return {
                totalCheckpoints: 0,
                firstCheckpoint: null,
                lastCheckpoint: null,
                averageStateSize: 0,
                checkpointFrequency: 0,
                largestCheckpoint: null
            };
        }

        const timestamps = createdCheckpoints.map(item => item.timestamp);
        const firstCheckpoint = Math.min(...timestamps);
        const lastCheckpoint = Math.max(...timestamps);
        const timeSpan = (lastCheckpoint - firstCheckpoint) / (1000 * 60 * 60); // 小时

        // 计算平均状态大小
        const stateSizes = createdCheckpoints.map(item => JSON.stringify(item.state).length);
        const averageStateSize = stateSizes.reduce((sum, size) => sum + size, 0) / stateSizes.length;

        // 找出最大的检查点
        const largestIndex = stateSizes.indexOf(Math.max(...stateSizes));
        const largestCheckpoint = {
            id: createdCheckpoints[largestIndex].checkpointId,
            size: stateSizes[largestIndex],
            timestamp: createdCheckpoints[largestIndex].timestamp
        };

        return {
            totalCheckpoints: createdCheckpoints.length,
            firstCheckpoint,
            lastCheckpoint,
            averageStateSize,
            checkpointFrequency: timeSpan > 0 ? createdCheckpoints.length / timeSpan : 0,
            largestCheckpoint
        };
    }
}
