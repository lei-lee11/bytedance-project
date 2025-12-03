// 类型定义
export * from './types.js';

// 核心类
export { FileManager } from './fileManager.js';
export { SessionManagerWithLock } from './sessionManagerWithLock.js';
export { HistoryManager } from './historyManager.js';
export { LockManager } from './lockManagerSimple.js';
// export { CheckpointManager } from './checkpointManager.js'; // 已注释，高级检查点功能暂不使用

// LangGraph 适配器
export { LangGraphStorageAdapter, createLangGraphAdapter } from './langgraphAdapter.js';

// 工具函数
export * from './utils.js';

import { SessionManagerWithLock } from './sessionManagerWithLock.js';
import { HistoryManager } from './historyManager.js';
// import { CheckpointManager } from './checkpointManager.js'; // 已注释，使用 SessionManager 的检查点功能
import { FileManager } from './fileManager.js';
import { StorageConfig } from './types.js';

/**
 * 统一的存储系统接口
 * 提供所有存储功能的统一入口
 */
export class StorageSystem {
  private sessionManager: SessionManagerWithLock;
  private historyManager: HistoryManager;
  private fileManager: FileManager;
  private isInitialized = false;

  constructor(config?: Partial<StorageConfig>) {
    this.fileManager = new FileManager(config);
    this.sessionManager = new SessionManagerWithLock(config);
    this.historyManager = new HistoryManager(this.sessionManager);
  }

