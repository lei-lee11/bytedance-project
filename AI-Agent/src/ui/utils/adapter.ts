import { HistoryRecord, EventType } from "../../storage/types.js"; // 确保路径指向你的存储类型定义

export interface UIMessage {
  id: string;
  role: "user" | "ai" | "system" | "tool";
  content: string;
  reasoning?: string;
  toolName?: string;
  isSuccess?: boolean;
  metadata?: any; // 新增：保留原始 metadata 以备不时之需
}

export const toUIMessage = (record: HistoryRecord): UIMessage => {
  const base = {
    id: record.timestamp.toString(), // 使用时间戳作为 ID
    content: record.content,
    // 从 metadata 中提取 reasoning，兼容之前的格式
    reasoning: record.metadata?.reasoning,
    metadata: record.metadata,
  };

  switch (record.event_type) {
    case "user_message":
      return { ...base, role: "user" };

    case "ai_response":
      return { ...base, role: "ai" };

    case "tool_call": {
      // 强转类型以访问 metadata 中的工具特定字段
      // 假设你的存储层在 metadata 里存了这些 info
      const meta = record.metadata || {};
      return {
        ...base,
        role: "tool",
        // 如果 content 是空的，尝试构造一个
        content: record.content || `Executed ${meta.tool_name || "tool"}`,
        toolName: meta.tool_name,
        isSuccess: !meta.error,
      };
    }

    case "system_summarize":
    case "session_created":
    case "session_updated":
    case "error":
    default:
      return { ...base, role: "system" };
  }
};

// 用于将 UI 角色转换为存储事件类型
export const toBackendEventType = (role: string): EventType => {
  switch (role) {
    case "user":
      return "user_message";
    case "ai":
      return "ai_response";
    case "tool":
      return "tool_call";
    default:
      return "session_updated"; // 或者 system_summarize
  }
};
