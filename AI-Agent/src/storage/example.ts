import { createStorageSystem } from './index.js';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

/**
 * AI Agent 存储系统完整使用示例
 *
 * 本示例演示了存储系统的所有核心功能：
 * - 会话管理（创建、更新、删除、归档）
 * - 检查点管理（保存、恢复、历史追踪）
 * - 历史记录管理（事件追踪、搜索、分析）
 * - 系统运维（健康检查、清理、导出）
 *
 * 存储架构：三层文件系统
 * ~/.ai-agent/sessions/{threadId}/
 *   ├── metadata.json      # 会话元数据
 *   ├── checkpoints.jsonl  # LangGraph 状态检查点
 *   └── history.jsonl      # 完整交互历史
 */
async function comprehensiveStorageExample() {
  console.log('🚀 启动 AI Agent 存储系统综合演示...\n');

  // 1. 创建存储系统实例
  const storage = createStorageSystem({
    basePath: './ai-agent-storage-demo',
    maxHistoryRecords: 500,
    maxCheckpoints: 30
  });

  try {
    // 2. 初始化存储系统
    await storage.initialize();
    console.log('✅ 存储系统初始化完成\n');

    // 3. 创建开发会话 - React组件开发场景
    console.log('📝 场景1：创建 React 组件开发会话');
    const { threadId: reactThreadId, metadata: reactMetadata } = await storage.sessions.createSession({
      title: 'React TodoList 组件开发',
      programmingLanguage: 'typescript',
      initialMessage: '帮我开发一个功能完整的 TodoList React 组件，需要支持增删改查和状态持久化'
    });

    console.log(`🆕 会话创建成功: ${reactThreadId}`);
    console.log(`📋 标题: ${reactMetadata.title}`);
    console.log(`🔧 语言: ${reactMetadata.programming_language}`);
    console.log(`📅 创建时间: ${new Date(reactMetadata.created_at).toLocaleString()}\n`);

    // 4. 创建 Python 数据分析会话
    console.log('📝 场景2：创建 Python 数据分析会话');
    const { threadId: pythonThreadId, metadata: pythonMetadata } = await storage.sessions.createSession({
      title: 'Python 数据可视化分析',
      programmingLanguage: 'python',
      initialMessage: '使用 pandas 和 matplotlib 分析销售数据，生成趋势图表'
    });

    console.log(`🆕 Python 会话: ${pythonThreadId}`);
    console.log(`📊 标题: ${pythonMetadata.title}\n`);

    // 5. 模拟 React 开发工作流程
    console.log('💻 场景3：React 开发工作流程演示');

    // 5.1 添加用户消息历史
    await storage.history.addHistoryRecord(reactThreadId, {
      event_type: 'user_message',
      content: '首先创建基础的组件结构和状态管理',
      display_priority: 'high',
      metadata: {
        development_phase: 'planning',
        component_type: 'todo_list'
      }
    });

    // 5.2 保存开发检查点（包含完整 AgentState）
    const checkpoint1 = await storage.sessions.saveCheckpoint(reactThreadId, {
      messages: [
        new HumanMessage('帮我开发一个功能完整的 TodoList React 组件'),
        new AIMessage('我来为您创建一个功能完整的 TodoList 组件，包含增删改查和本地存储功能')
      ],
      currentTask: '创建 TodoList 组件结构',
      retryCount: 0,
      codeContext: 'import React, { useState, useEffect } from "react";\n\ninterface TodoItem {\n  id: number;\n  text: string;\n  completed: boolean;\n}',
      projectRoot: process.cwd(),
      projectTreeInjected: true,
      projectTreeText: 'src/\n  components/\n    TodoList.tsx\n    TodoItem.tsx\n  hooks/\n    useLocalStorage.ts',
      testPlanText: '测试计划：\n1. 组件渲染测试\n2. 添加待办事项功能\n3. 删除功能测试\n4. 状态持久化测试',
      projectProfile: {
        detectedLanguages: ['TypeScript', 'JavaScript', 'CSS'],
        primaryLanguage: 'TypeScript',
        testCommand: 'npm test',
        testFrameworkHint: 'Jest + React Testing Library'
      }
    });
    console.log(`💾 检查点1已保存: ${checkpoint1}`);

    // 5.3 模拟工具调用（文件操作）
    await storage.history.addHistoryRecord(reactThreadId, {
      event_type: 'tool_call',
      content: '创建 TodoList.tsx 组件文件',
      display_priority: 'medium',
      metadata: {
        tool_name: 'write_file',
        args: {
          path: 'src/components/TodoList.tsx',
          content: '组件代码内容...'
        },
        result: { success: true, file_size: 2048 }
      }
    });

    // 5.4 添加 AI 响应
    await storage.history.addHistoryRecord(reactThreadId, {
      event_type: 'ai_response',
      content: '我已经为您创建了 TodoList 组件的基础结构。组件包含以下功能：\n1. 状态管理（useState）\n2. 本地存储（useLocalStorage）\n3. 增删改查功能\n4. 完整的 TypeScript 类型定义',
      display_priority: 'high',
      metadata: {
        response_type: 'code_generation',
        features_implemented: ['state_management', 'local_storage', 'crud_operations', 'typescript_types']
      }
    });

    // 6. 模拟系统总结场景
    console.log('🔄 场景4：系统总结（内存优化）');
    await storage.history.addHistoryRecord(reactThreadId, {
      event_type: 'system_summarize',
      content: '对话历史已压缩，保留了关键的项目结构和开发进度信息',
      display_priority: 'low',
      metadata: {
        old_message_count: 15,
        new_message_count: 3,
        summary_length: 256,
        compression_ratio: 0.8
      }
    });

    // 7. 会话查询和分析
    console.log('🔍 场景5：会话查询和分析功能');

    // 7.1 获取会话详细信息
    const reactSessionInfo = await storage.sessions.getSessionInfo(reactThreadId);
    if (reactSessionInfo) {
      console.log(`📊 React 会话统计:`);
      console.log(`   📍 会话ID: ${reactSessionInfo.metadata.thread_id}`);
      console.log(`   🏷️  状态: ${reactSessionInfo.metadata.status}`);
      console.log(`   💬 消息数: ${reactSessionInfo.metadata.message_count}`);
      console.log(`   📈 检查点: ${reactSessionInfo.checkpointCount}`);
      console.log(`   📜 历史记录: ${reactSessionInfo.historyCount}`);
      console.log(`   🔄 活跃检查点: ${reactSessionInfo.hasActiveCheckpoint}`);
      console.log(`   📅 最后更新: ${new Date(reactSessionInfo.metadata.updated_at).toLocaleString()}\n`);
    }

    // 7.2 列出所有会话
    const allSessions = await storage.sessions.listSessions({ limit: 10 });
    console.log(`📋 系统会话列表 (${allSessions.total} 个会话):`);
    allSessions.sessions.forEach((session, index) => {
      console.log(`   ${index + 1}. ${session.metadata.title} (${session.metadata.programming_language}) - ${session.metadata.status}`);
    });
    console.log();

    // 8. 历史记录深度分析
    console.log('📜 场景6：历史记录分析功能');

    // 8.1 获取用户消息历史
    const userMessages = await storage.history.getUserMessages(reactThreadId, 5);
    console.log(`💬 用户消息历史 (${userMessages.length} 条):`);
    userMessages.forEach((msg, index) => {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const preview = msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');
      console.log(`   ${index + 1}. [${time}] ${preview}`);
    });
    console.log();

    // 8.2 获取工具调用历史
    const toolCalls = await storage.history.getToolCalls(reactThreadId);
    console.log(`🔧 工具调用统计 (${toolCalls.length} 次):`);
    const toolStats = toolCalls.reduce((stats, call) => {
      const toolName = call.tool_name || 'unknown';
      stats[toolName] = (stats[toolName] || 0) + 1;
      return stats;
    }, {} as Record<string, number>);

    Object.entries(toolStats).forEach(([tool, count]) => {
      console.log(`   - ${tool}: ${count} 次`);
    });
    console.log();

    // 8.3 搜索历史记录
    const searchResults = await storage.history.searchHistory(reactThreadId, '组件', {
      limit: 3,
      eventType: ['ai_response'] as string[]
    });
    console.log(`🔍 搜索 "组件" 结果 (${searchResults.length} 条):`);
    searchResults.forEach((result, index) => {
      const preview = result.content.substring(0, 60) + (result.content.length > 60 ? '...' : '');
      console.log(`   ${index + 1}. [${result.event_type}] ${preview}`);
    });
    console.log();

    // 9. 检查点管理演示
    console.log('💾 场景7：检查点生命周期管理');

    // 9.1 获取最新检查点
    const latestCheckpoint = await storage.sessions.getLatestCheckpoint(reactThreadId);
    if (latestCheckpoint) {
      console.log(`🔄 最新检查点: ${latestCheckpoint.checkpoint.id}`);
      console.log(`📅 创建时间: ${new Date(latestCheckpoint.timestamp).toLocaleString()}`);
      console.log(`📍 步骤: ${latestCheckpoint.checkpoint.step}`);
      console.log(`💬 消息数: ${latestCheckpoint.checkpoint.channel_values.messages.length}\n`);
    }

    // 9.2 创建开发进度检查点
    const progressCheckpoint = await storage.sessions.saveCheckpoint(reactThreadId, {
      messages: [
        new HumanMessage('添加测试用例和样式优化'),
        new AIMessage('好的，我来添加完整的测试用例和优化组件样式')
      ],
      currentTask: '完善测试和样式',
      retryCount: 0,
      codeContext: '// 添加的测试代码...\n// 优化的样式...',
      projectRoot: process.cwd(),
      projectTreeInjected: true,
      projectTreeText: 'src/\n  components/\n    TodoList.tsx ✅\n    TodoItem.tsx ✅\n  tests/\n    TodoList.test.tsx ✅',
      testPlanText: '测试覆盖率：\n- 组件渲染: ✅\n- 交互功能: ✅\n- 状态管理: ✅\n- 本地存储: ✅',
      projectProfile: {
        detectedLanguages: ['TypeScript', 'JavaScript', 'CSS'],
        primaryLanguage: 'TypeScript',
        testCommand: 'npm test -- --coverage',
        testFrameworkHint: 'Jest + React Testing Library'
      }
    });
    console.log(`✅ 开发进度检查点已保存: ${progressCheckpoint}\n`);

    // 10. 会话状态管理
    console.log('⚙️  场景8：会话状态管理');

    // 10.1 归档已完成的会话
    await storage.sessions.archiveSession(reactThreadId);
    console.log(`📦 React 会话已归档: ${reactThreadId}`);

    // 10.2 更新会话标题和摘要
    await storage.sessions.updateSessionMetadata(reactThreadId, {
      title: 'React TodoList 组件 - 完成版',
      summary: '成功开发了功能完整的 TodoList React 组件，包含增删改查、状态持久化、TypeScript 类型定义和完整测试用例'
    });
    console.log(`📝 会话信息已更新\n`);

    // 11. 系统级运维功能
    console.log('🏥 场景9：系统运维和监控');

    // 11.1 系统健康检查
    const healthStatus = await storage.healthCheck();
    console.log(`🏥 系统健康状态: ${healthStatus.status.toUpperCase()}`);
    if (healthStatus.issues.length > 0) {
      console.log(`⚠️  发现的问题 (${healthStatus.issues.length}):`);
      healthStatus.issues.forEach(issue => console.log(`   - ${issue}`));
    }
    if (healthStatus.recommendations.length > 0) {
      console.log(`💡 优化建议 (${healthStatus.recommendations.length}):`);
      healthStatus.recommendations.forEach(rec => console.log(`   - ${rec}`));
    }
    console.log();

    // 11.2 系统统计信息
    const systemStats = await storage.getSystemStats();
    console.log(`📈 系统统计概览:`);
    console.log(`   📊 总会话数: ${systemStats.totalSessions}`);
    console.log(`   ✅ 活跃会话: ${systemStats.activeSessions}`);
    console.log(`   📦 归档会话: ${systemStats.archivedSessions}`);
    console.log(`   💾 总检查点: ${systemStats.totalCheckpoints}`);
    console.log(`   📝 总历史记录: ${systemStats.totalHistoryRecords}`);
    console.log(`   📏 存储大小: ${(systemStats.totalStorageSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   ⏱️  平均会话年龄: ${Math.round(systemStats.averageSessionAge / 1000 / 60 / 60 / 24)} 天\n`);

    // 11.3 锁状态监控
    const lockStatus = storage.getLockStatus();
    console.log(`🔒 并发控制状态:`);
    console.log(`   活动锁数量: ${lockStatus.totalLocks}`);
    console.log(`   活跃锁列表:`, lockStatus.activeLocks);
    console.log(`   等待队列:`, lockStatus.pendingLocks);
    console.log();

    // 12. 数据导出和备份
    console.log('📤 场景10：数据导出和备份');

    // 12.1 导出所有会话数据
    const jsonExport = await storage.exportAllData('json');
    console.log(`📄 JSON 导出数据大小: ${(jsonExport.length / 1024).toFixed(2)} KB`);

    // 12.2 导出为 CSV 格式
    const csvExport = await storage.exportAllData('csv');
    console.log(`📊 CSV 导出数据大小: ${(csvExport.length / 1024).toFixed(2)} KB`);

    // 12.3 导出单个会话历史为 Markdown
    const markdownHistory = await storage.history.exportHistory(reactThreadId, 'markdown');
    console.log(`📝 Markdown 历史导出: ${(markdownHistory.length / 1024).toFixed(2)} KB\n`);

    // 13. 系统清理演示
    console.log('🧹 场景11：系统清理和优化');

    // 13.1 执行系统清理
    const cleanupResult = await storage.cleanup({
      olderThanDays: 7,
      maxHistoryRecords: 100,
      maxCheckpoints: 20,
      deleteArchived: false
    });

    console.log(`🧹 清理结果:`);
    console.log(`   📦 清理会话: ${cleanupResult.sessionsCleaned}`);
    console.log(`   📝 删除历史记录: ${cleanupResult.historyRecordsDeleted}`);
    console.log(`   💾 删除检查点: ${cleanupResult.checkpointsDeleted}`);
    console.log(`   📏 释放空间: ${(cleanupResult.spaceFreed / 1024 / 1024).toFixed(2)} MB\n`);

    // 14. 错误恢复演示
    console.log('🚨 场景12：错误处理和恢复');

    try {
      // 尝试获取不存在的会话
      await storage.sessions.getSessionInfo('non-existent-thread-id');
    } catch (error) {
      console.log(`❌ 错误处理正常: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // 强制释放所有锁（错误恢复）
    storage.forceReleaseAllLocks();
    console.log(`🔓 所有锁已强制释放（错误恢复）\n`);

    // 15. 会话恢复演示
    console.log('🔙 场景13：会话恢复');

    // 15.1 恢复已归档的会话
    await storage.sessions.restoreSession(reactThreadId);
    console.log(`✅ 会话已恢复: ${reactThreadId}`);

    // 15.2 验证恢复状态
    const restoredSession = await storage.sessions.getSessionInfo(reactThreadId);
    if (restoredSession) {
      console.log(`📊 恢复状态: ${restoredSession.metadata.status}`);
      console.log(`📝 新标题: ${restoredSession.metadata.title}\n`);
    }

    // 16. 最终总结
    console.log('📊 场景14：完整会话摘要生成');

    // 生成会话摘要
    const sessionSummary = await storage.history.getSessionSummary(reactThreadId);
    console.log(`📋 会话完整摘要:`);
    console.log(`   💬 总消息数: ${sessionSummary.totalMessages}`);
    console.log(`   👤 用户消息: ${sessionSummary.userMessages}`);
    console.log(`   🤖 AI响应: ${sessionSummary.aiResponses}`);
    console.log(`   🔧 工具调用: ${sessionSummary.toolCalls}`);
    console.log(`   ⏱️  会话时长: ${Math.round(sessionSummary.timeSpan.duration / 1000 / 60)} 分钟`);
    console.log(`   🔄 消息频率: ${sessionSummary.messageFrequency} 条/小时`);
    console.log(`   🔧 主要工具: ${sessionSummary.primaryTools.map(t => `${t.name}(${t.count})`).join(', ')}`);
    console.log(`   📅 时间范围: ${new Date(sessionSummary.timeSpan.start).toLocaleString()} - ${new Date(sessionSummary.timeSpan.end).toLocaleString()}`);

    // 17. 关闭存储系统
    await storage.close();
    console.log('\n🔒 存储系统已安全关闭');
    console.log('\n✅ 综合演示完成！');

    return {
      reactSessionId: reactThreadId,
      pythonSessionId: pythonThreadId,
      systemStats,
      healthStatus,
      cleanupResult,
      exportSizes: {
        json: jsonExport.length,
        csv: csvExport.length,
        markdown: markdownHistory.length
      }
    };

  } catch (error) {
    console.error('❌ 演示执行失败:', error);

    // 确保清理资源
    try {
      await storage.close();
    } catch (closeError) {
      console.error('关闭存储系统时出错:', closeError);
    }

    throw error;
  }
}

/**
 * 快速开始示例 - 最小化使用
 */
async function quickStartExample() {
  console.log('⚡ 快速开始示例...\n');

  const storage = createStorageSystem();
  await storage.initialize();

  try {
    // 创建会话
    const { threadId } = await storage.sessions.createSession({
      title: '快速演示',
      programmingLanguage: 'typescript',
      initialMessage: '快速演示存储功能'
    });

    // 保存检查点
    await storage.sessions.saveCheckpoint(threadId, {
      messages: [new HumanMessage('测试消息')],
      currentTask: '快速演示',
      retryCount: 0,
      projectTreeInjected: false
    });

    // 添加历史记录
    await storage.history.addHistoryRecord(threadId, {
      event_type: 'tool_call',
      content: '执行快速操作',
      display_priority: 'medium',
      metadata: { tool_name: 'quick_tool', result: 'success' }
    });

    console.log('✅ 快速演示完成');
    return threadId;

  } finally {
    await storage.close();
  }
}

/**
 * 性能测试示例
 */
async function performanceTestExample() {
  console.log('🏃 性能测试示例...\n');

  const storage = createStorageSystem({
    basePath: './perf-test-storage',
    maxHistoryRecords: 1000,
    maxCheckpoints: 100
  });

  await storage.initialize();

  try {
    const startTime = Date.now();
    const { threadId } = await storage.sessions.createSession({
      title: '性能测试会话',
      programmingLanguage: 'typescript'
    });

    // 批量创建历史记录
    const batchSize = 100;
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      promises.push(
        storage.history.addHistoryRecord(threadId, {
          event_type: 'user_message',
          content: `性能测试消息 ${i}`,
          display_priority: 'medium'
        })
      );
    }

    await Promise.all(promises);

    const duration = Date.now() - startTime;
    console.log(`✅ 性能测试完成: ${batchSize} 条记录，耗时 ${duration}ms (${Math.round(batchSize * 1000 / duration)} 条/秒)`);

    return { threadId, duration, rate: batchSize * 1000 / duration };

  } finally {
    await storage.close();
  }
}

// 运行示例
if (import.meta.url) {
  const command = process.argv[2] || 'comprehensive';

  switch (command) {
    case 'quick':
      quickStartExample()
        .then(threadId => {
          console.log(`\n🎉 快速示例完成，会话ID: ${threadId}`);
        })
        .catch(console.error);
      break;

    case 'performance':
      performanceTestExample()
        .then(result => {
          console.log(`\n🎉 性能测试完成:`, result);
        })
        .catch(console.error);
      break;

    case 'comprehensive':
    default:
      comprehensiveStorageExample()
        .then(result => {
          console.log('\n🎉 综合演示执行结果:');
          console.log(`- React 会话ID: ${result.reactSessionId}`);
          console.log(`- Python 会话ID: ${result.pythonSessionId}`);
          console.log(`- 系统状态: ${result.healthStatus.status}`);
          console.log(`- 总会话数: ${result.systemStats.totalSessions}`);
          console.log(`- 导出数据大小: JSON ${(result.exportSizes.json / 1024).toFixed(1)}KB, CSV ${(result.exportSizes.csv / 1024).toFixed(1)}KB`);
        })
        .catch(error => {
          console.error('💥 综合演示执行失败:', error);
          process.exit(1);
        });
      break;
  }
}

export { comprehensiveStorageExample, quickStartExample, performanceTestExample };
