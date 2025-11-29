# AI Agent 三层存储系统

这个模块实现了一个完整的三层文件架构的会话存储系统，用于持久化 AI Agent 的对话状态。

## 文件结构

```
~/.ai-agent/
├── sessions/
│   └── {threadId}/
│       ├── metadata.json          # 会话概览信息
│       ├── checkpoints.jsonl      # LangGraph 检查点（完整状态）
│       └── history.jsonl          # 完整的用户交互历史
```

## 快速开始

```typescript
import { StorageSystem, createStorageSystem } from './index';

// 创建存储系统
const storage = createStorageSystem({
  basePath: process.env.AI_AGENT_STORAGE_PATH,
  maxHistoryRecords: 1000,
  maxCheckpoints: 50,
  autoBackup: true
});

// 初始化
await storage.initialize();

// 创建新会话
const { threadId, metadata } = await storage.sessions.createSession({
  title: 'React组件开发助手',
  programmingLanguage: 'typescript',
  initialMessage: '帮我写一个React组件'
});

// 保存检查点
await storage.checkpoints.createCheckpoint(threadId, {
  messages: [new HumanMessage('用户消息')],
  currentTask: '开发React组件',
  programmingLanguage: 'typescript'
}, {
  description: '初始化检查点',
  stepType: 'agent'
});

// 添加历史记录
await storage.history.addHistoryRecord(threadId, {
  event_type: 'user_message',
  content: '帮我写一个React组件',
  display_priority: 'high'
});

// 获取会话信息
const sessionInfo = await storage.sessions.getSessionInfo(threadId);
console.log('会话信息:', sessionInfo);
```

## 核心组件

### 1. StorageSystem - 统一入口

```typescript
const storage = new StorageSystem({
  basePath: '~/.ai-agent',           // 存储路径
  maxHistoryRecords: 1000,          // 最大历史记录数
  maxCheckpoints: 50,                // 最大检查点数
  autoBackup: true                   // 自动备份
});

await storage.initialize();

// 获取各个管理器
const sessions = storage.sessions;      // 会话管理
const history = storage.history;        // 历史管理
const checkpoints = storage.checkpoints; // 检查点管理
const files = storage.files;           // 文件管理
```

### 2. SessionManager - 会话管理

```typescript
// 创建会话
const { threadId, metadata } = await sessions.createSession({
  title: '新会话',
  programmingLanguage: 'python',
  initialMessage: '帮我写一个Python函数'
});

// 更新会话
await sessions.updateSessionMetadata(threadId, {
  title: '更新后的标题',
  status: 'completed'
});

// 列出所有会话
const sessionList = await sessions.listSessions({
  status: 'active',
  limit: 10
});

// 删除会话
await sessions.deleteSession(threadId);
```

### 3. HistoryManager - 历史记录管理

```typescript
// 添加历史记录
await history.addHistoryRecord(threadId, {
  event_type: 'user_message',
  content: '用户输入内容',
  display_priority: 'high'
});

// 获取用户消息
const userMessages = await history.getUserMessages(threadId, 20);

// 获取工具调用历史
const toolCalls = await history.getToolCalls(threadId, 'write_file');

// 搜索历史记录
const searchResults = await history.searchHistory(threadId, 'React组件', {
  dateRange: {
    start: Date.now() - 24 * 60 * 60 * 1000, // 最近24小时
    end: Date.now()
  },
  limit: 50
});

// 导出历史记录
const exportData = await history.exportHistory(threadId, 'markdown');
```

### 4. CheckpointManager - 检查点管理

```typescript
// 创建检查点
const { checkpointId } = await checkpoints.createCheckpoint(threadId, {
  messages: [new HumanMessage('消息内容')],
  currentTask: '当前任务',
  programmingLanguage: 'typescript'
}, {
  description: '任务完成检查点',
  stepType: 'tool'
});

// 恢复检查点
const { state, checkpoint } = await checkpoints.restoreCheckpoint(threadId, checkpointId);

// 比较检查点
const comparison = await checkpoints.compareCheckpoints(threadId, 'ckpt_001', 'ckpt_002');

// 获取检查点时间线
const timeline = await checkpoints.getCheckpointTimeline(threadId);
```

## 文件格式

### metadata.json
```json
{
  "thread_id": "cli-session-1k8f9m2-a1b2c3",
  "title": "React组件开发助手",
  "created_at": 1704067180000,
  "updated_at": 1704067280000,
  "message_count": 25,
  "last_checkpoint": "ckpt_015",
  "status": "active",
  "programming_language": "typescript",
  "summary": "用户希望实现一个TypeScript的AI助手，已完成React组件的基础结构和样式设计..."
}
```

