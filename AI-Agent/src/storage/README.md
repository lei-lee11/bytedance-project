# AI Agent 存储系统

AI Agent 存储系统是一个专为 LangGraph 应用设计的高性能、并发安全的三层文件架构存储解决方案。该系统提供了完整的会话管理、状态检查点和交互历史追踪功能，支持复杂的 AI 开发工作流程。

## 🏗️ 架构概览

### 三层文件架构
```
~/.ai-agent/
├── sessions/
│   ├── {threadId}/
│   │   ├── metadata.json          # 会话元数据和统计信息
│   │   ├── checkpoints.jsonl     # LangGraph 状态检查点（完整 AgentState）
│   │   └── history.jsonl      # 时间序列事件历史记录
```

### 核心组件

#### 1. StorageSystem - 统一入口
- **功能**: 提供完整的存储功能接口
- **特性**:
  - 统一的三层架构管理
  - 高性能的 JSON Lines 格式存储
  - 完整的并发安全控制
  - 自动数据清理和优化

#### 2. SessionManagerWithLock - 会话管理器
- **功能**: 增强版会话管理，支持文件锁机制
- **特性**:
  - 创建、更新、归档、恢复会话
  - 会话元数据管理（创建时间、更新时间、消息数量、状态等）
  - 并发安全：防止多进程同时操作同一会话
  - 会话列表和分页查询

#### 3. LangGraphStorageAdapter - LangGraph 适配器
- **功能**: 将现有存储系统适配到 LangGraph 的 BaseCheckpointSaver 接口
- **特性**:
  - 完整的消息类型识别（HumanMessage、AIMessage、ToolMessage 等）
  - 智能消息去重机制（基于 ID 和内容）
  - 增量状态更新和检查点保存
  - 工具调用记录和追踪
  - 元数据同步和一致性保证

#### 4. HistoryManager - 历史记录管理器
- **功能**: 管理时间序列的事件历史记录
- **特性**:
  - 多种事件类型支持（user_message、ai_response、tool_call、system_summarize）
  - 显示优先级管理（high、medium、low）
  - 灵活的元数据存储
  - 历史记录查询、过滤和导出

#### 5. FileManager - 文件系统管理器
- **功能**: 底层文件操作和路径管理
- **特性**:
  - JSON Lines 格式高效读写
  - 原子操作和路径管理
  - 文件锁机制防止并发冲突
  - 自动备份和版本控制

#### 6. LockManagerSimple - 简单锁管理器
- **功能**: 提供基础的并发控制机制
- **特性**:
  - 文件锁和会话锁
  - 死锁检测和自动释放
  - 锁状态监控

## 🔧 核心功能

### 消息管理
- **完整的消息类型支持**: HumanMessage、AIMessage、ToolMessage、SystemMessage
- **智能消息去重**: 基于 ID 和内容双重去重，避免重复存储
- **增量保存**: 只保存新增的消息，提高效率
- **工具调用追踪**: 完整记录 AI 工具调用过程

### 会话管理
- **会话生命周期**: 创建、活跃、归档、恢复、删除
- **元数据管理**: 标题、创建时间、更新时间、消息数量、编程语言等
- **并发安全**: 文件锁机制防止数据竞争
- **批量操作**: 支持会话列表查询和分页

### 状态检查点
- **LangGraph 兼容**: 完全适配 LangGraph BaseCheckpointSaver 接口
- **状态完整性**: 保存和恢复完整的 AgentState
- **增量更新**: 高效的增量状态同步
- **版本控制**: 检查点版本管理和追踪

### 历史追踪
- **时间序列**: 按时间顺序记录所有交互事件
- **事件类型**: 用户消息、AI 响应、工具调用、系统事件
- **元数据丰富**: 支持结构化元数据存储
- **查询分析**: 强大的过滤、搜索和导出功能

## 🚀 性能特性

### 高效存储
- **JSON Lines 格式**: 比传统 JSON 更高效，支持流式读写
- **增量更新**: 只保存变更的部分，减少 I/O 操作
- **内存优化**: 合理的缓存策略和懒加载
- **自动清理**: 定期清理过期数据，保持系统性能

