import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { MemorySaver } from "@langchain/langgraph";
import { SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import {
  summarizeConversation,
  toolExecutor,
  agent,
  humanReviewNode,
  processReferencedFiles,
  injectProjectTreeNode,
  intentNode,
  plannerNode,
  updateRecentActionsNode,
} from "./nodes.ts";

const checkpointer = new MemorySaver();

// wrapNode: 在每个节点执行前，把当前节点名写入 state.messages（SystemMessage）并在控制台打印，
// 这样在运行智能体时可以观察当前执行的是哪个节点。
function wrapNode<T extends (...args: unknown[]) => unknown>(
  name: string,
  fn: T,
): T {
  const wrapper = (async (state: AgentState) => {
    console.log(`[node] running: ${name}`);
    // 执行原始节点函数
    const result = await (fn as unknown as (...args: unknown[]) => Promise<unknown>)(
      state as unknown as Parameters<T>[0],
    );
    
    // 创建节点运行记录消息
    const note = new SystemMessage({ content: `[node] running: ${name}` });
    
    // 构建返回值，确保合并原始结果和新消息
    const previousMessages = Array.isArray((result as { messages?: unknown })?.messages)
      ? ((result as { messages?: SystemMessage[] }).messages ?? [])
      : state.messages || [];

    const wrappedResult = {
      ...(result as Record<string, unknown>),
      messages: [...previousMessages, note],
    };
    
    return wrappedResult as unknown as ReturnType<T>;
  }) as unknown as T;
  return wrapper;
}

// 创建图实例
async function routeAgentOutput(state: AgentState) {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  const todos = state.todos ?? [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;

  // 获取当前任务描述
  const currentTask =
    currentTodoIndex < todos.length ? todos[currentTodoIndex] : "";
  const currentTaskLower = currentTask.toLowerCase();

  // 添加调试日志，帮助追踪工作流状态
  console.log(
    `[路由调试] 当前状态 - todos长度: ${todos.length}, 当前索引: ${currentTodoIndex}`,
  );
  if (currentTodoIndex < todos.length) {
    console.log(`[路由调试] 当前任务: ${todos[currentTodoIndex]}`);
  }

  // 1. 优先检查是否有工具调用
  if (
    lastMessage &&
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    console.log(
      `[路由调试] 检测到工具调用: ${lastMessage.tool_calls?.map((t) => t.name).join(", ")}`,
    );
    const hasSensitiveTool = lastMessage.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    if (hasSensitiveTool) {
      console.log(`[路由调试] 包含敏感工具，路由到人工审批`);
      return "human_review"; // 路由到审批节点
    }

    console.log(`[路由调试] 普通工具，直接路由到toolExecutor`);
    return "toolExecutor"; // 安全工具，直接交给自定义的toolExecutor执行
  }

  // 2. 检查是否有工具执行结果（表示刚完成了一次工具调用）
  // 注意：这里不推进索引，工具执行后会直接回到agent继续处理当前任务
  if (lastMessage && ToolMessage.isInstance(lastMessage)) {
    console.log(`[路由调试] 收到工具执行结果，回到agent继续处理当前任务`);
    // 明确返回agent，确保工具执行后回到agent继续处理当前任务，不推进索引
    return "agent";
  }

  const hasTodos = todos.length > 0;
  const allTodosDone = hasTodos && currentTodoIndex >= todos.length;

  if (allTodosDone) {
    console.log(`[路由调试] 所有todo已完成，结束工作流`);
    return END;
  }

  if (hasTodos && currentTodoIndex < todos.length && state.taskCompleted) {
    console.log(`[路由调试] agent标记任务完成，推进到下一个任务`);
    return "continue";
  }

  if (messages.length > 30) {
    console.log(`[路由调试] 消息过多，需要总结`);
    return "summarize";
  }

  if (hasTodos) {
    console.log(`[路由调试] 继续执行当前任务`);
    return "agent";
  }

  if (todos.length === 0) {
    console.log(`[路由调试] todos为空，回到agent等待新输入`);
    return "agent";
  }

  console.log(`[路由调试] 所有任务完成，结束工作流`);
  return END;
}

const workflow = new StateGraph(StateAnnotation)
  .addNode("processReferencedFiles", processReferencedFiles)
  .addNode("intent", wrapNode("intent", intentNode)) // 任务意图分类，只跑一次
  .addNode("planner", wrapNode("planner", plannerNode)) // 总调度规划器，根据mode分发
  .addNode("summarize", wrapNode("summarize", summarizeConversation))
  .addNode("agent", wrapNode("agent", agent))
  .addNode("toolExecutor", wrapNode("toolExecutor", toolExecutor))
  .addNode("update_recent_actions", wrapNode("update_recent_actions", updateRecentActionsNode)) // 新增：更新最近操作记录
  .addNode("human_review", wrapNode("human_review", humanReviewNode))
  .addNode("advance_todo", async (state) => {
    if (!state.taskCompleted) {
      console.log(
        `[advance_todo] 未检测到任务完成信号，保持索引 ${state.currentTodoIndex ?? 0}`,
      );
      return {};
    }

    const currentIndex = state.currentTodoIndex ?? 0;
    const todosLength = state.todos?.length ?? 0;
    const newIndex = currentIndex < todosLength ? currentIndex + 1 : currentIndex;

    console.log(
      `[advance_todo] 索引更新: ${currentIndex} -> ${newIndex}, todos长度: ${todosLength}`,
    );

    return {
      currentTodoIndex: newIndex,
      taskCompleted: false,
    };
  })
  .addNode(
    "inject_project_tree",
    wrapNode("inject_project_tree", injectProjectTreeNode),
  )
  // 入口：先跑 processReferencedFiles -> intent（任务分类）-> planner（总调度）-> inject_project_tree -> agent
  .addEdge(START, "processReferencedFiles")
  .addEdge("processReferencedFiles", "intent")
  .addEdge("intent", "planner")
  .addEdge("planner", "inject_project_tree")
  .addEdge("inject_project_tree", "agent")
  // agent 输出后，根据路由决定下一步
  .addConditionalEdges("agent", routeAgentOutput, {
    toolExecutor: "toolExecutor", // 安全工具 -> 直接交给自定义的toolExecutor执行
    human_review: "human_review", // 节点名保持一致
    summarize: "summarize",
    continue: "advance_todo", // 关键修复：任务完成后先推进索引，再执行下一个任务
    agent: "agent", // 明确添加agent到agent的自连接，用于工具执行后继续当前任务
    [END]: END,
  })
  // 敏感工具 -> 人工审批 -> 工具执行器 -> 更新操作记录 -> 回到agent继续处理当前任务
  .addEdge("human_review", "toolExecutor")
  .addEdge("toolExecutor", "update_recent_actions") // 工具执行后更新最近操作记录
  .addEdge("update_recent_actions", "agent") // 关键修复：更新操作记录后回到agent继续处理当前任务，不推进索引
  // 只有真正完成任务时才通过continue路由推进索引
  .addConditionalEdges(
    "advance_todo",
    (state) => {
      // 条件判断：检查索引推进后是否还有任务要执行
      const newIndex = state.currentTodoIndex ?? 0;
      const todosLength = state.todos?.length ?? 0;

      console.log(
        `[advance_todo路由] 新索引: ${newIndex}, todos长度: ${todosLength}`,
      );

      // 如果索引已达到或超过todos长度，说明所有任务都已完成，直接结束工作流
      if (newIndex >= todosLength) {
        console.log(`[advance_todo路由] 所有任务已完成，结束工作流`);
        return "end";
      }

      // 否则继续执行下一个任务
      console.log(`[advance_todo路由] 继续执行下一个任务`);
      return "next_task";
    },
    {
      end: END, // 所有任务完成，结束工作流
      next_task: "inject_project_tree", // 继续执行下一个任务
    },
  )
  .addEdge("inject_project_tree", "agent") // 开始执行下一个任务
  // 总结只是压缩上下文，不结束，继续agent
  .addEdge("summarize", "agent");

export const graph = workflow.compile({
  checkpointer,
  interruptBefore: ["human_review"],
});
