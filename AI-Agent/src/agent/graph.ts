import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { initializeCheckpointer } from "../config/checkpointer.js";
import { SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import {
  summarizeConversation,
  toolNode,
  agent,
  humanReviewNode,
} from "./nodes.ts";

// 延迟初始化的检查点保存器
let checkpointer: any; // 将动态初始化为 LangGraphStorageAdapter
// 创建图实例
async function routeAgentOutput(state: AgentState) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  // 1. 检查是否有工具调用
  if (
    lastMessage &&
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    // 检查敏感性
    const hasSensitiveTool = lastMessage.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    if (hasSensitiveTool) {
      return "human_review"; // 路由到审批节点
    }

    return "toolNode"; // 安全工具，直接执行
  }

  // 2. 检查是否需要总结 (保留你之前的逻辑)
  if (messages.length > 6) {
    return "summarize";
  }

  // 3. 结束
  return END;
}
const workflow = new StateGraph(StateAnnotation)
  .addNode("summarize", summarizeConversation)
  .addNode("agent", agent)
  .addNode("tool", toolNode)
  .addNode("human_review", humanReviewNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "tool", // 安全工具 -> 直接执行
    human_review: "human_review", // 敏感工具 -> 去审批
    summarize: "summarize",
    [END]: END,
  })
  .addEdge("human_review", "tool")
  .addEdge("tool", "agent")
  .addEdge("summarize", END);
// 初始化图的函数
export async function initializeGraph() {
  if (!checkpointer) {
    checkpointer = await initializeCheckpointer();
  }

  return workflow.compile({
    checkpointer: checkpointer,
    interruptBefore: ["human_review"],
  });
}

// 延迟编译图，等待检查点初始化
export let graph: any;
