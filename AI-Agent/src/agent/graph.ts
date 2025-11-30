import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { MemorySaver } from "@langchain/langgraph";
//import { checkpointer } from "../config/checkpointer.js";
import { SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import {
  summarizeConversation,
  toolNode,
  agent,
  humanReviewNode,
} from "./nodes.ts";

const checkpointer = new MemorySaver();
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
  .addNode("toolNode", toolNode) // 使用与导出变量相同的节点名称
  .addNode("human_review", humanReviewNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "toolNode", // 安全工具 -> 直接执行
    human_review: "human_review", // 敏感工具 -> 去审批
    summarize: "summarize",
    [END]: END,
  })
  .addEdge("human_review", "toolNode") // 更新边连接
  .addEdge("toolNode", "agent") // 更新边连接
  .addEdge("summarize", END);
export const graph = workflow.compile({
  checkpointer: checkpointer,
  interruptBefore: ["human_review"],
});
