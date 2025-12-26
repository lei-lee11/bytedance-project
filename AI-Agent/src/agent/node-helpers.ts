import { END, Command } from "@langchain/langgraph";
import {
  SystemMessage,
  HumanMessage,
  RemoveMessage,
} from "@langchain/core/messages";
import { AgentState } from "./state.ts";
import { CONSTANTS } from "./prompt.js";

// ============================================================================
// Command 更新构建器 - 统一处理常见的状态更新模式
// ============================================================================

/**
 * 创建一个更新 todo 索引并返回 executor 的命令
 */
export function advanceToNextTodo(
  nextIndex: number,
  allDone: boolean,
): Command {
  const update: Partial<AgentState> = {
    currentTodoIndex: nextIndex,
    taskCompleted: true,
    iterationCount: 0,
  };

  if (allDone) {
    update.taskStatus = "completed" as const;
  }

  return new Command({
    update,
    goto: allDone ? END : "executor",
  });
}

/**
 * 创建一个完成所有任务的命令
 */
export function completeAllTasks(response?: any): Command {
  return new Command({
    update: {
      messages: response
        ? [response]
        : [new SystemMessage({ content: "所有任务已完成！" })],
      taskStatus: "completed" as const,
      iterationCount: 0,
    },
    goto: END,
  });
}

/**
 * 创建一个跳过到下一个任务的命令（检测到循环时使用）
 */
export function skipToNextTodo(
  nextIndex: number,
  allDone: boolean,
  message?: string,
): Command {
  const update: Partial<AgentState> = {
    messages: message ? [new SystemMessage(message)] : undefined,
    currentTodoIndex: nextIndex,
    taskCompleted: true,
    iterationCount: 0,
  };

  if (allDone) {
    update.taskStatus = "completed" as const;
  }

  return new Command({
    update,
    goto: allDone ? END : "executor",
  });
}

/**
 * 创建一个带响应的跳过命令
 */
export function skipToNextTodoWithResponse(
  response: any,
  nextIndex: number,
  allDone: boolean,
): Command {
  const update: Partial<AgentState> = {
    messages: [response],
    currentTodoIndex: nextIndex,
    taskCompleted: true,
    iterationCount: 0,
  };

  if (allDone) {
    update.taskStatus = "completed" as const;
  }

  return new Command({
    update,
    goto: allDone ? END : "executor",
  });
}

/**
 * 创建一个继续执行当前任务的命令
 */
export function continueExecution(
  response: any,
  iterationCount: number,
): Command {
  return new Command({
    update: {
      messages: [response],
      iterationCount,
    },
    goto: "executor",
  });
}

/**
 * 创建一个工具调用命令
 */
export function routeToTools(
  response: any,
  iterationCount: number,
  pendingToolCalls: any[],
): Command {
  return new Command({
    update: {
      messages: [response],
      pendingToolCalls,
      iterationCount,
    },
    goto: "tools",
  });
}

/**
 * 创建一个需要审批的工具调用命令
 */
export function routeToReview(
  response: any,
  iterationCount: number,
  pendingToolCalls: any[],
): Command {
  return new Command({
    update: {
      messages: [response],
      pendingToolCalls,
      iterationCount,
    },
    goto: "review",
  });
}

// ============================================================================
// 消息检测辅助函数
// ============================================================================

/**
 * 检查是否达到最大迭代次数
 */
export function isMaxIterationsReached(
  iterationCount: number,
  maxIterations?: number,
): boolean {
  return iterationCount >= (maxIterations ?? CONSTANTS.MAX_ITERATIONS);
}

/**
 * 检查是否所有任务已完成
 */
export function areAllTasksComplete(
  currentTodoIndex: number,
  todosLength: number,
): boolean {
  return todosLength > 0 && currentTodoIndex >= todosLength;
}

/**
 * 检查消息是否为 AI 消息
 */
export function isAIMessage(message: any): boolean {
  return (
    message &&
    (message.constructor.name === "AIMessage" || message._getType?.() === "ai")
  );
}

/**
 * 检查消息是否为 Tool 消息
 */
export function isToolMessage(message: any): boolean {
  return (
    message &&
    (message._getType?.() === "tool" ||
      message.constructor.name === "ToolMessage")
  );
}

/**
 * 检查消息是否有工具调用
 */
export function hasToolCalls(message: any): boolean {
  return message && (message as any).tool_calls?.length > 0;
}

/**
 * 获取最近的 AI 消息
 */
export function getRecentAIMessages(messages: any[], count = 5): any[] {
  return messages.slice(-count).filter(isAIMessage);
}

/**
 * 获取最近的 Tool 消息
 */
export function getRecentToolMessages(messages: any[], count = 10): any[] {
  return messages.slice(-count).filter(isToolMessage);
}

/**
 * 获取带工具调用的消息
 */
export function getMessagesWithToolCalls(messages: any[], count = 15): any[] {
  return messages.slice(-count).filter(hasToolCalls);
}

/**
 * 查找最近的用户消息
 */
