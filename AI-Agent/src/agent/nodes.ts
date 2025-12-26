import { END, Command } from "@langchain/langgraph";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  ToolMessage,
  RemoveMessage,
} from "@langchain/core/messages";
import { AgentState } from "./state.ts";
import { SENSITIVE_TOOLS, tools } from "../utils/tools/index.ts";
import { baseModel, modelWithTools } from "../config/model.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { project_tree } from "../utils/tools/project_tree.ts";
import { attachFilesToContext } from "../utils/tools/fileContext.js";
import {
  buildIntentClassificationPrompt,
  buildChatAgentPrompt,
  buildSummaryPrompt,
  buildProjectPlanSystemPrompt,
  buildTaskPlanSystemPrompt,
  buildExecutorProjectPlanContext,
  buildExecutorProjectTreeContext,
  buildExecutorTaskContext,
  buildExecutorSummaryContext,
  buildProjectPlanUserMessage,
  buildTaskPlanUserMessage,
  buildLoopErrorMessage,
  CHAT_ERROR_MESSAGE,
  buildPlanCompleteMessage,
  TASK_COMPLETE_MESSAGE,
  DUPLICATE_LOOP_ALL_DONE_MESSAGE,
  DUPLICATE_LOOP_SKIP_MESSAGE,
  CONSTANTS,
  isAskingForHelp,
  hasCompletionToken,
} from "../agent/prompt.js";
import {
  advanceToNextTodo,
  skipToNextTodo,
  skipToNextTodoWithResponse,
  continueExecution,
  routeToTools,
  routeToReview,
  completeAllTasks,
  isMaxIterationsReached,
  areAllTasksComplete,
  findLastUserMessage,
  findFileContextMessage,
  getRecentAIMessages,
  getRecentToolMessages,
  getMessagesWithToolCalls,
  isAIMessage,
  isToolMessage,
  hasToolCalls,
  detectDuplicateAIContent,
  detectDuplicateToolCalls,
  detectDuplicatePlainAIResponses,
  calculateSummaryCutIndex,
  createRemoveOperations,
  truncateProjectTree,
  safeToString,
} from "./node-helpers.js";
import { z } from "zod";

// ----Schema 定义-------

const ProjectPlanSchema = z.object({
  projectPlanText: z.string(),
  techStackSummary: z.string().nullable().default(""),
  targetDirectory: z
    .string()
    .nullable()
    .describe(
      "项目应该创建的目标文件夹名称/路径，如果当前目录即为根目录则留空",
    ),
  projectInitSteps: z
    .array(z.string())
    .nullable()
    .default(() => []),
});

const TaskPlanSchema = z.object({
  todos: z.array(z.string()),
});

const IntentSchema = z.object({
  intent: z
    .enum(["task", "chat"])
    .describe("用户意图类型：task=编程任务, chat=闲聊"),
  confidence: z.number().min(0).max(1).describe("分类置信度，0-1之间"),
  reasoning: z.string().describe("分类理由"),
});

/**
 * 意图分类节点
 * 判断用户输入是编程任务还是闲聊
 */
export async function intentClassifierNode(state: AgentState) {
  //console.log("[classifier] 开始意图分类");

  try {
    // 获取最新的用户消息
    const lastMessage = state.messages[state.messages.length - 1];
    const userInput = lastMessage.content.toString();

    // console.log(`[classifier] 分析用户输入: ${userInput.substring(0, 100)}...`);

    // 使用结构化输出进行意图分类
    const classificationPrompt = buildIntentClassificationPrompt();
    const modelWithStructuredOutput =
      baseModel.withStructuredOutput(IntentSchema);

    const result = await modelWithStructuredOutput.invoke([
      new SystemMessage(classificationPrompt),
      new HumanMessage(userInput),
    ]);

    // console.log(
    //   `[classifier] 分类结果: ${result.intent}, 置信度: ${result.confidence}, 理由: ${result.reasoning}`,
    // );

    // 根据意图路由
    if (result.intent === "task") {
      //console.log("[classifier] → 路由到 planner（任务模式）");
      return new Command({
        goto: "planner",
      });
    } else {
      // console.log("[classifier] → 路由到 chat（闲聊模式）");
      return new Command({
        goto: "chat",
      });
    }
  } catch (error) {
    //console.error("[classifier] 意图分类失败:", error);
    // 默认路由到闲聊，提供友好体验
    // console.log("[classifier] 错误处理 → 路由到 chat");
    return new Command({
      goto: "chat",
    });
  }
}