### 并发安全
- **文件锁**: 防止多进程同时写入同一文件
- **会话锁**: 防止同一会话的并发操作冲突
- **原子操作**: 确保数据操作的一致性
- **死锁检测**: 自动检测和处理死锁情况

## 📊 数据一致性

### 元数据同步
- **实时同步**: 会话元数据与实际消息数量保持一致
- **状态验证**: 多层数据完整性验证
- **错误恢复**: 完善的错误处理和恢复机制
- **数据校验**: 严格的输入验证和类型检查

### 存储优化
- **数据压缩**: 智能的历史记录压缩和清理
- **索引优化**: 高效的数据索引和查询机制
- **空间管理**: 自动监控和清理存储空间使用

## 🔍 调试和监控

### 详细日志
- **分级日志**: ERROR、WARN、INFO、DEBUG 级别的日志系统
- **操作追踪**: 记录所有关键操作的详细信息
- **性能监控**: 存储操作的耗时和吞吐量统计
- **错误诊断**: 详细的错误信息和堆栈追踪

### 健康检查
- **系统健康**: 定期检查存储系统的健康状态
- **数据验证**: 验证数据完整性和一致性
- **性能分析**: 分析系统性能瓶颈和优化建议
- **自动报告**: 生成详细的系统状态报告

## 🛡️ 安全特性

### 访问控制
- **路径验证**: 严格的文件路径验证，防止路径遍历攻击
- **输入清理**: 自动清理和验证用户输入
- **权限检查**: 文件读写权限验证和管理

### 数据保护
- **数据加密**: 敏感数据的安全存储（可选）
- **备份机制**: 自动数据备份和恢复
- **数据隔离**: 不同会话的数据完全隔离

## 🎯 使用场景

### AI 应用开发
- **聊天机器人**: 完整的对话历史和上下文管理
- **代码助手**: 代码生成、编辑和分析的完整记录
- **任务管理**: 项目任务和进度的跟踪管理
- **多轮对话**: 支持复杂的多轮交互和工具调用

### 企业级应用
- **高并发**: 支持大量用户同时使用
- **大数据**: 处理和分析大规模数据集
- **长期存储**: 长期会话和项目数据的持久化
- **数据分析**: 集成数据分析和报告生成功能

## 📈 监控指标

### 性能指标
- **响应时间**: 存储操作的平均响应时间
- **吞吐量**: 每秒处理的操作数量
- **错误率**: 操作失败的比例和趋势
- **资源使用**: 内存、磁盘空间、CPU 使用情况

### 业务指标
- **会话统计**: 活跃会话数量、平均会话时长
- **消息统计**: 各类消息的数量和频率
- **工具使用**: AI 工具调用的次数和成功率
- **存储效率**: 存储空间使用情况和清理效果

---

## 🚀 快速开始

### 安装
```bash
npm install
```

### 创建存储系统
```typescript
import { createStorageSystem } from './src/storage/index.js';

// 创建存储系统实例
const storage = createStorageSystem({
    basePath: '~/.ai-agent',
    maxHistoryRecords: 1000,
    maxCheckpoints: 100
});

// 初始化存储系统
await storage.initialize();
```

### 在 LangGraph 中使用
```typescript
import { createLangGraphAdapter } from './src/storage/langgraphAdapter.js';

// 创建适配器
const adapter = createLangGraphAdapter(storage);

// 在 LangGraph 中使用
const graph = createReactGraph({
    checkpointer: adapter
});
```

### 基本使用
```typescript
// 创建会话
const { threadId } = await storage.sessions.createSession({
    title: '新会话',
    initialMessage: '你好！'
});

// 添加历史记录
await storage.history.addHistoryRecord(threadId, {
    event_type: 'user_message',
    content: '用户输入内容',
    display_priority: 'high'
});

// 保存检查点
await adapter.put(
    { configurable: { thread_id: threadId } },
    {
        messages: [userMessage, aiMessage],
        // ... 其他状态
    },
    { step: 1 }
);
```

## 📚 文档和资源

- **API 文档**: 详细的 TypeScript 类型定义和接口文档
- **示例代码**: 完整的使用示例和最佳实践
- **故障排除**: 常见问题和解决方案
- **性能指南**: 优化建议和配置说明

