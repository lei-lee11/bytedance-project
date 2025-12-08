import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import {
  SessionMetadata,
  CheckpointRecord,
  HistoryRecord,
  SessionPaths,
  StorageConfig,
  SaveOptions
} from './types.js';

/**
 * 文件系统存储管理器
 * 负责所有文件和目录的读写操作
 */
export class FileManager {
  private basePath: string;

  constructor(config?: Partial<StorageConfig>) {
    // 优先从环境变量读取存储路径
    const envPath = process.env.AI_AGENT_STORAGE_PATH;
    this.basePath = config?.basePath || envPath || path.join(homedir(), '.ai-agent');
  }

  /**
   * 获取会话相关路径
   */
  getSessionPaths(threadId: string): SessionPaths {
    const sessionDir = path.join(this.basePath, 'sessions', threadId);
    return {
      sessionDir,
      metadataPath: path.join(sessionDir, 'metadata.json'),
      checkpointsPath: path.join(sessionDir, 'checkpoints.jsonl'),
      historyPath: path.join(sessionDir, 'history.jsonl'),
    };
  }

  /**
   * 初始化存储目录结构
   */
  async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(path.join(this.basePath, 'sessions'), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to initialize storage: ${error}`);
    }
  }

  /**
   * 检查会话是否存在
   */
  async sessionExists(threadId: string): Promise<boolean> {
    const { metadataPath } = this.getSessionPaths(threadId);
    try {
      await fs.access(metadataPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建新会话目录
   */
  async createSessionDirectory(threadId: string): Promise<void> {
    const { sessionDir } = this.getSessionPaths(threadId);
    await fs.mkdir(sessionDir, { recursive: true });
  }

  /**
   * 读取会话元数据
   */
  async readMetadata(threadId: string): Promise<SessionMetadata | null> {
    const { metadataPath } = this.getSessionPaths(threadId);
    try {
      const content = await fs.readFile(metadataPath, 'utf8');
      const trimmed = content.trim();
      if (!trimmed) {
        // console.warn(`⚠️ Metadata file is empty for session ${threadId}`);
        return null;
      }
      return JSON.parse(trimmed) as SessionMetadata;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      if (error instanceof SyntaxError) {
        // console.warn(`⚠️ Invalid JSON in metadata file for session ${threadId}: ${error.message}`);
        return null;
      }
      throw new Error(`Failed to read metadata for session ${threadId}: ${error}`);
    }
  }

  /**
   * 写入会话元数据
   */
  async writeMetadata(
    threadId: string,
    metadata: SessionMetadata,
    options?: SaveOptions
  ): Promise<void> {
    const { metadataPath } = this.getSessionPaths(threadId);

    // 如果会话不存在，先创建目录
    if (!(await this.sessionExists(threadId))) {
      await this.createSessionDirectory(threadId);
    }

    // 应用保存选项
    const finalMetadata = { ...metadata };
    if (options?.updateTimestamp !== false) {
      finalMetadata.updated_at = Date.now();
    }
    if (options?.updateStatus) {
      finalMetadata.status = options.updateStatus;
    }

    await fs.writeFile(metadataPath, JSON.stringify(finalMetadata, null, 2), 'utf8');
  }

  /**
   * 追加检查点记录
   */
  async appendCheckpoint(threadId: string, checkpoint: CheckpointRecord): Promise<void> {
    const { checkpointsPath } = this.getSessionPaths(threadId);

    // 确保会话目录存在
    if (!(await this.sessionExists(threadId))) {
      await this.createSessionDirectory(threadId);
    }

    const line = JSON.stringify(checkpoint) + '\n';
    await fs.appendFile(checkpointsPath, line, 'utf8');
  }

  /**
   * 读取所有检查点记录
   */
  async readCheckpoints(threadId: string): Promise<CheckpointRecord[]> {
    const { checkpointsPath } = this.getSessionPaths(threadId);
    try {
      const content = await fs.readFile(checkpointsPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line)) as CheckpointRecord[];
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read checkpoints for session ${threadId}: ${error}`);
    }
  }

  /**
   * 读取最新检查点
   */
  async readLatestCheckpoint(threadId: string): Promise<CheckpointRecord | null> {
    const checkpoints = await this.readCheckpoints(threadId);
    if (checkpoints.length === 0) {
      return null;
    }
    return checkpoints[checkpoints.length - 1];
  }

  /**
   * 清理旧检查点（保留最新的N个）
   */
  async cleanupOldCheckpoints(threadId: string, keepCount = 10): Promise<void> {
    const { checkpointsPath } = this.getSessionPaths(threadId);
    const checkpoints = await this.readCheckpoints(threadId);

    if (checkpoints.length <= keepCount) {
      return;
    }

    // 保留最新的检查点
    const keepCheckpoints = checkpoints.slice(-keepCount);
    const content = keepCheckpoints.map(cp => JSON.stringify(cp)).join('\n') + '\n';
    await fs.writeFile(checkpointsPath, content, 'utf8');
}

  /**
   * 追加历史记录
   */
  async appendHistory(threadId: string, record: HistoryRecord): Promise<void> {
    const { sessionDir, historyPath } = this.getSessionPaths(threadId);

    // 确保会话目录存在
    await fs.mkdir(sessionDir, { recursive: true });

    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(historyPath, line, 'utf8');
  }

  /**
   * 读取所有历史记录
   */
  async readHistory(threadId: string): Promise<HistoryRecord[]> {
    const { historyPath } = this.getSessionPaths(threadId);
    try {
      const content = await fs.readFile(historyPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line)) as HistoryRecord[];
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read history for session ${threadId}: ${error}`);
    }
  }

  /**
   * 清理旧历史记录（保留最新的N条）
   */
  async cleanupOldHistory(threadId: string, keepCount = 1000): Promise<void> {
    const { historyPath } = this.getSessionPaths(threadId);
    const history = await this.readHistory(threadId);

    if (history.length <= keepCount) {
      return;
    }

    // 保留最新的历史记录
    const keepHistory = history.slice(-keepCount);
    const content = keepHistory.map(record => JSON.stringify(record)).join('\n') + '\n';
    await fs.writeFile(historyPath, content, 'utf8');
}

  /**
   * 删除会话
   */
  async deleteSession(threadId: string): Promise<void> {
    const { sessionDir } = this.getSessionPaths(threadId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to delete session ${threadId}: ${error}`);
    }
  }

  /**
   * 列出所有会话
   */
  async listSessions(): Promise<string[]> {
    const sessionsDir = path.join(this.basePath, 'sessions');
    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list sessions: ${error}`);
    }
  }

  /**
   * 获取会话统计信息
   */
  async getSessionStats(threadId: string): Promise<{
    checkpointsCount: number;
    historyCount: number;
    lastModified: number;
    size: number;
  }> {
    const { sessionDir, metadataPath, checkpointsPath, historyPath } = this.getSessionPaths(threadId);

    try {
      const [checkpoints, history] = await Promise.all([
        this.readCheckpoints(threadId),
        this.readHistory(threadId)
      ]);

      // 计算会话文件夹中所有文件的实际大小
      const calculateTotalSize = async (dirPath: string): Promise<number> => {
        try {
          const files = await fs.readdir(dirPath);
          let totalSize = 0;

          for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
              // 递归计算子目录大小
              totalSize += await calculateTotalSize(filePath);
            } else {
              // 累加文件大小
              totalSize += stat.size;
            }
          }

          return totalSize;
        } catch (error) {
          // 如果目录不存在或无法读取，返回 0
          return 0;
        }
      };

      // 计算各文件的大小作为备选方案
      const getFileSize = async (filePath: string): Promise<number> => {
        try {
          const stat = await fs.stat(filePath);
          return stat.size;
        } catch {
          return 0;
        }
      };

      // 优先使用递归计算的总大小，如果失败则使用估算方法
      const totalDirSize = await calculateTotalSize(sessionDir);

      let actualSize = totalDirSize;

      // 如果递归计算结果为0，使用文件大小估算作为备选
      if (actualSize === 0) {
        const [metadataSize, checkpointsSize, historySize] = await Promise.all([
          getFileSize(metadataPath),
          getFileSize(checkpointsPath),
          getFileSize(historyPath)
        ]);

        // 计算文件内容的大致大小
        const checkpointsDataSize = checkpoints.reduce((sum, cp) =>
          sum + JSON.stringify(cp).length, 0) * 2; // UTF-16 编码估算
        const historyDataSize = history.reduce((sum, record) =>
          sum + JSON.stringify(record).length, 0) * 2;

        actualSize = metadataSize + checkpointsSize + historySize + checkpointsDataSize + historyDataSize;
      }

      // 获取最后修改时间
      let lastModified = 0;
      try {
        const dirStats = await fs.stat(sessionDir);
        lastModified = dirStats.mtime.getTime();
      } catch {
        // 如果无法获取目录状态，使用文件的最大修改时间
        const fileStats = await Promise.allSettled([
          fs.stat(metadataPath),
          fs.stat(checkpointsPath),
          fs.stat(historyPath)
        ]);

        for (const result of fileStats) {
          if (result.status === 'fulfilled') {
            lastModified = Math.max(lastModified, result.value.mtime.getTime());
          }
        }
      }

      return {
        checkpointsCount: checkpoints.length,
        historyCount: history.length,
        lastModified,
        size: actualSize
      };
    } catch (error) {
      throw new Error(`Failed to get session stats for ${threadId}: ${error}`);
    }
  }
}