/**
 * 闲聊节点
 * 处理非编程任务的对话
 */
export async function chatNode(state: AgentState) {
  try {
    const chatPrompt = buildChatAgentPrompt();
    const response = await baseModel.invoke([
      new SystemMessage(chatPrompt),
      ...state.messages,
    ]);

    return new Command({
      update: { messages: [response] },
      goto: END,
    });
  } catch (error) {
    const errorMessage = new AIMessage({ content: CHAT_ERROR_MESSAGE });
    return new Command({
      update: { messages: [errorMessage] },
      goto: END,
    });
  }
}

/**
 * 初始化节点
 * 处理引用的文件和项目树扫描
 */
export async function initializeNode(state: AgentState) {
  //console.log("[initialize] 开始初始化");

  const updates: Partial<AgentState> = {};

  // 1. 处理引用的文件
  const filePaths = state.pendingFilePaths || [];
  if (filePaths.length > 0) {
    try {
      const projectRoot = state.projectRoot || process.cwd();
      const { formattedContext } = await attachFilesToContext(
        filePaths,
        projectRoot,
      );

      const fileContextMessage = new SystemMessage({
        content: formattedContext,
        additional_kwargs: { message_type: "file_context" },
      });

      updates.messages = [fileContextMessage];
      updates.pendingFilePaths = [];
      //console.log(`[initialize] 处理了 ${filePaths.length} 个文件`);
    } catch (error) {
      // console.error("[initialize] 文件处理失败:", error);
      updates.pendingFilePaths = [];
    }
  }

  // 2. 扫描项目树（如果还没扫描）
  if (!state.projectTreeInjected) {
    try {
      const root = state.projectRoot || ".";
      const treeText = await project_tree.invoke({
        root_path: root,
        max_depth: -1,
        include_hidden: false,
        include_files: true,
        max_entries: 3000,
      });

      updates.projectTreeText = treeText;
      updates.projectTreeInjected = true;
      // console.log("[initialize] 项目树扫描完成");
    } catch (error) {
      // console.error("[initialize] 项目树扫描失败:", error);
    }
  }

  // 路由到意图分类
  return new Command({
    update: updates,
    goto: "classifier",
  });
}

/**
 * 规划节点
 * 生成项目规划和todos任务列表
 */
export async function plannerNode(state: AgentState) {
  const lastMessage = state.messages[state.messages.length - 1];

  const isLastMessagePlanConfirmation =
    lastMessage?.content &&
    String(lastMessage.content).includes("生成了") &&
    String(lastMessage.content).includes("个任务");

  if (isLastMessagePlanConfirmation) {
    return new Command({ goto: "executor" });
  }

  const currentProjectRoot = state.projectRoot || ".";
  const lastUserMsg = findLastUserMessage(state.messages);
  const userRequest = lastUserMsg ? lastUserMsg.content : "";

  // 1. 项目规划
  const fileContextMsg = findFileContextMessage(state.messages);
  const fileContextContent = fileContextMsg
    ? String(fileContextMsg.content)
    : "";

  const projectPlan = await baseModel
    .withStructuredOutput(ProjectPlanSchema)
    .invoke([
      new SystemMessage({ content: buildProjectPlanSystemPrompt() }),
      new HumanMessage({
        content: buildProjectPlanUserMessage(
          currentProjectRoot,
          fileContextContent,
          String(userRequest),
        ),
      }),
    ]);

  const projectPlanText = String(projectPlan.projectPlanText || "");
  const techStackSummary = String(projectPlan.techStackSummary || "");
  const projectInitSteps = Array.isArray(projectPlan.projectInitSteps)
    ? projectPlan.projectInitSteps
    : [];

  // 处理目标目录逻辑
  const targetDir = projectPlan.targetDirectory;
  let mkdirTask: string | null = null;
  let finalProjectRoot = currentProjectRoot;

  if (targetDir && targetDir !== "." && targetDir !== "./") {
    finalProjectRoot = targetDir;
    mkdirTask = `创建并初始化项目根目录: ${targetDir}`;
  }

  // 2. 任务拆解,生成todos列表
  const taskPlan = await baseModel.withStructuredOutput(TaskPlanSchema).invoke([
    new SystemMessage({ content: buildTaskPlanSystemPrompt(finalProjectRoot) }),
    new HumanMessage({
      content: buildTaskPlanUserMessage(
        projectPlanText,
        finalProjectRoot,
        fileContextContent,
        projectInitSteps,
        String(userRequest),
      ),
    }),
  ]);

  let todos = Array.isArray(taskPlan.todos) ? taskPlan.todos : [];

  if (mkdirTask) {
    todos = [mkdirTask, ...todos];
  }

  return new Command({
    update: {
      messages: [
        new SystemMessage({ content: buildPlanCompleteMessage(todos.length) }),
      ],
      projectPlanText,
      techStackSummary,
      projectInitSteps,
      projectRoot: finalProjectRoot,
      todos,
      currentTodoIndex: 0,
      taskStatus: "executing" as const,
      iterationCount: 0,
    },
    goto: "executor",
  });
}

