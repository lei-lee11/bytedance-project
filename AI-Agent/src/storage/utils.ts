import { randomBytes } from 'crypto';
import path from 'path';
import { homedir } from 'os';
import {
  SessionMetadata,
  HistoryRecord,
  CheckpointRecord
} from './types.js';

/**
 * 生成会话ID
 */
export function generateThreadId(prefix = 'cli'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(3).toString('hex');
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * 格式化时间戳
 */
export function formatTimestamp(
  timestamp: number,
  format: 'full' | 'date' | 'time' | 'relative' = 'full'
): string {
  const date = new Date(timestamp);

  switch (format) {
    case 'full':
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    case 'date':
      return date.toLocaleDateString('zh-CN');
    case 'time':
      return date.toLocaleTimeString('zh-CN');
    case 'relative': { // 添加大括号形成块级作用域
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}天前`;
      if (hours > 0) return `${hours}小时前`;
      if (minutes > 0) return `${minutes}分钟前`;
      return '刚刚';
    } // 闭合大括号
    default:
      return date.toLocaleString();
  }
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 获取默认存储路径
 */
export function getDefaultStoragePath(): string {
  return path.join(homedir(), '.ai-agent');
}

/**
 * 验证会话ID格式
 */
export function isValidThreadId(threadId: string): boolean {
  // 基本格式验证：prefix-timestamp-random (例如: cli-1k8f9m2-a1b2c3)
  const pattern = /^[a-zA-Z0-9-]+$/;
  return pattern.test(threadId) && threadId.length >= 8 && threadId.length <= 64;
}

/**
 * 验证元数据
 */
export function validateSessionMetadata(metadata: Partial<SessionMetadata>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!metadata.thread_id) {
    errors.push('thread_id is required');
  } else if (!isValidThreadId(metadata.thread_id)) {
    errors.push('thread_id format is invalid');
  }

  if (!metadata.title || metadata.title.trim().length === 0) {
    errors.push('title is required');
  } else if (metadata.title.length > 200) {
    errors.push('title is too long (max 200 characters)');
  }

  if (metadata.created_at && (metadata.created_at < 0 || metadata.created_at > Date.now() + 86400000)) {
    errors.push('created_at is invalid');
  }

  if (metadata.updated_at && metadata.updated_at < 0) {
    errors.push('updated_at is invalid');
  }

  if (metadata.status && !['active', 'archived'].includes(metadata.status)) {
    errors.push('status must be one of: active, archived');
  }

  if (metadata.message_count !== undefined && metadata.message_count < 0) {
    errors.push('message_count must be non-negative');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * 验证历史记录
 */
export function validateHistoryRecord(record: Partial<HistoryRecord>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!record.event_type) {
    errors.push('event_type is required');
  } else if (!['user_message', 'ai_response', 'tool_call', 'system_summarize', 'error', 'session_created', 'session_updated'].includes(record.event_type)) {
    errors.push('event_type is invalid');
  }

  if (!record.content || record.content.trim().length === 0) {
    errors.push('content is required');
  } else if (record.content.length > 10000) {
    errors.push('content is too long (max 10000 characters)');
  }

  if (record.display_priority && !['high', 'medium', 'low'].includes(record.display_priority)) {
    errors.push('display_priority must be one of: high, medium, low');
  }

  if (record.timestamp && (record.timestamp < 0 || record.timestamp > Date.now() + 86400000)) {
    errors.push('timestamp is invalid');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * 清理和标准化字符串
 */
export function sanitizeString(str: string, maxLength = 1000): string {
  return str
    .trim()
    .replace(/[\p{Cc}\p{Cf}]/gu, '') // \p{Cc} = 控制字符，\p{Cf} = 格式字符
    .substring(0, maxLength);
}

/**
 * 生成会话摘要
 */
export function generateSessionSummary(
  history: HistoryRecord[],
  maxLength = 200 // 移除 number 类型注解
): string {
  if (history.length === 0) {
    return '空会话';
  }

  // 获取高优先级的记录
  const highPriorityRecords = history
    .filter(record => record.display_priority === 'high')
    .slice(0, 3);

  if (highPriorityRecords.length > 0) {
    const firstMessage = highPriorityRecords[0].content;
    const preview = firstMessage.length > maxLength
      ? firstMessage.substring(0, maxLength - 3) + '...'
      : firstMessage;
    return preview;
  }

  // 如果没有高优先级记录，使用第一条记录
  const firstRecord = history[0];
  return firstRecord.content.length > maxLength
    ? firstRecord.content.substring(0, maxLength - 3) + '...'
    : firstRecord.content;
}

/**
 * 计算会话统计信息
 */
export function calculateSessionStats(history: HistoryRecord[]): {
  totalRecords: number;
  userMessages: number;
  aiResponses: number;
  toolCalls: number;
  errors: number;
  systemOperations: number;
  averageRecordLength: number;
  oldestRecord: number | null;
  newestRecord: number | null;
  activitySpan: number; // 毫秒
} {
  const stats = {
    totalRecords: history.length,
    userMessages: 0,
    aiResponses: 0,
    toolCalls: 0,
    errors: 0,
    systemOperations: 0,
    averageRecordLength: 0,
    oldestRecord: null as number | null,
    newestRecord: null as number | null,
    activitySpan: 0
  };

  if (history.length === 0) {
    return stats;
  }

  let totalLength = 0;
  const timestamps: number[] = [];

  for (const record of history) {
    totalLength += record.content.length;
    timestamps.push(record.timestamp);

    switch (record.event_type) {
      case 'user_message':
        stats.userMessages++;
        break;
      case 'ai_response':
        stats.aiResponses++;
        break;
      case 'tool_call':
        stats.toolCalls++;
        break;
      case 'error':
        stats.errors++;
        break;
      case 'system_summarize':
        stats.systemOperations++;
        break;
    }
  }

  stats.averageRecordLength = Math.round(totalLength / history.length);
  stats.oldestRecord = Math.min(...timestamps);
  stats.newestRecord = Math.max(...timestamps);
  stats.activitySpan = stats.newestRecord - stats.oldestRecord;

  return stats;
}

/**
 * 深度克隆对象
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const cloned = {} as T;
    for (const key in obj) {
      // 使用 Object.prototype.hasOwnProperty.call 替代直接调用
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  return obj;
}

/**
 * 创建安全的JSON字符串
 */
export function safeStringify(obj: any, indent?: number): string {
  try {
    return JSON.stringify(obj, (_key, value) => { // 用 _key 表示未使用的参数
      // 处理循环引用
      if (typeof value === 'object' && value !== null) {
        if (value.constructor === Object || Array.isArray(value)) {
          return value;
        }
        return '[Object]';
      }
      return value;
    }, indent);
  } catch (error) {
    return JSON.stringify({ error: 'Failed to stringify object' });
  }
}

/**
 * 生成唯一的消息ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * 提取消息内容摘要
 */
export function extractMessagePreview(content: string, maxLength = 50): string {
  if (content.length <= maxLength) {
    return content;
  }

  // 尝试在单词边界截断
  const truncated = content.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = Math.max(lastSpace, lastNewline);

  if (cutPoint > maxLength * 0.7) {
    return truncated.substring(0, cutPoint) + '...';
  }

  return truncated + '...';
}

/**
 * 检查会话是否活跃
 */
export function isSessionActive(
  metadata: SessionMetadata,
  inactiveThresholdMs: number = 24 * 60 * 60 * 1000 // 24小时
): boolean {
  if (metadata.status !== 'active') {
    return false;
  }

  const timeSinceUpdate = Date.now() - metadata.updated_at;
  return timeSinceUpdate < inactiveThresholdMs;
}

/**
 * 生成会话标题建议
 */
export function suggestSessionTitle(
  history: HistoryRecord[],
  maxLength = 50 // 移除 number 类型注解
): string {
  const userMessages = history
    .filter(record => record.event_type === 'user_message')
    .slice(0, 3);

  if (userMessages.length === 0) {
    return '新会话';
  }

  const firstMessage = userMessages[0].content;
  const cleaned = sanitizeString(firstMessage, maxLength);
  return extractMessagePreview(cleaned, maxLength);
}

/**
 * 计算存储空间使用情况
 */
export function calculateStorageUsage(
  metadata: SessionMetadata,
  checkpoints: CheckpointRecord[],
  history: HistoryRecord[]
): {
  metadataSize: number;
  checkpointsSize: number;
  historySize: number;
  totalSize: number;
  checkpointCount: number;
  historyCount: number;
} {
  const metadataSize = JSON.stringify(metadata).length;
  const checkpointsSize = checkpoints.reduce((sum, cp) => sum + JSON.stringify(cp).length, 0);
  const historySize = history.reduce((sum, record) => sum + JSON.stringify(record).length, 0);
  const totalSize = metadataSize + checkpointsSize + historySize;

  return {
    metadataSize,
    checkpointsSize,
    historySize,
    totalSize,
    checkpointCount: checkpoints.length,
    historyCount: history.length
  };
}
