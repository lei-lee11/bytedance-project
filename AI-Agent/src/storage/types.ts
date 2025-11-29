import { BaseMessage } from "@langchain/core/messages";

// 会话状态定义
export interface SessionState {
  messages: BaseMessage[];
  summary?: string;
  currentTask?: string;
  codeContext?: string;
  programmingLanguage?: string;
  retryCount?: number;
  reviewResult?: any;
}

// 会话元数据
export interface SessionMetadata {
  thread_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_checkpoint?: string;
  status: 'active' | 'archived' | 'completed';
  programming_language?: string;
  summary?: string;
}

// 检查点记录
export interface CheckpointRecord {
  timestamp: number;
  thread_id: string;
  checkpoint: {
    id: string;
    step: number;
    channel_values: SessionState;
  };
}

// 历史事件类型
export type EventType =
  | 'user_message'
  | 'ai_response'
  | 'tool_call'
  | 'system_summarize'
  | 'error'
  | 'session_created'
  | 'session_updated';

// 历史事件记录
export interface HistoryRecord {
  timestamp: number;
  event_type: EventType;
  content: string;
  display_priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

// 工具调用结果记录
export interface ToolCallRecord extends HistoryRecord {
  event_type: 'tool_call';
  tool_name: string;
  args?: Record<string, any>;
  result?: any;
  error?: string;
}

// 系统总结记录
export interface SystemSummarizeRecord extends HistoryRecord {
  event_type: 'system_summarize';
  old_message_count: number;
  new_message_count: number;
  summary_length: number;
}

// 会话信息
export interface SessionInfo {
  metadata: SessionMetadata;
  hasActiveCheckpoint: boolean;
  checkpointCount: number;
  historyCount: number;
}

// 存储配置
export interface StorageConfig {
  basePath: string;
  maxHistoryRecords?: number;
  maxCheckpoints?: number;
  autoBackup?: boolean;
}

// 文件路径结构
export interface SessionPaths {
  sessionDir: string;
  metadataPath: string;
  checkpointsPath: string;
  historyPath: string;
}

// 保存选项
export interface SaveOptions {
  updateTimestamp?: boolean;
  incrementMessageCount?: boolean;
  updateStatus?: 'active' | 'archived' | 'completed';
}

// 查询选项
export interface QueryOptions {
  limit?: number;
  offset?: number;
  priority?: 'high' | 'medium' | 'low';
  eventType?: EventType;
  startTime?: number;
  endTime?: number;
}

// 会话列表查询结果
export interface SessionListResult {
  sessions: SessionInfo[];
  total: number;
  hasMore: boolean;
}
