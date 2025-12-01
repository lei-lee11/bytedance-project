import {
  HistoryRecord,
  ToolCallRecord,
  EventType,
} from "../../storage/types.js";

export interface UIMessage {
  id: string;
  role: "user" | "ai" | "system" | "tool";
  content: string;
  reasoning?: string;
  toolName?: string;
  isSuccess?: boolean;
}

export const toUIMessage = (record: HistoryRecord): UIMessage => {
  const base = {
    id: record.timestamp.toString(),
    content: record.content,
    reasoning: record.metadata?.reasoning,
  };

  switch (record.event_type) {
    case "user_message":
      return { ...base, role: "user" };

    case "ai_response":
      return { ...base, role: "ai" };

    case "tool_call": {
      const toolRecord = record as ToolCallRecord;
      return {
        ...base,
        role: "tool",
        content: `Executed ${toolRecord.tool_name}`,
        toolName: toolRecord.tool_name,
        isSuccess: !toolRecord.error,
      };
    }

    case "system_summarize":
    case "session_created":
    case "session_updated":
    default:
      return { ...base, role: "system" };
  }
};

export const toBackendEventType = (role: string): EventType => {
  switch (role) {
    case "user":
      return "user_message";
    case "ai":
      return "ai_response";
    case "tool":
      return "tool_call";
    default:
      return "session_updated";
  }
};
