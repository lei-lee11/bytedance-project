import { StateGraph, START, END } from "@langchain/langgraph";
import { isAIMessage, SystemMessage } from "@langchain/core/messages";
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
  injectProjectTreeNode,
} from "./nodes.ts";

const checkpointer = new MemorySaver();

// wrapNode: 在每个节点执行前，把当前节点名写入 state.messages（SystemMessage）并在控制台打印，
// 这样在运行智能体时可以观察当前执行的是哪个节点。
function wrapNode<T extends (...args: unknown[]) => unknown>(name: string, fn: T): T {
  const wrapper = (async (state: AgentState) => {
    try {
      const note = new SystemMessage({ content: `[node] running: ${name}` });
      if (Array.isArray(state.messages)) {
        state.messages.push(note);
      }
    } catch (e) {
      // ignore
    }
    console.log(`[node] running: ${name}`);
    return (fn as unknown as (...args: unknown[]) => unknown)(state as unknown as Parameters<T>[0]);
  }) as unknown as T;
  return wrapper;
}

// 创建图实例
async function routeAgentOutput(state: AgentState) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  
  // 添加调试日志，帮助追踪工作流状态
  console.log(`[路由调试] 当前状态 - todos长度: ${state.todos?.length || 0}, 当前索引: ${state.currentTodoIndex || 0}`);

  // 1. 优先检查是否有工具调用
  if (
    lastMessage &&
    isAIMessage(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    console.log(`[路由调试] 检测到工具调用: ${lastMessage.tool_calls?.map(t => t.name).join(', ')}`);
    const hasSensitiveTool = lastMessage.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    if (hasSensitiveTool) {
      console.log(`[路由调试] 包含敏感工具，路由到人工审批`);
      return "human_review"; // 路由到审批节点
    }

    console.log(`[路由调试] 普通工具，路由到toolNode`);
    return "toolNode"; // 安全工具，直接执行
  }

  // 2. 没有工具调用，检查 todo 是否已经全部完成
  const todos = state.todos ?? [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;
  const hasTodos = todos.length > 0;
  const allTodosDone = hasTodos && currentTodoIndex >= todos.length;
  
  // 关键修复：确保当所有todo完成时正确结束工作流
  if (allTodosDone) {
    console.log(`[路由调试] 所有todo已完成，结束工作流`);
    // 所有 todo 都做完了，整个项目结束
    return END;
  }

  // 3. 如果还有 todo 没做完，继续执行下一个任务
  if (hasTodos && currentTodoIndex < todos.length) {
    console.log(`[路由调试] 继续执行todo ${currentTodoIndex + 1}/${todos.length}: ${todos[currentTodoIndex]}`);
    // 返回continue会先推进索引，再执行下一个任务
    return "continue";
  }

  // 4. 不走 todo 流程时，按老逻辑看是否需要总结
  if (messages.length > 30) {
    console.log(`[路由调试] 消息过多，需要总结`);
    return "summarize";
  }

  // 5. 默认结束
  console.log(`[路由调试] 默认结束工作流`);
  return END;
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("project_planner", wrapNode("project_planner", projectPlannerNode))   // 架构规划，生成 projectPlanText & projectInitSteps
  .addNode("task_planner", wrapNode("task_planner", taskPlannerNode))         // 根据项目规划生成 todos
  .addNode("summarize", wrapNode("summarize", summarizeConversation))
  .addNode("agent", wrapNode("agent", agent))
  .addNode("toolNode", toolNode)
  .addNode("toolExecutor", wrapNode("toolExecutor", toolExecutor))
  .addNode("human_review", wrapNode("human_review", humanReviewNode))
  .addNode("advance_todo", async (state) => {
    // 安全地推进索引：确保索引不会超过todos数组长度
    const currentIndex = state.currentTodoIndex ?? 0;
    const todosLength = state.todos?.length ?? 0;
    
    // 只有当当前索引小于todos长度时才增加索引
    const newIndex = currentIndex < todosLength ? currentIndex + 1 : currentIndex;
    
    console.log(`[advance_todo] 索引更新: ${currentIndex} -> ${newIndex}, todos长度: ${todosLength}`);
    return { currentTodoIndex: newIndex };
  }),
  .addNode("inject_project_tree", wrapNode("inject_project_tree", injectProjectTreeNode))
  // 入口：先跑 project_planner -> task_planner -> inject_project_tree -> agent
  .addEdge(START, "project_planner")
  .addEdge("project_planner", "task_planner")
  .addEdge("task_planner", "inject_project_tree")
  .addEdge("inject_project_tree", "agent")
  // agent 输出后，根据路由决定下一步
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "toolExecutor",        // 安全工具 -> 直接交给 toolExecutor 执行并记录
    human_review: "human_review", // 节点名保持一致
    summarize: "summarize",
    continue: "advance_todo", // 关键修复：任务完成后先推进索引，再执行下一个任务
    [END]: END,
  })
  // 敏感工具 -> 人工审批 -> 工具 -> 索引推进 -> inject_project_tree -> agent
  .addEdge("human_review", "toolNode")
  .addEdge("toolNode", "toolExecutor")
  .addEdge("toolExecutor", "advance_todo")
  .addEdge("advance_todo", "inject_project_tree") // 重要修复：索引推进后经过inject_project_tree再到agent
  .addEdge("inject_project_tree", "agent")
  // 总结只是压缩上下文，不结束，继续agent
  .addEdge("summarize", "agent");

export const graph = workflow.compile({
  checkpointer,
  interruptBefore: ["human_review"],
});
