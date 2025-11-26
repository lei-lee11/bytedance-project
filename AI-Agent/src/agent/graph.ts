import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.js";
import { checkpointer } from "../config/checkpointer.js";
import { summarizeConversation, toolNode, agent } from "./nodes.ts";

// 创建图实例
async function routeAgentOutput(state: AgentState) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  //1.检查工具调用
  if (
    lastMessage &&
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    return "toolNode";
  }
  // 2. 如果没有工具调用，再检查是否需要总结
  if (messages.length > 6) {
    return "summarize";
  }
  // 3. 既无工具也无须总结，则结束
  return END;
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("summarize", summarizeConversation)
  .addNode("agent", agent)
  .addNode("tool", toolNode)
  .addEdge(START, "agent")
  .addEdge("tool", "agent")
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "tool",
    summarize: "summarize",
    [END]: END,
  })
  .addEdge("summarize", END);
export const graph = workflow.compile();