/**
 * 执行节点
 * 核心的 agent 逻辑，使用 Command 进行路由
 */
export async function executorNode(state: AgentState) {
  const {
    messages,
    todos = [],
    currentTodoIndex = 0,
    iterationCount = 0,
    maxIterations = CONSTANTS.MAX_ITERATIONS,
    projectTreeText,
    projectPlanText,
    summary,
  } = state;

  // 自动摘要逻辑
  if (messages.length > CONSTANTS.SUMMARY_MESSAGE_THRESHOLD) {
    //动态计算摘要保留消息数量,确保不会切在 ToolMessage 上
    const cutIndex = calculateSummaryCutIndex(
      messages,
      CONSTANTS.SUMMARY_KEEP_COUNT,
    );

    if (cutIndex > 0) {
      const messagesToSummarize = messages.slice(0, cutIndex);
      const summaryPrompt = buildSummaryPrompt(
        summary || "",
        messagesToSummarize,
      );

      const summaryResponse = await modelWithTools.invoke(
        [
          new SystemMessage(summaryPrompt),
          ...messagesToSummarize,
          new HumanMessage("请生成新的技术摘要。"),
        ],
        { callbacks: [] },
      );

      const newSummary = String(summaryResponse.content);
      // 构建删除操作,删除旧消息
      const deleteOperations = createRemoveOperations(messagesToSummarize);

      return new Command({
        update: {
          summary: newSummary,
          messages: deleteOperations,
        },
        goto: "executor",
      });
    }
  }

  // 循环保护 - 检测最大迭代次数
  if (isMaxIterationsReached(iterationCount, maxIterations)) {
    return new Command({
      update: {
        error: `达到最大迭代次数 ${maxIterations}`,
        taskStatus: "completed" as const,
      },
      goto: END,
    });
  }

  // 检查是否所有任务完成
  if (areAllTasksComplete(currentTodoIndex, todos.length)) {
    return new Command({
      update: {
        taskStatus: "completed" as const,
        messages: [new SystemMessage({ content: TASK_COMPLETE_MESSAGE })],
      },
      goto: END,
    });
  }

  // 检测重复的 AI 消息内容
  if (detectDuplicateAIContent(messages) && todos.length > 0) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;
    return advanceToNextTodo(nextIndex, allDone);
  }

  // 检测重复的工具调用
  const loopDetection = detectDuplicateToolCalls(messages);
  if (loopDetection.hasLoop && loopDetection.toolName) {
    if (
      loopDetection.toolName === "write_file" ||
      loopDetection.toolName === "create_file"
    ) {
      console.log(`[executor] 检测到连续写文件操作，跳过循环检测。`);
    } else {
      console.error(`[executor] ⚠️ 检测到循环: ${loopDetection.toolName}`);
      return new Command({
        update: {
          error: `检测到循环调用工具: ${loopDetection.toolName}`,
          messages: [
            new SystemMessage({
              content: buildLoopErrorMessage(
                loopDetection.toolName,
                loopDetection.count!,
              ),
            }),
          ],
          taskStatus: "completed" as const,
        },
        goto: END,
      });
    }
  }

  // 检测重复的 AI 回复内容（无工具调用）
  if (detectDuplicatePlainAIResponses(messages)) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;
    return skipToNextTodo(
      nextIndex,
      allDone,
      allDone ? DUPLICATE_LOOP_ALL_DONE_MESSAGE : DUPLICATE_LOOP_SKIP_MESSAGE,
    );
  }

  // 构建上下文消息
  const contextMessages: SystemMessage[] = [];

  if (projectPlanText?.trim()) {
    contextMessages.push(
      new SystemMessage({
        content: buildExecutorProjectPlanContext(projectPlanText),
      }),
    );
  }

  if (projectTreeText?.trim()) {
    contextMessages.push(
      new SystemMessage({
        content: buildExecutorProjectTreeContext(projectTreeText),
      }),
    );
  }

  if (todos.length > 0 && currentTodoIndex < todos.length) {
    const currentTask = todos[currentTodoIndex];
    contextMessages.push(
      new SystemMessage({
        content: buildExecutorTaskContext(
          currentTask,
          currentTodoIndex + 1,
          todos.length,
        ),
      }),
    );
  }

  if (summary) {
    contextMessages.push(
      new SystemMessage({ content: buildExecutorSummaryContext(summary) }),
    );
  }

  const fullMessages = [...contextMessages, ...messages];
  const response = await modelWithTools.invoke(fullMessages);
  const newIterationCount = iterationCount + 1;

  // 路由逻辑

  // 1. 如果有工具调用
  if (response.tool_calls?.length) {
    const hasSensitive = response.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );
    const demoMode = state.demoMode || false;

    if (hasSensitive && !demoMode) {
      return routeToReview(response, newIterationCount, response.tool_calls);
    }
    return routeToTools(response, newIterationCount, response.tool_calls);
  }

  // 2. 没有工具调用 - 检查任务是否完成
  const content = safeToString(response.content).toLowerCase();
  const hasCompletionKeyword = hasCompletionToken(content);
  const askingForHelp = isAskingForHelp(content);
  const recentToolMessages = getRecentToolMessages(messages);
  const hasRecentToolExecution = recentToolMessages.length > 0;
  const taskReallyCompleted = hasCompletionKeyword;
  const stuckInLoop = newIterationCount >= CONSTANTS.STUCK_LOOP_ITERATIONS;

  // 任务完成或卡在循环中
  if ((taskReallyCompleted || stuckInLoop) && todos.length > 0) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;
    return skipToNextTodoWithResponse(response, nextIndex, allDone);
  }

  // 询问式回复且最近有工具执行
  if (askingForHelp && hasRecentToolExecution) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;
    return skipToNextTodoWithResponse(response, nextIndex, allDone);
  }

  // 兜底逻辑 - 达到一定迭代次数且没有进展
  if (
    !hasCompletionKeyword &&
    !hasRecentToolExecution &&
    newIterationCount >= CONSTANTS.SKIP_TO_NEXT_ITERATIONS
  ) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;
    return skipToNextTodoWithResponse(response, nextIndex, allDone);
  }

  // 继续当前任务
  return continueExecution(response, newIterationCount);
}

