import { BaseMessage } from "@langchain/core/messages";

// 项目/用户画像类型，用于描述项目内使用的语言和测试命令提示
export interface ProjectProfile {
  detectedLanguages: string[];
  testCommand?: string;
  testFrameworkHint?: string;
}

// 完整的 Agent 状态（与 agent/state.ts 中的 AgentState 保持一致）
export interface AgentState {
  messages: BaseMessage[];
  summary: string;
  projectRoot: string;
  projectTreeInjected: boolean;
  projectTreeText: string;
  projectPlanText: string;
  techStackSummary: string;
  projectInitSteps: string[];
  todos: string[];
  currentTodoIndex: number;
  pendingFilePaths: string[];
  taskStatus: "planning" | "executing" | "completed";
  taskCompleted: boolean;
  iterationCount: number;
  maxIterations: number;
  pendingToolCalls: any[];
  error: string;
  demoMode: boolean;
}

// 会话元数据
export interface SessionMetadata {
  thread_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_checkpoint?: string;
  status: 'active' | 'archived';
}

// 检查点记录（仅支持 AgentState）
export interface CheckpointRecord {
  timestamp: number;
  thread_id: string;
  checkpoint: {
    id: string;
    step: number;
    channel_values: AgentState;
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
  updateStatus?: 'active' | 'archived';
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

// 会话管理器接口 - 抽象 SessionManager 和 SessionManagerWithLock 的公共接口
export interface ISessionManager {
  initialize(): Promise<void>;
  createSession(options?: {
    title?: string;
    programmingLanguage?: string;
    initialMessage?: string;
  }): Promise<{ threadId: string; metadata: SessionMetadata }>;
  getSessionInfo(threadId: string): Promise<SessionInfo | null>;
  updateSessionMetadata(
    threadId: string,
    updates: Partial<SessionMetadata>,
    options?: SaveOptions
  ): Promise<SessionMetadata>;
  saveCheckpoint(
    threadId: string,
    state: AgentState,
    checkpointId?: string
  ): Promise<string>;
  getLatestCheckpoint(threadId: string): Promise<CheckpointRecord | null>;
  getCheckpoint(threadId: string, checkpointId: string): Promise<CheckpointRecord | null>;
  addHistoryRecord(
    threadId: string,
    event: Omit<HistoryRecord, 'timestamp'>
  ): Promise<void>;
  getHistory(threadId: string, options?: QueryOptions): Promise<HistoryRecord[]>;
  listSessions(options?: {
    status?: 'active' | 'archived';
    limit?: number;
    offset?: number;
  }): Promise<SessionListResult>;
  deleteSession(threadId: string): Promise<void>;
  archiveSession(threadId: string): Promise<void>;
  restoreSession(threadId: string): Promise<void>;
  getSessionStats(threadId: string): Promise<any>;
  generateSessionTitle(threadId: string): Promise<string>;
}