### checkpoints.jsonl
```json
{"timestamp":1704067200000,"thread_id":"cli-session-1","checkpoint":{"id":"ckpt_001","step":1,"channel_values":{"messages":[...]}}}
{"timestamp":1704067260000,"thread_id":"cli-session-1","checkpoint":{"id":"ckpt_002","step":2,"channel_values":{"messages":[...]}}}
```

### history.jsonl
```json
{"timestamp":1704067180000,"event_type":"user_message","content":"帮我写一个React组件","display_priority":"high"}
{"timestamp":1704067200000,"event_type":"ai_response","content":"我来帮你创建一个React组件...","display_priority":"high"}
{"timestamp":1704067260000,"event_type":"tool_call","tool_name":"write_file","args":{"path":"Component.tsx"},"result":"success","display_priority":"medium"}
```

## 高级功能

### 系统健康检查

```typescript
const health = await storage.healthCheck();

if (health.status === 'warning') {
  console.log('发现警告:', health.recommendations);
}

if (health.status === 'error') {
  console.error('发现错误:', health.issues);
}
```

### 系统清理

```typescript
const cleanupResult = await storage.cleanup({
  olderThanDays: 30,
  maxHistoryRecords: 1000,
  maxCheckpoints: 50,
  deleteArchived: true
});

console.log(`清理了 ${cleanupResult.sessionsCleaned} 个会话`);
console.log(`释放了 ${cleanupResult.spaceFreed / 1024 / 1024} MB 空间`);
```

### 数据导出

```typescript
// 导出所有数据为JSON
const allData = await storage.exportAllData('json');
fs.writeFileSync('backup.json', allData);

// 导出单个会话历史为Markdown
const sessionHistory = await history.exportHistory(threadId, 'markdown');
fs.writeFileSync(`${threadId}.md`, sessionHistory);
```

## 工具函数

```typescript
import {
  generateThreadId,
  formatTimestamp,
  formatFileSize,
  calculateSessionStats,
  suggestSessionTitle
} from './utils';

// 生成会话ID
const threadId = generateThreadId('cli'); // cli-1k8f9m2-a1b2c3

// 格式化时间
const formatted = formatTimestamp(Date.now(), 'relative'); // "2小时前"

// 格式化文件大小
const size = formatFileSize(1024 * 1024); // "1.00 MB"

// 计算会话统计
const stats = calculateSessionStats(historyRecords);

// 生成会话标题建议
const title = suggestSessionTitle(historyRecords);
```

## 配置选项

```typescript
interface StorageConfig {
  basePath?: string;           // 存储基础路径，默认 ~/.ai-agent
  maxHistoryRecords?: number;  // 最大历史记录数，默认 1000
  maxCheckpoints?: number;     // 最大检查点数，默认 50
  autoBackup?: boolean;        // 是否自动备份，默认 true
}
```

## 集成到现有系统

这个存储系统设计为可以独立运行，也可以轻松集成到现有的 LangGraph 应用中：

```typescript
// 在 graph.ts 中集成检查点功能
import { StorageSystem } from '../storage/index';

const storage = new StorageSystem();

async function saveCheckpointToStorage(state: AgentState) {
  const threadId = state.threadId || 'default';
  await storage.checkpoints.createCheckpoint(threadId, state);
  return state;
}

// 在节点中记录历史
async function recordToolUsage(toolName: string, args: any, result: any) {
  const record = storage.sessions.createToolCallHistory(toolName, args, result);
  await storage.history.addHistoryRecord(state.threadId, record);
}
```

## 错误处理

所有操作都包含适当的错误处理和日志记录：

```typescript
try {
  const session = await storage.sessions.createSession();
  console.log('会话创建成功:', session.threadId);
} catch (error) {
  console.error('会话创建失败:', error);
  // 错误信息会自动记录到历史中
}
```

## 性能优化

1. **延迟加载**: 只在需要时加载数据
2. **增量更新**: 只更新变更的部分
3. **缓存机制**: 内存中缓存最近访问的数据
4. **自动清理**: 定期清理过期数据
5. **压缩存储**: JSON 格式化存储减少文件大小

## 安全考虑

1. **路径验证**: 防止路径遍历攻击
2. **输入清理**: 自动清理和控制字符
3. **权限检查**: 确保文件读写权限正确
4. **数据验证**: 严格验证所有输入数据