## 🏆 企业级特性

- **可扩展**: 支持水平扩展和分布式部署
- **可配置**: 丰富的配置选项和自定义设置
- **可监控**: 完整的监控和告警系统
- **可维护**: 简单的维护工具和自动化脚本

---

*AI Agent 存储系统 - 为下一代 AI 应用提供强大的存储基础设施*

## 🏗️ 架构概览

### 三层文件架构

```
~/.ai-agent/
├── sessions/
│   └── {threadId}/
│       ├── metadata.json          # 会话元数据和统计信息
│       ├── checkpoints.jsonl      # LangGraph 状态检查点（完整 AgentState）
│       └── history.jsonl          # 时间序列事件历史记录
```

### 核心组件

- **StorageSystem**: 统一入口，提供完整的存储功能接口
- **SessionManagerWithLock**: 增强会话管理器，支持文件锁机制
- **HistoryManager**: 专门的历史记录查询和分析管理器
- **FileManager**: 底层文件系统操作和路径管理
- **LockManager**: 会话级并发控制，防止数据竞争

## 🚀 快速开始

### 基础使用

```typescript
import { createStorageSystem } from './index.js';
import { HumanMessage } from '@langchain/core/messages';

// 创建存储系统
const storage = createStorageSystem({
  basePath: '~/.ai-agent',           // 存储路径
  maxHistoryRecords: 1000,           // 最大历史记录数
  maxCheckpoints: 50                 // 最大检查点数
});

// 初始化存储系统
await storage.initialize();

// 创建新会话
const { threadId, metadata } = await storage.sessions.createSession({
  title: 'React 组件开发',
  programmingLanguage: 'typescript',
  initialMessage: '帮我创建一个 React 组件'
});

// 保存 LangGraph 检查点（完整 AgentState）
await storage.sessions.saveCheckpoint(threadId, {
  messages: [new HumanMessage('用户消息')],
  currentTask: '组件开发',
  retryCount: 0,
  projectRoot: process.cwd(),
  projectTreeInjected: true,
  projectTreeText: '项目目录结构',
  testPlanText: '测试计划',
  projectProfile: {
    detectedLanguages: ['TypeScript'],
    primaryLanguage: 'TypeScript',
    testCommand: 'npm test',
    testFrameworkHint: 'Jest'
  }
});

// 添加历史记录
await storage.history.addHistoryRecord(threadId, {
  event_type: 'user_message',
  content: '帮我优化组件性能',
  display_priority: 'high'
});

// 关闭存储系统
await storage.close();
```

## 📖 核心功能

### 1. 会话管理（Session Management）

#### 创建会话
```typescript
const { threadId, metadata } = await storage.sessions.createSession({
  title: 'Python 数据分析项目',
  programmingLanguage: 'python',
  initialMessage: '使用 pandas 分析销售数据'
});
```

#### 会话状态管理
```typescript
// 归档会话（标记为已完成）
await storage.sessions.archiveSession(threadId);

// 恢复归档的会话
await storage.sessions.restoreSession(threadId);

// 更新会话元数据
await storage.sessions.updateSessionMetadata(threadId, {
  title: '更新后的项目标题',
  summary: '项目完成总结'
});

// 删除会话
await storage.sessions.deleteSession(threadId);
```

#### 会话查询
```typescript
// 获取会话详细信息
const sessionInfo = await storage.sessions.getSessionInfo(threadId);

// 列出所有会话
const sessions = await storage.sessions.listSessions({
  status: 'active',        // 筛选条件：active, archived
  limit: 20,               // 返回数量限制
  offset: 0                // 分页偏移
});
```

### 2. 检查点管理（Checkpoint Management）

#### 保存检查点
```typescript
// 保存完整的 AgentState 作为检查点
const checkpointId = await storage.sessions.saveCheckpoint(
  threadId,
  agentState,              // 完整的 AgentState 对象
  'custom-checkpoint-id'   // 可选：自定义检查点ID
);
```

