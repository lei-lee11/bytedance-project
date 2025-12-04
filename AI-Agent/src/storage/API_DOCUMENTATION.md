# AI Agent 存储系统 API 接口文档

基于 `StorageSystem` 统一入口的完整接口说明，按使用场景和调用频率排序。

## 📋 目录

1. [基础初始化](#基础初始化)
2. [会话管理](#会话管理)
3. [历史记录查询](#历史记录查询)
4. [系统运维](#系统运维)
5. [数据分析](#数据分析)
6. [高级功能](#高级功能)

## 🔧 基础初始化

### `initialize()`
初始化存储系统，必须在调用其他任何方法之前调用。

```typescript
const storage = createStorageSystem({
  basePath: '~/.ai-agent',
  maxHistoryRecords: 1000,
  maxCheckpoints: 50
});

await storage.initialize();
```

**返回值**: `Promise<void>`

**说明**:
- 设置存储目录结构
- 初始化文件管理器
- 准备会话管理器
- 只需调用一次，重复调用会被忽略

---

### `close()`
安全关闭存储系统，释放所有资源。

```typescript
await storage.close();
```

**返回值**: `Promise<void>`

**说明**:
- 强制释放所有文件锁
- 清理临时资源
- 重置初始化状态
- 适用于应用关闭或系统重启

---

## 👥 会话管理

### `listSessions()`
获取所有会话的列表，支持分页和状态过滤。

```typescript
const sessions = await storage.sessions.listSessions({
  status: 'active',        // 可选: 'active' | 'archived'
  limit: 20,               // 可选: 返回数量限制
  offset: 0                 // 可选: 分页偏移
});
```

**返回值**: `Promise<SessionListResult>`
```typescript
interface SessionListResult {
  sessions: SessionInfo[];  // 会话信息列表
  total: number;           // 总会话数
  hasMore: boolean;        // 是否有更多数据
}
```

**使用场景**:
- 显示会话列表页面
- 用户历史会话管理
- 系统监控和统计

---

### `getSessionInfo(threadId: string)`
获取特定会话的详细信息。

```typescript
const sessionInfo = await storage.sessions.getSessionInfo('cli-session-123456');
```

**返回值**: `Promise<SessionInfo | null>`
```typescript
interface SessionInfo {
  metadata: SessionMetadata;        // 会话元数据
  hasActiveCheckpoint: boolean;     // 是否有活跃检查点
  checkpointCount: number;          // 检查点数量
  historyCount: number;             // 历史记录数量
}
```

**使用场景**:
- 会话详情页面
- 会话状态验证
- 调试和故障排除

---

### `deleteSession(threadId: string)`
删除指定会话及其所有相关数据。

```typescript
await storage.sessions.deleteSession('cli-session-123456');
```

**返回值**: `Promise<void>`

**使用场景**:
- 用户主动删除会话
- 清理过期会话
- 数据隐私保护

---

## 📜 历史记录查询

### `getHistory(threadId: string, options?: QueryOptions)`
获取会话的历史记录，支持多种过滤和分页选项。

```typescript
const history = await storage.sessions.getHistory('cli-session-123456', {
  eventType: 'user_message',           // 可选: 事件类型过滤
  limit: 50,                          // 可选: 返回数量限制
  offset: 0,                          // 可选: 分页偏移
  startTime: Date.now() - 24*60*60*1000, // 可选: 开始时间
  endTime: Date.now(),                 // 可选: 结束时间
  priority: 'high'                    // 可选: 显示优先级过滤
});
```

**返回值**: `Promise<HistoryRecord[]>`

**使用场景**:
- 显示对话历史
- 按时间范围筛选消息
- 按消息类型过滤
- 分页加载历史记录

---

### `getUserMessages(threadId: string, limit?: number)`
获取用户消息历史，按时间倒序排列。

```typescript
const userMessages = await storage.history.getUserMessages('cli-session-123456', 10);
```

**返回值**: `Promise<HistoryRecord[]>`

**使用场景**:
- 显示用户输入历史
- 用户行为分析
- 快速查找用户问题

---

### `getAIResponses(threadId: string, limit?: number)`
获取AI回复历史，按时间倒序排列。

```typescript
const aiResponses = await storage.history.getAIResponses('cli-session-123456', 10);
```

**返回值**: `Promise<HistoryRecord[]>`

**使用场景**:
- 显示AI回答历史
- 分析AI回复质量
- 生成对话摘要

---

### `getToolCalls(threadId: string, toolName?: string, limit?: number)`
获取工具调用记录，可按工具名称过滤。

```typescript
// 获取所有工具调用
const allToolCalls = await storage.history.getToolCalls('cli-session-123456');

// 获取特定工具调用
const fileOperations = await storage.history.getToolCalls('cli-session-123456', 'write_file');
```

**返回值**: `Promise<HistoryRecord[]>`

**使用场景**:
- 工具使用统计
- 操作历史追踪
- 调试工具调用问题
- 性能分析

---

### `searchHistory(threadId: string, query: string, options?: SearchOptions)`
在会话历史中搜索包含特定内容的记录。

```typescript
const searchResults = await storage.history.searchHistory('cli-session-123456', '文件操作', {
  limit: 20,                                   // 可选: 结果数量限制
  eventType: 'ai_response',                    // 可选: 事件类型过滤
  startTime: Date.now() - 7*24*60*60*1000      // 可选: 最近7天
});
```

**返回值**: `Promise<HistoryRecord[]>`

**使用场景**:
- 内容搜索功能
- 快速查找特定对话
- 主题分类整理

---

## 🔍 数据分析

### `getSessionSummary(threadId: string)`
获取会话的统计摘要和分析信息。

```typescript
const summary = await storage.history.getSessionSummary('cli-session-123456');
```

**返回值**: `Promise<SessionSummary>`
```typescript
interface SessionSummary {
  totalMessages: number;              // 总消息数
  userMessages: number;               // 用户消息数
  aiResponses: number;                // AI回复数
  toolCalls: number;                  // 工具调用数
  messageFrequency: number;           // 消息频率(条/小时)
  averageResponseLength: number;      // 平均回复长度
  primaryTools: Array<{               // 主要使用的工具
    name: string;
    count: number;
  }>;
  sessionDuration: number;            // 会话持续时间(毫秒)
  firstMessageTime: number;           // 首条消息时间
  lastMessageTime: number;            // 最后消息时间
}
```

**使用场景**:
- 生成会话报告
- 用户行为分析
- 系统性能监控
- 用户体验优化

---

### `getActivityAnalysis(threadId: string, days?: number)`
分析指定天数内的会话活动模式。

```typescript
const analysis = await storage.history.getActivityAnalysis('cli-session-123456', 7);
```

**返回值**: `Promise<ActivityAnalysis>`
```typescript
interface ActivityAnalysis {
  totalDays: number;                  // 分析天数
  activeDays: number;                 // 活跃天数
  averageMessagesPerDay: number;      // 日均消息数
  peakActivityHour: number;           // 最活跃时段(0-23)
  messageDistribution: {              // 消息分布统计
    user: number;
    ai: number;
    tool: number;
  };
  dailyActivity: Array<{              // 每日活动统计
    date: string;
    messageCount: number;
    toolCalls: number;
  }>;
}
```

**使用场景**:
- 用户活跃度分析
- 使用习惯统计
- 系统负载预测
- 服务质量评估

---

### `getSystemStats()`
获取整个存储系统的统计信息。

```typescript
const stats = await storage.getSystemStats();
```

**返回值**: `Promise<SystemStats>`
```typescript
interface SystemStats {
  totalSessions: number;             // 总会话数
  activeSessions: number;            // 活跃会话数
  archivedSessions: number;          // 归档会话数
  totalCheckpoints: number;          // 总检查点数
  totalHistoryRecords: number;       // 总历史记录数
  totalStorageSize: number;          // 总存储大小(字节)
  averageSessionAge: number;         // 平均会话年龄(毫秒)
}
```

**使用场景**:
- 系统监控仪表板
- 存储容量管理
- 性能分析报告
- 资源使用统计

---

## 🔧 系统运维

### `healthCheck()`
执行系统健康检查，识别潜在问题和提供优化建议。

```typescript
const health = await storage.healthCheck();

if (health.status === 'healthy') {
  console.log('系统运行正常');
} else if (health.status === 'warning') {
  console.warn('发现优化建议:', health.recommendations);
} else {
  console.error('发现严重问题:', health.issues);
}
```

**返回值**: `Promise<HealthCheckResult>`
```typescript
interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'error';  // 健康状态
  issues: string[];                           // 发现的问题列表
  recommendations: string[];                   // 优化建议列表
}
```

**检查项目**:
- 会话数据完整性
- 文件权限和可访问性
- 存储空间使用情况
- 活跃锁状态检查
- 数据一致性验证

**使用场景**:
- 定期系统维护
- 问题诊断
- 性能优化
- 预防性检查

---

### `cleanup(options?: CleanupOptions)`
执行系统清理操作，删除归档会话并归档长时间未活跃的会话。

```typescript
const result = await storage.cleanup({
  olderThanDays: 30           // 归档30天前未更新的会话
});

console.log(`处理了 ${result.sessionsCleaned} 个会话`);
console.log(`释放了 ${(result.spaceFreed / 1024 / 1024).toFixed(2)} MB 空间`);
```

**参数**: `CleanupOptions`
```typescript
interface CleanupOptions {
  olderThanDays?: number;     // 归档超过指定天数的未活跃会话（默认30天）
}
```

**返回值**: `Promise<CleanupResult>`
```typescript
interface CleanupResult {
  sessionsCleaned: number;    // 处理的会话总数（包括删除和归档）
  spaceFreed: number;         // 删除归档会话释放的空间(字节)
}
```

**清理策略**:
1. **删除归档会话**: 永久删除所有状态为 `'archived'` 的会话
2. **自动归档**: 将超过 `olderThanDays` 天未更新的活跃会话状态改为 `'archived'`

**自动清理机制**:
- 历史记录和检查点的数量限制已在添加时自动处理（无需手动清理）
- 添加历史记录时会自动清理超出 `maxHistoryRecords` 的旧记录
- 保存检查点时会自动清理超出 `maxCheckpoints` 的旧检查点

**使用场景**:
- 定期维护任务（建议设置定时任务）
- 存储空间管理
- 会话生命周期管理
- 释放归档会话占用的磁盘空间

---

## 💡 使用示例

### 完整的会话管理流程

```typescript
import { createStorageSystem } from './src/storage/index.js';

// 1. 初始化存储系统
const storage = createStorageSystem({
  basePath: '~/.ai-agent',
  maxHistoryRecords: 1000
});

await storage.initialize();

// 2. 获取会话列表
const sessionList = await storage.sessions.listSessions({ limit: 10 });
console.log(`找到 ${sessionList.total} 个会话`);

// 3. 获取特定会话信息
if (sessionList.sessions.length > 0) {
  const session = sessionList.sessions[0];
  const sessionInfo = await storage.sessions.getSessionInfo(session.metadata.thread_id);

  // 4. 获取会话历史
  const history = await storage.sessions.getHistory(session.metadata.thread_id, {
    limit: 20
  });

  // 5. 获取用户消息
  const userMessages = await storage.history.getUserMessages(session.metadata.thread_id);

  // 6. 搜索历史记录
  const searchResults = await storage.history.searchHistory(
    session.metadata.thread_id,
    '文件操作'
  );

  // 7. 获取会话摘要
  const summary = await storage.history.getSessionSummary(session.metadata.thread_id);
  console.log(`会话包含 ${summary.totalMessages} 条消息`);

  // 8. 获取活动分析
  const activity = await storage.history.getActivityAnalysis(session.metadata.thread_id, 7);
  console.log(`日均消息数: ${activity.averageMessagesPerDay}`);
}

// 9. 系统健康检查
const health = await storage.healthCheck();
console.log('系统状态:', health.status);

// 10. 获取系统统计
const stats = await storage.getSystemStats();
console.log(`总存储大小: ${(stats.totalStorageSize / 1024 / 1024).toFixed(2)} MB`);

// 11. 执行清理
const cleanup = await storage.cleanup({ olderThanDays: 30 });
console.log(`处理了 ${cleanup.sessionsCleaned} 个会话`);
console.log(`释放空间: ${(cleanup.spaceFreed / 1024 / 1024).toFixed(2)} MB`);

// 12. 关闭系统
await storage.close();
```

### 错误处理最佳实践

```typescript
try {
  await storage.initialize();

  const sessions = await storage.sessions.listSessions();
  // ... 业务逻辑

} catch (error) {
  console.error('存储系统错误:', error);

  // 执行健康检查诊断问题
  const health = await storage.healthCheck();
  if (health.issues.length > 0) {
    console.error('发现的问题:', health.issues);
  }

  // 尝试清理和恢复
  await storage.cleanup();

} finally {
  // 确保关闭系统
  await storage.close();
}
```

---

## 📝 注意事项

1. **初始化要求**: 必须先调用 `initialize()` 才能使用其他方法
2. **并发安全**: 所有方法都支持并发调用，内置文件锁保护
3. **错误处理**: 所有方法都应使用 try-catch 进行错误处理
4. **资源管理**: 应用关闭前应调用 `close()` 释放资源
5. **性能考虑**: 大数据量查询时建议使用 `limit` 和 `offset` 分页
6. **存储路径**: 默认存储路径为 `~/.ai-agent`，可在初始化时自定义

---

*最后更新: 2025年1月*