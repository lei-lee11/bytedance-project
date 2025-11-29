import { SessionManager } from './sessionManager.js';
import {
  HistoryRecord,
  QueryOptions,
  ToolCallRecord,
} from './types.js';

/**
 * 历史记录管理器
 * 提供专门的历史记录查询和分析功能
 */
export class HistoryManager {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * 获取用户消息历史
   */
  async getUserMessages(threadId: string, limit?: number): Promise<HistoryRecord[]> {
    return this.sessionManager.getHistory(threadId, {
      eventType: 'user_message',
      limit
    });
  }

  /**
   * 获取 AI 响应历史
   */
  async getAIResponses(threadId: string, limit?: number): Promise<HistoryRecord[]> {
    return this.sessionManager.getHistory(threadId, {
      eventType: 'ai_response',
      limit
    });
  }

  /**
   * 获取工具调用历史
   */
  async getToolCalls(threadId: string, toolName?: string): Promise<ToolCallRecord[]> {
    const history = await this.sessionManager.getHistory(threadId, {
      eventType: 'tool_call'
    });

    const toolCalls = history as ToolCallRecord[];
    return toolName ? toolCalls.filter(call => call.tool_name === toolName) : toolCalls;
  }

  /**
   * 添加历史记录
   */
  async addHistoryRecord(
    threadId: string,
    event: Omit<HistoryRecord, 'timestamp'>
  ): Promise<void> {
    return this.sessionManager.addHistoryRecord(threadId, event);
  }

  /**
   * 获取历史记录
   */
  async getHistory(threadId: string, options?: QueryOptions): Promise<HistoryRecord[]> {
    return this.sessionManager.getHistory(threadId, options);
  }

  /**
   * 获取系统操作历史
   */
  async getSystemOperations(threadId: string): Promise<HistoryRecord[]> {
    return this.sessionManager.getHistory(threadId, {
      eventType: 'system_summarize'
    });
  }

  /**
   * 获取高优先级历史（用户可见的）
   */
  async getDisplayHistory(
    threadId: string,
    options?: { limit?: number; includeLowPriority?: boolean }
  ): Promise<HistoryRecord[]> {
    const priorities: Array<'high' | 'medium' | 'low'> = options?.includeLowPriority
      ? ['high', 'medium', 'low']
      : ['high', 'medium'];

    const history = await this.sessionManager.getHistory(threadId, {
      limit: options?.limit
    });

    return history.filter(record => priorities.includes(record.display_priority));
  }

  /**
   * 搜索历史记录
   */
  async searchHistory(
    threadId: string,
    query: string,
    options?: {
      eventType?: string[];
      dateRange?: { start?: number; end?: number };
      limit?: number;
    }
  ): Promise<HistoryRecord[]> {
    const history = await this.sessionManager.getHistory(threadId);

    let filtered = history;

    // 文本搜索
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = filtered.filter(record =>
        record.content.toLowerCase().includes(lowerQuery) ||
        JSON.stringify(record.metadata || {}).toLowerCase().includes(lowerQuery)
      );
    }

    // 事件类型过滤
    if (options?.eventType && options.eventType.length > 0) {
      filtered = filtered.filter(record =>
        options.eventType!.includes(record.event_type)
      );
    }

    // 日期范围过滤
    if (options?.dateRange) {
      const { start, end } = options.dateRange;
      filtered = filtered.filter(record => {
        if (start && record.timestamp < start) return false;
        if (end && record.timestamp > end) return false;
        return true;
      });
    }