#### 恢复检查点
```typescript
// 获取最新检查点
const latestCheckpoint = await storage.sessions.getLatestCheckpoint(threadId);

// 获取指定检查点
const checkpoint = await storage.sessions.getCheckpoint(threadId, checkpointId);

// 提取 AgentState
const agentState = checkpoint?.checkpoint.channel_values;
```

### 3. 历史记录管理（History Management）

#### 添加历史记录
```typescript
// 用户消息
await storage.history.addHistoryRecord(threadId, {
  event_type: 'user_message',
  content: '用户输入内容',
  display_priority: 'high'
});

// AI 响应
await storage.history.addHistoryRecord(threadId, {
  event_type: 'ai_response',
  content: 'AI 生成的响应内容',
  display_priority: 'high'
});

// 工具调用
await storage.history.addHistoryRecord(threadId, {
  event_type: 'tool_call',
  content: '执行文件写入操作',
  display_priority: 'medium',
  metadata: {
    tool_name: 'write_file',
    args: { path: 'src/app.tsx', content: '...' },
    result: { success: true }
  }
});

// 系统总结事件（内存优化）
await storage.history.addHistoryRecord(threadId, {
  event_type: 'system_summarize',
  content: '对话历史已压缩',
  display_priority: 'low',
  metadata: {
    old_message_count: 20,
    new_message_count: 5,
    summary_length: 300
  }
});
```

#### 查询历史记录
```typescript
// 获取用户消息历史
const userMessages = await storage.history.getUserMessages(threadId, 10);

// 获取 AI 响应历史
const aiResponses = await storage.history.getAIResponses(threadId, 10);

// 获取工具调用历史
const toolCalls = await storage.history.getToolCalls(threadId, 'write_file');

// 通用历史查询
const history = await storage.sessions.getHistory(threadId, {
  eventType: 'user_message',
  limit: 20,
  startTime: Date.now() - 24 * 60 * 60 * 1000,  // 最近24小时
  priority: 'high'
});
```

#### 搜索和分析
```typescript
// 搜索历史记录
const searchResults = await storage.history.searchHistory(threadId, '组件', {
  limit: 10,
  eventType: 'ai_response',
  startTime: Date.now() - 7 * 24 * 60 * 60 * 1000  // 最近7天
});

// 生成会话摘要
const summary = await storage.history.getSessionSummary(threadId);
console.log(`总消息数: ${summary.totalMessages}`);
console.log(`消息频率: ${summary.messageFrequency} 条/小时`);
console.log(`主要工具: ${summary.primaryTools.map(t => t.name).join(', ')}`);

// 导出历史记录
const markdown = await storage.history.exportHistory(threadId, 'markdown');
const json = await storage.history.exportHistory(threadId, 'json');
```

### 4. 系统运维（System Operations）

#### 健康检查
```typescript
const health = await storage.healthCheck();

if (health.status === 'healthy') {
  console.log('系统运行正常');
} else if (health.status === 'warning') {
  console.log('发现优化建议:', health.recommendations);
} else if (health.status === 'error') {
  console.error('发现错误:', health.issues);
}
```