/**
 * 工具执行节点
 */
const toolsNodeBase = new ToolNode(tools);

export async function toolsNode(state: AgentState) {
  const lastMsg = state.messages[state.messages.length - 1];

  if (!isAIMessage(lastMsg) || !hasToolCalls(lastMsg)) {
    return new Command({ goto: "executor" });
  }

  const toolCall = (lastMsg as any).tool_calls[0];

  try {
    const result = await toolsNodeBase.invoke(state);

    if (!result.messages || result.messages.length === 0) {
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              tool_call_id: toolCall.id,
              content: `SYSTEM ERROR: Tool '${toolCall.name}' was not found or failed to execute silently. Please check tool definitions.`,
              name: toolCall.name,
            }),
          ],
          pendingToolCalls: [],
        },
        goto: "executor",
      });
    }

    return new Command({
      update: {
        messages: result.messages,
        pendingToolCalls: [],
        projectTreeInjected: false,
        iterationCount: 0,
      },
      goto: "executor",
    });
  } catch (error) {
    return new Command({
      update: {
        messages: [
          new ToolMessage({
            tool_call_id: toolCall.id,
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            name: toolCall.name,
          }),
        ],
        pendingToolCalls: [],
      },
      goto: "executor",
    });
  }
}

/**
 * 人工审批节点
 */
export async function reviewNode(state: AgentState) {
  const lastMsg = state.messages[state.messages.length - 1];

  // 用户拒绝
  if (
    isToolMessage(lastMsg) ||
    (lastMsg.content && String(lastMsg.content).includes("rejected"))
  ) {
    return new Command({ goto: "executor" });
  }

  // 用户批准
  if (isAIMessage(lastMsg) && hasToolCalls(lastMsg)) {
    return new Command({ goto: "tools" });
  }

  // 异常状态
  return new Command({ goto: "executor" });
}
