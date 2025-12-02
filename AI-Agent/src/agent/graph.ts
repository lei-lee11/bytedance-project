import { StateGraph, START, END } from "@langchain/langgraph";
import { isAIMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { MemorySaver } from "@langchain/langgraph";
import { SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import {
  summarizeConversation,
  toolNode,
  toolExecutor,
  agent,
  humanReviewNode,
  projectPlannerNode,
  taskPlannerNode,
} from "./nodes.ts";

const checkpointer = new MemorySaver();

// 创建图实例
async function routeAgentOutput(state: AgentState) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  // 1. 优先检查是否有工具调用
  if (
    lastMessage &&
    isAIMessage(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    const hasSensitiveTool = lastMessage.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    if (hasSensitiveTool) {
      return "human_review"; // 路由到审批节点
    }

    return "toolNode"; // 安全工具，直接执行
  }

  // 2. 没有工具调用，检查 todo 是否已经全部完成
  const todos = state.todos ?? [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;

  const hasTodos = todos.length > 0;
  const allTodosDone = hasTodos && currentTodoIndex >= todos.length;

  if (allTodosDone) {
    // 所有 todo 都做完了，整个项目结束
    return END;
  }

  // 3. 如果还有 todo 没做完，就继续让 agent 处理下一轮
  if (hasTodos && currentTodoIndex < todos.length) {
    // 这里不单独搞 advanceTodo 节点，
    // 而是让 agent 自己根据 currentTodoIndex 更新 / 继续执行
    return "continue";
  }

  // 4. 不走 todo 流程时（比如没定义 todos），按老逻辑看是否需要总结
  if (messages.length > 30) {
    return "summarize";
  }

  // 5. 默认结束
  return END;
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("project_planner", projectPlannerNode)   // 架构规划，生成 projectPlanText & projectInitSteps
  .addNode("task_planner", taskPlannerNode)         // 根据项目规划生成 todos
  .addNode("summarize", summarizeConversation)
  .addNode("agent", agent)
  .addNode("toolNode", toolNode)
  .addNode("toolExecutor", toolExecutor)
  .addNode("human_review", humanReviewNode)
  .addNode("advance_todo", async (state) => {
    // 简单桥接：返回 partial state 来推进索引
    return { currentTodoIndex: (state.currentTodoIndex ?? 0) + 1 };
  })
  // 入口：先跑 project_planner -> task_planner -> agent
  .addEdge(START, "project_planner")
  .addEdge("project_planner", "task_planner")
  .addEdge("task_planner", "agent")
  // agent 输出后，根据路由决定下一步
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "toolExecutor",        // 安全工具 -> 直接交给 toolExecutor 执行并记录
    human_review: "human_review", // 节点名保持一致
    summarize: "summarize",
    continue: "agent",           // ✅ 不用 advanceTodo，直接回 agent 继续下一轮
    [END]: END,
  })
  // 敏感工具 -> 人工审批 -> 工具 -> agent
  .addEdge("human_review", "toolNode")
  .addEdge("toolNode", "toolExecutor")
  .addEdge("toolExecutor", "advance_todo")
  .addEdge("advance_todo", "agent")
  // 总结只是压缩上下文，不结束，继续 agent
  .addEdge("summarize", "agent");

export const graph = workflow.compile({
  checkpointer,
  interruptBefore: ["human_review"],
});
