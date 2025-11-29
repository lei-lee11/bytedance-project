import { createStorageSystem } from './index.js';
import { HumanMessage } from '@langchain/core/messages';

/**
 * 存储系统使用示例
 * 演示如何创建会话、保存检查点、记录历史等核心功能
 */
async function storageExample() {
  console.log('🚀 开始存储系统示例...\n');

  // 1. 创建存储系统实例
  const storage = createStorageSystem({
    maxHistoryRecords: 100,
    maxCheckpoints: 20,
    basePath: './ai-agent-storage-example' // 使用示例存储路径
  });

  try {
    // 2. 初始化存储系统
    await storage.initialize();
    console.log('✅ 存储系统初始化完成\n');

    // 3. 创建新会话
    console.log('📝 创建新会话...');
    const { threadId, metadata } = await storage.sessions.createSession({
      title: '存储系统演示',
      programmingLanguage: 'typescript',
      initialMessage: '帮我演示存储系统的功能'
    });

    console.log(`🆕 会话创建成功: ${threadId}`);
    console.log(`📋 会话标题: ${metadata.title}`);
    console.log(`📅 创建时间: ${new Date(metadata.created_at).toLocaleString()}\n`);

    // 4. 添加用户消息到历史记录
    console.log('💬 添加用户消息...');
    await storage.history.addHistoryRecord(threadId, {
      event_type: 'user_message',
      content: '帮我演示存储系统的功能',
      display_priority: 'high',
      metadata: {
        message_type: 'initial_request',
        programming_language: 'typescript'
      }
    });

    // 5. 创建并保存检查点
    console.log('💾 创建检查点...');
    const checkpointId = await storage.checkpoints.createCheckpoint(threadId, {
      messages: [
        new HumanMessage('帮我演示存储系统的功能'),
        new HumanMessage('请展示三层文件架构的存储能力')
      ],
      currentTask: '演示存储系统',
      programmingLanguage: 'typescript',
      codeContext: '这是一段演示代码，展示如何使用存储系统'
    }, {
      description: '演示检查点保存',
      stepType: 'initialization',
      node: 'storage_demo'
    });

    console.log(`📍 检查点创建成功: ${checkpointId.checkpointId}\n`);

    // 6. 添加工具调用历史记录
    console.log('🔧 添加工具调用记录...');
    await storage.history.addHistoryRecord(threadId, {
      event_type: 'tool_call',
      content: '调用 read_files 工具读取项目文件',
      display_priority: 'medium',
      metadata: {
        tool_name: 'read_files',
        args: { file_paths: ['src/**/*.ts'] },
        result: { success: true, files_count: 25 }
      }
    });

    // 7. 添加 AI 响应历史记录
    console.log('🤖 添加AI响应记录...');
    await storage.history.addHistoryRecord(threadId, {
      event_type: 'ai_response',
      content: '我已经为您创建了存储系统，包含了会话管理、检查点管理和历史记录功能。系统采用三层文件架构：metadata.json、checkpoints.jsonl 和 history.jsonl。',
      display_priority: 'high',
      metadata: {
        response_type: 'system_overview',
        features_mentioned: ['session_management', 'checkpoint_management', 'history_tracking'],
        architecture: 'three_layer_file_system'
      }
    });

    // 8. 获取会话信息
    console.log('📊 获取会话信息...');
    const sessionInfo = await storage.sessions.getSessionInfo(threadId);
    if (sessionInfo) {
      console.log(`📈 会话统计:`);
      console.log(`   - 检查点数量: ${sessionInfo.checkpointCount}`);
      console.log(`   - 历史记录数量: ${sessionInfo.historyCount}`);
      console.log(`   - 消息总数: ${sessionInfo.metadata.message_count}`);
      console.log(`   - 是否有活跃检查点: ${sessionInfo.hasActiveCheckpoint}\n`);
    }

    // 9. 获取用户消息历史
    console.log('💬 获取用户消息历史...');
    const userMessages = await storage.history.getUserMessages(threadId, 5);
    console.log(`用户消息 (${userMessages.length} 条):`);
    userMessages.forEach((msg, index) => {
      console.log(`  ${index + 1}. ${new Date(msg.timestamp).toLocaleTimeString()}: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });

    // 10. 获取工具调用历史
    console.log('🔧 获取工具调用历史...');
    const toolCalls = await storage.history.getToolCalls(threadId);
    console.log(`工具调用 (${toolCalls.length} 条):`);
    toolCalls.forEach((call, index) => {
      const toolName = call.metadata?.tool_name || 'unknown';
      console.log(`  ${index + 1}. ${new Date(call.timestamp).toLocaleTimeString()}: ${toolName} - ${call.content.substring(0, 40)}...`);
    });

    // 11. 搜索历史记录
    console.log('🔍 搜索历史记录...');
    const searchResults = await storage.history.searchHistory(threadId, '存储', {
      limit: 3
    });
    console.log(`搜索结果 (${searchResults.length} 条):`);
    searchResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.event_type}: ${result.content.substring(0, 40)}...`);
    });

    // 12. 获取会话摘要
    console.log('📋 生成会话摘要...');
    const summary = await storage.history.getSessionSummary(threadId);
    console.log(`📊 会话摘要:`);
    console.log(`   - 总消息数: ${summary.totalMessages}`);
    console.log(`   - 用户消息: ${summary.userMessages}`);
    console.log(`   - AI响应: ${summary.aiResponses}`);
    console.log(`   - 工具调用: ${summary.toolCalls}`);
    console.log(`   - 会话时长: ${Math.round(summary.timeSpan.duration / 1000 / 60)} 分钟`);
    console.log(`   - 主要工具: ${summary.primaryTools.map(t => `${t.name}(${t.count})`).join(', ')}\n`);

    // 13. 系统健康检查
    console.log('🏥 执行系统健康检查...');
    const health = await storage.healthCheck();
    console.log(`健康状态: ${health.status}`);
    if (health.issues.length > 0) {
      console.log(`⚠️  发现问题 (${health.issues.length} 个):`);
      health.issues.forEach(issue => console.log(`   - ${issue}`));
    }
    if (health.recommendations.length > 0) {
      console.log(`💡 建议 (${health.recommendations.length} 个):`);
      health.recommendations.forEach(rec => console.log(`   - ${rec}`));
    }

    // 14. 系统统计
    console.log('📈 获取系统统计信息...');
    const stats = await storage.getSystemStats();
    console.log(`📊 系统统计:`);
    console.log(`   - 总会话数: ${stats.totalSessions}`);
    console.log(`   - 活跃会话: ${stats.activeSessions}`);
    console.log(`   - 归档会话: ${stats.archivedSessions}`);
    console.log(`   - 完成会话: ${stats.completedSessions}`);
    console.log(`   - 总检查点: ${stats.totalCheckpoints}`);
    console.log(`   - 总历史记录: ${stats.totalHistoryRecords}`);
    console.log(`   - 估算存储大小: ${(stats.totalStorageSize / 1024 / 1024).toFixed(2)} MB\n`);

    // 15. 导出数据
    console.log('📤 导出会话数据...');
    const exportData = await storage.exportAllData('json');
    console.log(`📄 导出数据大小: ${exportData.length} 字符`);

    // 16. 关闭存储系统
    await storage.close();
    console.log('🔒 存储系统已关闭\n');

    console.log('✅ 存储系统示例完成！\n');

    return {
      threadId,
      checkpointId: checkpointId.checkpointId,
      sessionStats: stats,
      healthStatus: health.status
    };

  } catch (error) {
    console.error('❌ 存储系统示例失败:', error);
    throw error;
  }
}

// 运行示例
if (import.meta.url) {
  storageExample()
    .then((result) => {
      console.log('\n🎉 示例执行结果:');
      console.log(`- 会话ID: ${result.threadId}`);
      console.log(`- 检查点ID: ${result.checkpointId}`);
      console.log(`- 系统状态: ${result.healthStatus}`);
      console.log(`- 总会话数: ${result.sessionStats.totalSessions}`);
    })
    .catch((error) => {
      console.error('💥 示例执行失败:', error);
      process.exit(1);
    });
}

export { storageExample };
