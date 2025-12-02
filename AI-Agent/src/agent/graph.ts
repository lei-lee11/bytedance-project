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
  const todos = state.todos ?? [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;
  
  // 添加调试日志，帮助追踪工作流状态
  console.log(`[路由调试] 当前状态 - todos长度: ${todos.length}, 当前索引: ${currentTodoIndex}`);
  if (currentTodoIndex < todos.length) {
    console.log(`[路由调试] 当前任务: ${todos[currentTodoIndex]}`);
  }

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

  // 2. 检查是否有工具执行结果（表示刚完成了一次工具调用）
  // 注意：这里不推进索引，工具执行后会直接回到agent继续处理当前任务
  if (lastMessage && lastMessage._getType() === "tool_result") {
    console.log(`[路由调试] 收到工具执行结果，回到agent继续处理当前任务`);
    // 工具执行后回到agent，继续处理当前任务，不推进索引
    // 这种情况下不需要显式返回，因为我们已经修改了工作流连接
  }

  // 3. 检查 todo 是否已经全部完成
  const hasTodos = todos.length > 0;
  const allTodosDone = hasTodos && currentTodoIndex >= todos.length;
  
  // 关键修复：确保当所有todo完成时正确结束工作流
  if (allTodosDone) {
    console.log(`[路由调试] 所有todo已完成，结束工作流`);
    return END;
  }

  // 4. 判断当前任务是否真正完成（这是关键判断）
  // 只有当没有工具调用，也不是工具执行结果，且有明确的任务总结或完成信息时，才认为任务完成
  if (hasTodos && currentTodoIndex < todos.length) {
    // 检查最后一条消息是否是agent的总结性回复
    const isTaskSummary = lastMessage && isAIMessage(lastMessage) && 
                         typeof lastMessage.content === 'string' &&
                         lastMessage.content.trim().length > 0;
    
    if (isTaskSummary) {
      console.log(`[路由调试] 检测到任务总结性回复，认为任务完成，推进到下一个任务`);
      // 返回continue会推进索引，再执行下一个任务
      return "continue";
    } else {
      console.log(`[路由调试] 未检测到明确的任务完成信号，继续处理当前任务`);
      // 没有明确的任务完成信号，继续处理当前任务
      // 这种情况通常不会发生，因为没有工具调用也没有内容会走到这里
    }
  }

  // 5. 不走 todo 流程时，按老逻辑看是否需要总结
  if (messages.length > 30) {
    console.log(`[路由调试] 消息过多，需要总结`);
    return "summarize";
  }

  // 6. 默认结束
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
  // 敏感工具 -> 人工审批 -> 工具 -> 回到agent继续处理当前任务
  .addEdge("human_review", "toolNode")
  .addEdge("toolNode", "toolExecutor")
  .addEdge("toolExecutor", "agent") // 关键修复：工具执行后回到agent继续处理当前任务，不推进索引
  // 只有真正完成任务时才通过continue路由推进索引
  .addEdge("advance_todo", "inject_project_tree") // 索引推进后更新项目结构
  .addEdge("inject_project_tree", "agent") // 开始执行下一个任务
  // 总结只是压缩上下文，不结束，继续agent
  .addEdge("summarize", "agent");

export const graph = workflow.compile({
  checkpointer,
  interruptBefore: ["human_review"],
});