export function findLastUserMessage(messages: any[]): any | undefined {
  return messages
    .slice()
    .reverse()
    .find((m) => m._getType() === "human");
}

/**
 * 查找文件上下文消息
 */
export function findFileContextMessage(messages: any[]): any | undefined {
  return messages.find(
    (m) =>
      m._getType() === "system" &&
      String(m.content).includes("Referenced Files Context"),
  );
}

// ============================================================================
// 循环检测辅助函数
// ============================================================================

/**
 * 检测最近的 AI 消息是否有重复内容
 */
export function detectDuplicateAIContent(messages: any[]): boolean {
  const lastAIMessages = getRecentAIMessages(messages, 5);

  if (lastAIMessages.length < 2) {
    return false;
  }

  const lastContent = String(
    lastAIMessages[lastAIMessages.length - 1]?.content || "",
  );
  const prevContent = String(
    lastAIMessages[lastAIMessages.length - 2]?.content || "",
  );

  const duplicatePrefix =
    lastContent.substring(0, CONSTANTS.DUPLICATE_CONTENT_LENGTH) ===
    prevContent.substring(0, CONSTANTS.DUPLICATE_CONTENT_LENGTH);
  const hasMinLength = lastContent.length > CONSTANTS.MIN_CONTENT_LENGTH;

  return duplicatePrefix && hasMinLength;
}

/**
 * 检测是否有重复的工具调用（循环检测）
 */
export function detectDuplicateToolCalls(messages: any[]): {
  hasLoop: boolean;
  toolName?: string;
  count?: number;
} {
  const recentMessages = messages.slice(-CONSTANTS.MAX_RECENT_MESSAGES);
  const toolCallMessages = getMessagesWithToolCalls(recentMessages);

  if (toolCallMessages.length < CONSTANTS.DUPLICATE_TOOL_CALL_COUNT) {
    return { hasLoop: false };
  }

  const recentToolCalls = toolCallMessages
    .slice(-CONSTANTS.DUPLICATE_TOOL_CALL_COUNT)
    .map((m) => {
      const calls = (m as any).tool_calls || [];
      return calls.map((tc: any) => tc.name).join(",");
    });

  const uniqueCalls = new Set(recentToolCalls);

  if (uniqueCalls.size === 1 && recentToolCalls[0]) {
    return {
      hasLoop: true,
      toolName: recentToolCalls[0],
      count: recentToolCalls.length,
    };
  }

  return { hasLoop: false };
}

/**
 * 检测重复的无工具调用的 AI 回复
 */
export function detectDuplicatePlainAIResponses(messages: any[]): boolean {
  const recentMessages = messages.slice(-CONSTANTS.MAX_RECENT_MESSAGES);
  const recentAIMessages = recentMessages
    .filter((m) => isAIMessage(m) && !hasToolCalls(m))
    .slice(-3);

  if (recentAIMessages.length < 3) {
    return false;
  }

  const messageContents = recentAIMessages.map((m) => {
    const content = String((m as any).content || "");
    return content
      .substring(0, CONSTANTS.SIMILARITY_CHECK_LENGTH)
      .trim()
      .toLowerCase();
  });

  const allSimilar = messageContents.every((content, i) => {
    if (i === 0) return true;
    const prev = messageContents[i - 1];
    return (
      content === prev ||
      content.includes(prev.substring(0, 100)) ||
      prev.includes(content.substring(0, 100))
    );
  });

  return allSimilar && messageContents[0].length > CONSTANTS.MIN_CONTENT_LENGTH;
}

// ============================================================================
// 摘要相关辅助函数
// ============================================================================

/**
 * 计算摘要切分点（确保不会切在 ToolMessage 上）
 */
export function calculateSummaryCutIndex(
  messages: any[],
  keepCount: number,
): number {
  let cutIndex = messages.length - keepCount;

  // 安全回溯：确保切分点不落在 ToolMessage 上
  while (
    cutIndex > 0 &&
    (isToolMessage(messages[cutIndex]) ||
      messages[cutIndex].constructor.name === "ToolMessage")
  ) {
    cutIndex--;
  }

  return cutIndex;
}

/**
 * 创建消息删除操作
 */
export function createRemoveOperations(messages: any[]): RemoveMessage[] {
  return messages
    .filter((m) => m.id !== undefined && m.id !== null)
    .map((m) => new RemoveMessage({ id: m.id! }));
}

// ============================================================================
// 字符串处理辅助函数
// ============================================================================

/**
 * 截断项目树文本
 */
export function truncateProjectTree(text: string, maxLength?: number): string {
  const maxLen = maxLength ?? CONSTANTS.MAX_TREE_LENGTH;
  if (text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen) + "\n...（已截断）";
}

/**
 * 安全地将内容转换为字符串
 */
export function safeToString(content: any): string {
  return String(content ?? "");
}

/**
 * 检查内容是否包含特定关键词（不区分大小写）
 */
export function containsKeyword(content: string, keywords: string[]): boolean {
  const lowerContent = content.toLowerCase();
  return keywords.some((keyword) =>
    lowerContent.includes(keyword.toLowerCase()),
  );
}