    // 限制结果数量
    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * 获取会话摘要
   */
  async getSessionSummary(threadId: string): Promise<{
    totalMessages: number;
    userMessages: number;
    aiResponses: number;
    toolCalls: number;
    systemOperations: number;
    timeSpan: { start: number; end: number; duration: number };
    lastActivity: number;
    primaryTools: Array<{ name: string; count: number }>;
  }> {
    const [userMessages, aiResponses, toolCalls, systemOps] = await Promise.all([
      this.getUserMessages(threadId),
      this.getAIResponses(threadId),
      this.getToolCalls(threadId),
      this.getSystemOperations(threadId)
    ]);

    const allHistory = [...userMessages, ...aiResponses, ...toolCalls, ...systemOps];

    if (allHistory.length === 0) {
      return {
        totalMessages: 0,
        userMessages: 0,
        aiResponses: 0,
        toolCalls: 0,
        systemOperations: 0,
        timeSpan: { start: 0, end: 0, duration: 0 },
        lastActivity: 0,
        primaryTools: []
      };
    }

    const timestamps = allHistory.map(record => record.timestamp);
    const startTime = Math.min(...timestamps);
    const endTime = Math.max(...timestamps);
    const lastActivity = Math.max(...timestamps);

    // 统计工具使用情况
    const toolUsage = new Map<string, number>();
    toolCalls.forEach(call => {
      const toolName = (call as ToolCallRecord).tool_name;
      toolUsage.set(toolName, (toolUsage.get(toolName) || 0) + 1);
    });

    const primaryTools = Array.from(toolUsage.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalMessages: allHistory.length,
      userMessages: userMessages.length,
      aiResponses: aiResponses.length,
      toolCalls: toolCalls.length,
      systemOperations: systemOps.length,
      timeSpan: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime
      },
      lastActivity,
      primaryTools
    };
  }

  /**
   * 导出历史记录
   */
  async exportHistory(
    threadId: string,
    format: 'json' | 'csv' | 'markdown' = 'json',
    options?: QueryOptions
  ): Promise<string> {
    const history = await this.sessionManager.getHistory(threadId, options);
    const sessionInfo = await this.sessionManager.getSessionInfo(threadId);

    switch (format) {
      case 'json':
        return JSON.stringify({
          session: sessionInfo,
          history: history,
          exported_at: Date.now()
        }, null, 2);

      case 'csv':
        return this.convertToCSV(history);

      case 'markdown':
        return this.convertToMarkdown(history, sessionInfo);

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * 转换为 CSV 格式
   */
  private convertToCSV(history: HistoryRecord[]): string {
    const headers = ['Timestamp', 'Event Type', 'Content', 'Priority', 'Metadata'];
    const rows = history.map(record => [
      new Date(record.timestamp).toISOString(),
      record.event_type,
      `"${record.content.replace(/"/g, '""')}"`,
      record.display_priority,
      `"${JSON.stringify(record.metadata || {}).replace(/"/g, '""')}"`
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * 转换为 Markdown 格式
   */
  private convertToMarkdown(
    history: HistoryRecord[],
    sessionInfo: any
  ): string {
    let markdown = `# 会话历史记录\n\n`;

    if (sessionInfo) {
      markdown += `## 会话信息\n\n`;
      markdown += `- **会话ID**: ${sessionInfo.metadata.thread_id}\n`;
      markdown += `- **标题**: ${sessionInfo.metadata.title}\n`;
      markdown += `- **创建时间**: ${new Date(sessionInfo.metadata.created_at).toLocaleString()}\n`;
      markdown += `- **最后更新**: ${new Date(sessionInfo.metadata.updated_at).toLocaleString()}\n`;
      markdown += `- **消息数量**: ${sessionInfo.metadata.message_count}\n`;
      markdown += `- **状态**: ${sessionInfo.metadata.status}\n\n`;
    }

    markdown += `## 历史记录\n\n`;

    for (const record of history) {
      const time = new Date(record.timestamp).toLocaleString();
      const emoji = this.getEventEmoji(record.event_type);

      markdown += `### ${emoji} ${record.event_type} - ${time}\n\n`;
      markdown += `**优先级**: ${record.display_priority}\n\n`;
      markdown += `${record.content}\n\n`;

      if (record.metadata && Object.keys(record.metadata).length > 0) {
        markdown += `**详细信息**:\n\`\`\`json\n${JSON.stringify(record.metadata, null, 2)}\n\`\`\`\n\n`;
      }

      markdown += `---\n\n`;
    }

    return markdown;
  }

  /**
   * 获取事件类型对应的 emoji
   */
  private getEventEmoji(eventType: string): string {
    const emojiMap: Record<string, string> = {
      'user_message': '💬',
      'ai_response': '🤖',
      'tool_call': '🔧',
      'system_summarize': '📋',
      'error': '❌',
      'session_created': '🆕',
      'session_updated': '✏️'
    };
    return emojiMap[eventType] || '📝';
  }

  /**
   * 清理过期历史记录
   */
  /**
   * 清理过期历史记录
   */
  async cleanupHistory(
    threadId: string,
    olderThanDays = 30, // 移除 number 类型注解
    keepHighPriority = true // 移除 boolean 类型注解
  ): Promise<{ deleted: number; kept: number }> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    const history = await this.sessionManager.getHistory(threadId);

    const toDelete: string[] = []; // 改为 const
    const toKeep: string[] = []; // 改为 const

    for (const record of history) {
      if (record.timestamp < cutoffTime) {
        // 过期记录
        if (keepHighPriority && record.display_priority === 'high') {
          toKeep.push(record.timestamp.toString());
        } else {
          toDelete.push(record.timestamp.toString());
        }
      } else {
        toKeep.push(record.timestamp.toString());
      }
    }

    // 这里我们只返回统计信息，实际的删除操作需要在 FileManager 中实现
    return {
      deleted: toDelete.length,
      kept: toKeep.length
    };
  }

  /**
   * 获取活跃时间段分析
   */
  async getActivityAnalysis(threadId: string): Promise<{
    hourlyActivity: Array<{ hour: number; count: number }>;
    dailyActivity: Array<{ date: string; count: number }>;
    mostActiveHour: number;
    mostActiveDay: string;
  }> {
    const history = await this.sessionManager.getHistory(threadId);

    // 按小时统计
    const hourlyActivity = new Array(24).fill(0).map((_, hour) => ({ hour, count: 0 }));

    // 按日期统计
    const dailyActivity = new Map<string, number>();

    for (const record of history) {
      const date = new Date(record.timestamp);

      // 小时统计
      hourlyActivity[date.getHours()].count++;

      // 日期统计
      const dateKey = date.toISOString().split('T')[0];
      dailyActivity.set(dateKey, (dailyActivity.get(dateKey) || 0) + 1);
    }

    const dailyActivityArray = Array.from(dailyActivity.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const mostActiveHour = hourlyActivity.reduce((max, curr) =>
      curr.count > max.count ? curr : max
    ).hour;

    const mostActiveDay = dailyActivityArray.length > 0
      ? dailyActivityArray.reduce((max, curr) =>
          curr.count > max.count ? curr : max
        ).date
      : '';

    return {
      hourlyActivity,
      dailyActivity: dailyActivityArray,
      mostActiveHour,
      mostActiveDay
    };
  }
}