  /**
   * 初始化存储系统
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.sessionManager.initialize();
    this.isInitialized = true;
  }

  /**
   * 检查是否已初始化
   */
  ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Storage system not initialized. Call initialize() first.');
    }
  }

  // 会话管理
  get sessions() {
    return this.sessionManager;
  }

  // 历史记录管理
  get history() {
    return this.historyManager;
  }

  // 检查点管理 - 直接使用 SessionManager
  get checkpoints() {
    return this.sessionManager;
  }

  // 文件管理
  get files() {
    return this.fileManager;
  }

  /**
   * 获取锁状态（用于调试和监控）
   */
  getLockStatus() {
    return this.sessionManager.getLockStatus();
  }

  /**
   * 强制释放所有锁（错误恢复）
   */
  forceReleaseAllLocks(): void {
    this.sessionManager.forceReleaseAllLocks();
  }

  /**
   * 获取系统统计信息
   */
  async getSystemStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    archivedSessions: number;
    totalCheckpoints: number;
    totalHistoryRecords: number;
    totalStorageSize: number;
    averageSessionAge: number;
  }> {
    this.ensureInitialized();

    const sessionList = await this.sessionManager.listSessions();
    const sessions = sessionList.sessions;

    let totalCheckpoints = 0;
    let totalHistoryRecords = 0;
    let totalStorageSize = 0;
    const ages: number[] = [];

    for (const sessionInfo of sessions) {
      totalCheckpoints += sessionInfo.checkpointCount;
      totalHistoryRecords += sessionInfo.historyCount;

      // 简单的存储大小估算
      const estimatedSize =
        1024 + // metadata
        sessionInfo.checkpointCount * 2048 + // checkpoints
        sessionInfo.historyCount * 512; // history

      totalStorageSize += estimatedSize;
      ages.push(Date.now() - sessionInfo.metadata.created_at);
    }

    const activeSessions = sessions.filter(s => s.metadata.status === 'active').length;
    const archivedSessions = sessions.filter(s => s.metadata.status === 'archived').length;
    const averageSessionAge = ages.length > 0 ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

    return {
      totalSessions: sessions.length,
      activeSessions,
      archivedSessions,
      totalCheckpoints,
      totalHistoryRecords,
      totalStorageSize,
      averageSessionAge
    };
  }

  /**
   * 系统健康检查
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    issues: string[];
    recommendations: string[];
  }> {
    this.ensureInitialized();

    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // 检查存储目录
      const sessionIds = await this.fileManager.listSessions();

      // 检查每个会话的完整性
      for (const threadId of sessionIds) {
        const metadata = await this.fileManager.readMetadata(threadId);
        if (!metadata) {
          issues.push(`会话 ${threadId} 缺少元数据文件`);
          continue;
        }

        const checkpoints = await this.fileManager.readCheckpoints(threadId);
        const history = await this.fileManager.readHistory(threadId);

        // 检查数据一致性
        if (metadata.message_count > 0 && history.length === 0) {
          issues.push(`会话 ${threadId} 元数据显示有消息但历史记录为空`);
        }

        // 检查过大的会话
        const totalSize = JSON.stringify(metadata).length +
          checkpoints.reduce((sum, cp) => sum + JSON.stringify(cp).length, 0) +
          history.reduce((sum, record) => sum + JSON.stringify(record).length, 0);

        if (totalSize > 10 * 1024 * 1024) { // 10MB
          recommendations.push(`会话 ${threadId} 占用空间较大 (${(totalSize / 1024 / 1024).toFixed(2)}MB)，建议清理旧数据`);
        }

        // 检查检查点数量
        if (checkpoints.length > 100) {
          recommendations.push(`会话 ${threadId} 检查点数量过多 (${checkpoints.length})，建议清理旧检查点`);
        }

        // 检查历史记录数量
        if (history.length > 5000) {
          recommendations.push(`会话 ${threadId} 历史记录数量过多 (${history.length})，建议清理旧历史记录`);
        }
      }

      // 检查活跃状态
      const systemStats = await this.getSystemStats();
      if (systemStats.totalSessions === 0) {
        recommendations.push('当前没有任何会话，可以开始创建新会话');
      }

      if (systemStats.totalStorageSize > 100 * 1024 * 1024) { // 100MB
        recommendations.push('总存储使用量较大，建议定期清理旧数据');
      }

      if (systemStats.archivedSessions > systemStats.activeSessions * 2) {
        recommendations.push('归档会话数量较多，建议删除不需要的会话');
      }

      // 检查锁状态
      const lockStatus = this.getLockStatus();
      if (lockStatus.totalLocks > 10) {
        recommendations.push(`当前活动锁数量较多 (${lockStatus.totalLocks})，可能存在死锁风险`);
      }

    } catch (error) {
      issues.push(`健康检查过程中发生错误: ${error}`);
      return {
        status: 'error',
        issues,
        recommendations
      };
    }

    const status = issues.length > 0 ? 'error' :
                  recommendations.length > 3 ? 'warning' : 'healthy';

    return {
      status,
      issues,
      recommendations
    };
  }

  /**
   * 执行系统清理
   */
  async cleanup(options: {
    olderThanDays?: number;
    maxHistoryRecords?: number;
    maxCheckpoints?: number;
    deleteArchived?: boolean;
  } = {}): Promise<{
    sessionsCleaned: number;
    historyRecordsDeleted: number;
    checkpointsDeleted: number;
    spaceFreed: number;
  }> {
    this.ensureInitialized();

    const {
      olderThanDays = 30,
      maxHistoryRecords = 1000,
      maxCheckpoints = 50,
      deleteArchived = false
    } = options;

    let sessionsCleaned = 0;
    let historyRecordsDeleted = 0;
    let checkpointsDeleted = 0;
    let spaceFreed = 0;

    const sessionList = await this.sessionManager.listSessions();
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    for (const sessionInfo of sessionList.sessions) {
      const { metadata } = sessionInfo;
      const threadId = metadata.thread_id;

      // 检查是否需要删除归档会话
      if (deleteArchived && metadata.status === 'archived') {
        const stats = await this.fileManager.getSessionStats(threadId);
        spaceFreed += stats.size;
        await this.sessionManager.deleteSession(threadId);
        sessionsCleaned++;
        continue;
      }

      // 清理历史记录
      if (sessionInfo.historyCount > maxHistoryRecords) {
        const historyResult = await this.historyManager.cleanupHistory(
          threadId,
          olderThanDays,
          true // 保留高优先级记录
        );
        historyRecordsDeleted += historyResult.deleted;
      }

      // 清理检查点 - 使用 SessionManager 的基本清理功能
      if (sessionInfo.checkpointCount > maxCheckpoints) {
        // 简单的检查点数量限制，通过文件管理器直接清理
        await this.fileManager.cleanupOldCheckpoints(threadId, maxCheckpoints);
        checkpointsDeleted += Math.max(0, sessionInfo.checkpointCount - maxCheckpoints);
        spaceFreed += Math.max(0, sessionInfo.checkpointCount - maxCheckpoints) * 2048; // 估算大小
      }

      // 对于长时间未更新的会话进行归档
      if (metadata.status === 'active' && metadata.updated_at < cutoffTime) {
        await this.sessionManager.archiveSession(threadId);
        sessionsCleaned++;
      }
    }

    return {
      sessionsCleaned,
      historyRecordsDeleted,
      checkpointsDeleted,
      spaceFreed
    };
  }

  /**
   * 导出所有数据
   */

  async exportAllData(format: 'json' | 'csv' = 'json'): Promise<string> {
    this.ensureInitialized();

    const sessionList = await this.sessionManager.listSessions();
    const sessions = sessionList.sessions;

    if (format === 'json') {
      const exportData = {
        exported_at: Date.now(),
        total_sessions: sessions.length,
        sessions: sessions.map(sessionInfo => ({
          metadata: sessionInfo.metadata,
          checkpoint_count: sessionInfo.checkpointCount,
          history_count: sessionInfo.historyCount,
          has_active_checkpoint: sessionInfo.hasActiveCheckpoint
        }))
      };

      return JSON.stringify(exportData, null, 2);
    } else {
      // CSV 格式导出会话基本信息
      const headers = ['Session ID', 'Title', 'Status', 'Created At', 'Updated At', 'Message Count', 'Checkpoints', 'History Records'];
      const rows = sessions.map(session => [
        session.metadata.thread_id,
        session.metadata.title,
        session.metadata.status,
        new Date(session.metadata.created_at).toISOString(),
        new Date(session.metadata.updated_at).toISOString(),
        session.metadata.message_count.toString(),
        session.checkpointCount.toString(),
        session.historyCount.toString()
      ]);

      return [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    }
  }

  /**
   * 关闭存储系统
   */
  async close(): Promise<void> {
    // 强制释放所有锁，防止资源泄露
    this.forceReleaseAllLocks();
    this.isInitialized = false;
  }
}

/**
 * 创建存储系统实例的便捷函数
 */
export function createStorageSystem(config?: Partial<StorageConfig>): StorageSystem {
  return new StorageSystem(config);
}

/**
 * 默认存储系统实例
 */
export const defaultStorageSystem = createStorageSystem();
