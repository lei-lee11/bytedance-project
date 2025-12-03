import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { MemorySaver } from "@langchain/langgraph";
import { SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import {
  summarizeConversation,
  toolNode,
  toolExecutor,
  agent,
  humanReviewNode,
  processReferencedFiles,
  injectProjectTreeNode,
  intentNode,
  plannerNode,
} from "./nodes.ts";

const checkpointer = new MemorySaver();

// wrapNode: 在每个节点执行前，把当前节点名写入 state.messages（SystemMessage）并在控制台打印，
// 这样在运行智能体时可以观察当前执行的是哪个节点。
function wrapNode<T extends (...args: unknown[]) => unknown>(
  name: string,
  fn: T,
): T {
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
    return (fn as unknown as (...args: unknown[]) => unknown)(
      state as unknown as Parameters<T>[0],
    );
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

    console.log(`[路由调试] 普通工具，路由到toolNode`);
    return "toolNode"; // 安全工具，直接执行
  }

  // 2. 检查是否有工具执行结果（表示刚完成了一次工具调用）
  // 注意：这里不推进索引，工具执行后会直接回到agent继续处理当前任务
  if (lastMessage && lastMessage._getType() === "tool_result") {
    console.log(`[路由调试] 收到工具执行结果，回到agent继续处理当前任务`);
    // 明确返回agent，确保工具执行后回到agent继续处理当前任务，不推进索引
    return "agent";
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
    const isTaskSummary =
      lastMessage &&
      AIMessage.isInstance(lastMessage) &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.trim().length > 0;

    if (isTaskSummary && typeof lastMessage.content === "string") {
      // 增强任务完成判断：检查是否包含完成相关的关键词
      const content = lastMessage.content.toLowerCase();

      // 明确的完成信号
      const completionSignals = [
        "已完成",
        "完成",
        "任务完成",
        "已实现",
        "实现了",
        "success",
        "completed",
        "done",
        "✅",
        "已结束",
        "结束了",
        "已完成当前任务",
        "本任务已完成",
        "已达成目标",
      ];

      // 任务未完成的信号（避免重复）
      const notCompleteSignals = [
        "我会",
        "我将",
        "计划",
        "准备",
        "需要",
        "下一步",
        "接下来",
        "让我们",
        "我们需要",
        "让我来",
      ];

      // 检查是否包含完成信号
      const containsCompletionSignal = completionSignals.some((signal) =>
        content.includes(signal.toLowerCase()),
      );

      // 检查是否明确提到正在处理当前任务
      const explicitlyHandlingTask =
        content.includes("正在处理") &&
        (content.includes("任务") || content.includes(currentTaskLower));

      // 检查是否包含未完成信号
      const containsNotCompleteSignal = notCompleteSignals.some((signal) =>
        content.includes(signal.toLowerCase()),
      );

      // 检查是否有工具执行结果的引用
      const referencesToolResult =
        content.includes("根据") ||
        content.includes("执行结果") ||
        content.includes("显示") ||
        content.includes("返回");

      // 优先级判断逻辑
      if (containsCompletionSignal) {
        console.log(`[路由调试] 检测到明确的任务完成信号，推进到下一个任务`);
        return "continue"; // 推进索引，执行下一个任务
      } else if (explicitlyHandlingTask && !containsNotCompleteSignal) {
        // 如果明确表示正在处理当前任务但没有未完成信号，可能需要继续
        console.log(`[路由调试] 明确表示正在处理当前任务，继续处理`);
        return "agent";
      } else if (referencesToolResult && !containsCompletionSignal) {
        // 引用了工具结果但没有完成信号，继续处理
        console.log(`[路由调试] 引用工具结果，继续处理`);
        return "agent";
      } else if (content.length > 500 && !containsCompletionSignal) {
        // 长文本但没有完成信号，可能是详细说明，继续处理
        console.log(`[路由调试] 长文本响应，继续处理`);
        return "agent";
      } else {
        console.log(
          `[路由调试] 虽有回复但未检测到明确的任务完成信号，可能需要进一步交互`,
        );
        return END; // 如果没有明确的完成信号，结束工作流避免重复
      }
    } else {
      console.log(`[路由调试] 未检测到明确的任务完成信号，继续处理当前任务`);
      // 如果到达这里，可能是工作流异常，返回agent继续
      return "agent";
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
  .addNode("processReferencedFiles", processReferencedFiles)
  .addNode("intentNode", wrapNode("intentNode", intentNode)) // 任务意图分类，只跑一次
  .addNode("planner", wrapNode("planner", plannerNode)) // 总调度规划器，根据mode分发
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
    const newIndex =
      currentIndex < todosLength ? currentIndex + 1 : currentIndex;

    console.log(
      `[advance_todo] 索引更新: ${currentIndex} -> ${newIndex}, todos长度: ${todosLength}`,
    );
    return { currentTodoIndex: newIndex };
  })
  .addNode(
    "inject_project_tree",
    wrapNode("inject_project_tree", injectProjectTreeNode),
  )
  // 入口：先跑 processReferencedFiles -> intentNode（任务分类）-> planner（总调度）-> inject_project_tree -> agent
  .addEdge(START, "processReferencedFiles")
  .addEdge("processReferencedFiles", "intentNode")
  .addEdge("intentNode", "planner")
  .addEdge("planner", "inject_project_tree")
  .addEdge("inject_project_tree", "agent")
  // agent 输出后，根据路由决定下一步
  .addConditionalEdges("agent", routeAgentOutput, {
    toolNode: "toolExecutor", // 安全工具 -> 直接交给 toolExecutor 执行并记录
    human_review: "human_review", // 节点名保持一致
    summarize: "summarize",
    continue: "advance_todo", // 关键修复：任务完成后先推进索引，再执行下一个任务
    agent: "agent", // 明确添加agent到agent的自连接，用于工具执行后继续当前任务
    [END]: END,
  })
  // 敏感工具 -> 人工审批 -> 工具 -> 回到agent继续处理当前任务
  .addEdge("human_review", "toolNode")
  .addEdge("toolNode", "toolExecutor")
  .addEdge("toolExecutor", "agent") // 关键修复：工具执行后回到agent继续处理当前任务，不推进索引
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