#### 系统统计
```typescript
const stats = await storage.getSystemStats();
console.log(`总会话数: ${stats.totalSessions}`);
console.log(`活跃会话: ${stats.activeSessions}`);
console.log(`存储大小: ${(stats.totalStorageSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`平均会话年龄: ${Math.round(stats.averageSessionAge / 1000 / 60 / 60 / 24)} 天`);
```

#### 系统清理
```typescript
const cleanupResult = await storage.cleanup({
  olderThanDays: 30,           // 清理30天前的数据
  maxHistoryRecords: 1000,     // 每个会话最大历史记录数
  maxCheckpoints: 50,          // 每个会话最大检查点数
  deleteArchived: false        // 是否删除归档会话
});

console.log(`清理了 ${cleanupResult.sessionsCleaned} 个会话`);
console.log(`释放了 ${(cleanupResult.spaceFreed / 1024 / 1024).toFixed(2)} MB 空间`);
```

#### 数据导出
```typescript
// 导出所有数据
const allData = await storage.exportAllData('json');  // 或 'csv'
fs.writeFileSync('backup.json', allData);

// 获取锁状态（调试和监控）
const lockStatus = storage.getLockStatus();
console.log(`活动锁数量: ${lockStatus.totalLocks}`);

// 强制释放所有锁（错误恢复）
storage.forceReleaseAllLocks();
```

## 🔧 高级功能

### 并发安全

系统使用会话级文件锁机制，确保高并发场景下的数据一致性：

```typescript
// 锁状态监控
const lockStatus = storage.getLockStatus();
if (lockStatus.totalLocks > 10) {
  console.warn('警告：活动锁数量较多，可能存在死锁风险');
}

// 错误恢复
storage.forceReleaseAllLocks();  // 强制释放所有锁
```

### 性能优化

```typescript
const storage = createStorageSystem({
  basePath: '~/.ai-agent',
  maxHistoryRecords: 1000,    // 限制历史记录数量
  maxCheckpoints: 50          // 限制检查点数量
});

// 批量操作优化
const promises = messages.map(msg =>
  storage.history.addHistoryRecord(threadId, msg)
);
await Promise.all(promises);
```

### 错误处理

```typescript
try {
  await storage.initialize();
  const { threadId } = await storage.sessions.createSession();
  // ... 其他操作
} catch (error) {
  console.error('存储操作失败:', error);
  // 系统会自动记录错误到历史记录中
} finally {
  // 确保关闭存储系统
  await storage.close();
}
```

## 📋 数据类型

### 核心接口

```typescript
// 完整的 Agent 状态
interface AgentState {
  messages: BaseMessage[];
  summary?: string;
  currentTask?: string;
  codeContext?: string;
  retryCount: number;
  reviewResult?: string;
  projectRoot?: string;
  projectTreeInjected: boolean;
  projectTreeText?: string;
  testPlanText?: string;
  projectProfile?: ProjectProfile;
}

// 项目画像
interface ProjectProfile {
  detectedLanguages: string[];
  primaryLanguage: "TypeScript" | "JavaScript" | "Python" | "Other";
  testCommand?: string;
  testFrameworkHint?: string;
}

// 会话元数据
interface SessionMetadata {
  thread_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  last_checkpoint?: string;
  status: 'active' | 'archived';
  programming_language?: string;
  summary?: string;
}

// 历史事件类型
type EventType =
  | 'user_message'
  | 'ai_response'
  | 'tool_call'
  | 'system_summarize'
  | 'error'
  | 'session_created'
  | 'session_updated';

// 历史记录
interface HistoryRecord {
  timestamp: number;
  event_type: EventType;
  content: string;
  display_priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}
```

## 🧪 示例场景

### 场景1：React 组件开发工作流

```typescript
// 1. 创建开发会话
const { threadId } = await storage.sessions.createSession({
  title: 'React TodoList 组件开发',
  programmingLanguage: 'typescript',
  initialMessage: '帮我开发一个功能完整的 TodoList React 组件'
});

// 2. 保存开发状态检查点
await storage.sessions.saveCheckpoint(threadId, {
  messages: [/* 对话消息 */],
  currentTask: '创建组件基础结构',
  codeContext: 'import React, { useState } from "react";',
  projectTreeText: 'src/components/TodoList.tsx',
  projectProfile: {
    detectedLanguages: ['TypeScript', 'CSS'],
    primaryLanguage: 'TypeScript',
    testCommand: 'npm test',
    testFrameworkHint: 'Jest + React Testing Library'
  }
});

// 3. 记录开发过程中的工具调用
await storage.history.addHistoryRecord(threadId, {
  event_type: 'tool_call',
  content: '创建组件文件',
  metadata: {
    tool_name: 'write_file',
    args: { path: 'src/components/TodoList.tsx' },
    result: { success: true }
  }
});

// 4. 项目完成，归档会话
await storage.sessions.archiveSession(threadId);
```

### 场景2：数据分析项目

```typescript
// 创建数据分析会话
const { threadId } = await storage.sessions.createSession({
  title: '销售数据可视化分析',
  programmingLanguage: 'python',
  initialMessage: '使用 pandas 和 matplotlib 分析销售趋势'
});

// 记录分析步骤
await storage.history.addHistoryRecord(threadId, {
  event_type: 'tool_call',
  content: '读取销售数据文件',
  metadata: {
    tool_name: 'read_files',
    args: { files: ['sales_data.csv'] },
    result: { rows: 10000, columns: 15 }
  }
});

// 保存分析结果检查点
await storage.sessions.saveCheckpoint(threadId, {
  currentTask: '生成销售趋势图表',
  codeContext: 'import pandas as pd\nimport matplotlib.pyplot as plt',
  projectProfile: {
    detectedLanguages: ['Python'],
    primaryLanguage: 'Python',
    testCommand: 'pytest',
    testFrameworkHint: 'pytest'
  }
});
```

## 🔍 调试和监控

### 日志和调试信息

```typescript
// 获取系统健康状态
const health = await storage.healthCheck();
console.log('系统状态:', health.status);
console.log('发现问题:', health.issues);
console.log('优化建议:', health.recommendations);

// 获取详细统计信息
const stats = await storage.getSystemStats();
console.log('存储使用情况:', {
  会话数: stats.totalSessions,
  检查点数: stats.totalCheckpoints,
  历史记录数: stats.totalHistoryRecords,
  存储大小: `${(stats.totalStorageSize / 1024 / 1024).toFixed(2)} MB`
});
```

### 常见问题排查

```typescript
// 检查锁状态
const lockStatus = storage.getLockStatus();
if (lockStatus.totalLocks > 0) {
  console.log('当前活动锁:', lockStatus.locks);
}

// 强制释放锁（仅在异常情况下使用）
storage.forceReleaseAllLocks();

// 验证数据完整性
const sessionInfo = await storage.sessions.getSessionInfo(threadId);
if (!sessionInfo) {
  console.error('会话不存在或已损坏');
}
```

## ⚙️ 配置选项

```typescript
interface StorageConfig {
  basePath?: string;           // 存储基础路径，默认 ~/.ai-agent
  maxHistoryRecords?: number;  // 最大历史记录数，默认 1000
  maxCheckpoints?: number;     // 最大检查点数，默认 50
}
```

## 🔒 安全考虑

1. **路径验证**: 防止路径遍历攻击
2. **输入清理**: 自动清理控制字符和特殊字符
3. **权限检查**: 确保文件读写权限正确
4. **数据验证**: 严格验证所有输入数据格式
5. **并发安全**: 文件锁机制防止数据竞争

## 📈 性能特性

- **延迟加载**: 只在需要时加载数据到内存
- **增量更新**: 只更新变更的部分，减少I/O操作
- **缓存机制**: 内存中缓存最近访问的数据
- **自动清理**: 定期清理过期数据，保持系统性能
- **批量操作**: 支持批量写入，提高吞吐量
- **压缩存储**: JSON Lines 格式，减少存储空间

## 🤝 集成指南

### 集成到 LangGraph 应用

```typescript
// 在 graph.ts 中集成
import { createStorageSystem } from '../storage/index.js';

const storage = createStorageSystem();

// 在节点中保存检查点
async function saveCheckpoint(state: AgentState) {
  await storage.sessions.saveCheckpoint(state.threadId, state);
  return state;
}

// 在工具调用节点中记录历史
async function recordToolUsage(toolName: string, args: any, result: any) {
  const record = storage.sessions.createToolCallHistory(toolName, args, result);
  await storage.history.addHistoryRecord(state.threadId, record);
}
```

### CLI 集成

```typescript
// 在 CLI 应用中
const storage = createStorageSystem();

// 启动时初始化
await storage.initialize();

// 会话管理
const { threadId } = await storage.sessions.createSession({
  title: 'CLI 会话',
  initialMessage: userInput
});

// 程序退出时清理
process.on('exit', async () => {
  await storage.close();
});
```

## 📚 API 参考

完整的 API 文档请参考 TypeScript 类型定义文件 `types.ts`，其中包含所有接口的详细定义和使用说明。

## 🎯 运行示例

```bash
# 运行综合演示
yarn tsx src/storage/example.ts

# 运行快速开始示例
yarn tsx src/storage/example.ts quick

# 运行性能测试
yarn tsx src/storage/example.ts performance
```

---

💡 **提示**: 该存储系统设计为生产就绪，支持高并发场景和大数据量处理，适用于企业级 AI 应用开发。