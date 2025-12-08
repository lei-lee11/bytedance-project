import { END, Command } from "@langchain/langgraph";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
  ToolMessage,
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
} from "../agent/prompt.js";
import { z } from "zod";

// Schema 定义
const ProjectPlanSchema = z.object({
  projectPlanText: z.string(),
  techStackSummary: z.string().nullable().default(""),
  projectInitSteps: z
    .array(z.string())
    .nullable()
    .default(() => []),
});

const TaskPlanSchema = z.object({
  todos: z.array(z.string()),
});

// 意图分类 Schema
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
  console.log("[classifier] 开始意图分类");

  try {
    // 获取最新的用户消息
    const lastMessage = state.messages[state.messages.length - 1];
    const userInput = lastMessage.content.toString();

    console.log(`[classifier] 分析用户输入: ${userInput.substring(0, 100)}...`);

    // 使用结构化输出进行意图分类
    const classificationPrompt = buildIntentClassificationPrompt();
    const modelWithStructuredOutput =
      baseModel.withStructuredOutput(IntentSchema);

    const result = await modelWithStructuredOutput.invoke([
      new SystemMessage(classificationPrompt),
      new HumanMessage(userInput),
    ]);

    console.log(
      `[classifier] 分类结果: ${result.intent}, 置信度: ${result.confidence}, 理由: ${result.reasoning}`,
    );

    // 根据意图路由
    if (result.intent === "task") {
      console.log("[classifier] → 路由到 planner（任务模式）");
      return new Command({
        goto: "planner",
      });
    } else {
      console.log("[classifier] → 路由到 chat（闲聊模式）");
      return new Command({
        goto: "chat",
      });
    }
  } catch (error) {
    console.error("[classifier] 意图分类失败:", error);
    // 默认路由到闲聊，提供友好体验
    console.log("[classifier] 错误处理 → 路由到 chat");
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
  console.log("[chat] 生成闲聊回复");

  try {
    // 使用完整的对话历史来生成回复
    const chatPrompt = buildChatAgentPrompt();
    const response = await baseModel.invoke([
      new SystemMessage(chatPrompt),
      ...state.messages, // 传递完整的对话历史
    ]);

    console.log(
      `[chat] 回复: ${response.content.toString().substring(0, 100)}...`,
    );

    // 返回回复并结束
    return new Command({
      update: {
        messages: [response],
      },
      goto: END,
    });
  } catch (error) {
    console.error("[chat] 生成回复失败:", error);

    // 返回错误消息
    const errorMessage = new AIMessage({
      content:
        "抱歉，我现在遇到了一些问题。请稍后再试，或者直接告诉我你想要实现的编程任务！",
    });

    return new Command({
      update: {
        messages: [errorMessage],
      },
      goto: END,
    });
  }
}

/**
 * 初始化节点
 * 合并了 processReferencedFiles 和 injectProjectTreeNode
 */
export async function initializeNode(state: AgentState) {
  console.log("[initialize] 开始初始化");

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
      console.log(`[initialize] 处理了 ${filePaths.length} 个文件`);
    } catch (error) {
      console.error("[initialize] 文件处理失败:", error);
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
      console.log("[initialize] 项目树扫描完成");
    } catch (error) {
      console.error("[initialize] 项目树扫描失败:", error);
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
 * 合并了 projectPlannerNode 和 taskPlannerNode
 */
export async function plannerNode(state: AgentState) {
  console.log("[planner] 开始规划");

  // 如果已经有 todos 且还有未完成的任务，跳过规划
  if (
    state.todos &&
    state.todos.length > 0 &&
    state.currentTodoIndex < state.todos.length
  ) {
    console.log("[planner] 已有未完成的任务列表，跳过规划");
    return new Command({
      update: { taskStatus: "executing" as const },
      goto: "executor",
    });
  }

  const lastUser = state.messages[state.messages.length - 1];
  const projectRoot = state.projectRoot || ".";

  // 1. 项目规划
  console.log("[planner] 生成项目规划");
  const projectPlanSystem = new SystemMessage({
    content: [
      "你是架构规划助手，只负责决定技术栈和项目结构。",
      "输出结构化结果：projectPlanText, techStackSummary, projectInitSteps。",
      "projectInitSteps 必须是可以直接执行的工程级初始化步骤。",
    ].join("\n"),
  });

  const projectPlanUser = new HumanMessage({
    content: [
      `项目根目录：\`${projectRoot}\``,
      "用户需求：",
      lastUser?.content ?? "",
    ].join("\n"),
  });

  const structuredModel = baseModel.withStructuredOutput(ProjectPlanSchema);
  const projectPlan = await structuredModel.invoke([
    projectPlanSystem,
    projectPlanUser,
  ]);

  const projectPlanText = String(projectPlan.projectPlanText || "");
  const techStackSummary = String(projectPlan.techStackSummary || "");
  const projectInitSteps = Array.isArray(projectPlan.projectInitSteps)
    ? projectPlan.projectInitSteps
    : [];

  // 2. 任务拆解
  console.log("[planner] 生成任务列表");
  const taskPlanSystem = new SystemMessage({
    content: [
      "你是开发任务拆解助手，负责生成高效、可执行的任务列表。",
      "",
      "**重要原则**:",
      "1. 生成大粒度任务 - 每个任务应该完成一个完整的功能模块",
      "2. 任务数量控制在3-5个 - 避免过度拆分",
      "3. 每个任务应该包含多个相关的小步骤",
      "4. 任务描述要具体明确，包含目标和验收标准",
      "",
      "**示例**:",
      "❌ 错误: 创建HTML文件 → 添加head标签 → 添加body标签 → 添加样式 (过度拆分)",
      "✅ 正确: 创建完整的HTML页面，包含结构、样式和交互功能",
      "",
      "只输出结构化字段 todos（string[]）。",
    ].join("\n"),
  });

  const taskPlanUser = new HumanMessage({
    content: [
      "===== 项目规划 =====",
      projectPlanText,
      "",
      "===== 初始化步骤 =====",
      projectInitSteps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      "",
      "===== 用户需求 =====",
      lastUser?.content ?? "",
    ].join("\n"),
  });
  const taskModel = baseModel.withStructuredOutput(TaskPlanSchema);
  const taskPlan = await taskModel.invoke([taskPlanSystem, taskPlanUser]);

  const todos = Array.isArray(taskPlan.todos) ? taskPlan.todos : [];
  console.log("todos:", todos);
  console.log(`[planner] 生成了 ${todos.length} 个任务`);

  return new Command({
    update: {
      messages: [
        new SystemMessage({ content: projectPlanText }),
        new SystemMessage({ content: `生成了 ${todos.length} 个任务` }),
      ],
      projectPlanText,
      techStackSummary,
      projectInitSteps,
      todos,
      currentTodoIndex: 0,
      taskStatus: "executing" as const,
    },
    goto: "executor",
  });
}
/**
 * 执行节点
 * 核心的 agent 逻辑，使用 Command 进行路由
 */
export async function executorNode(state: AgentState) {
  console.log("[executor] 开始执行");

  const {
    messages,
    todos = [],
    currentTodoIndex = 0,
    iterationCount = 0,
    maxIterations = 50,
    projectTreeText,
    summary,
  } = state;

  // 循环保护 - 更严格的检测
  if (iterationCount >= maxIterations) {
    console.error(`[executor] 达到最大迭代次数 ${maxIterations}，强制结束`);
    return new Command({
      update: {
        error: `达到最大迭代次数 ${maxIterations}`,
        taskStatus: "completed" as const,
      },
      goto: END,
    });
  }

  // 检查是否所有任务完成
  if (todos.length > 0 && currentTodoIndex >= todos.length) {
    console.log("[executor] 所有任务已完成");
    return new Command({
      update: {
        taskStatus: "completed" as const,
        messages: [new SystemMessage({ content: "所有任务已完成！" })],
      },
      goto: END,
    });
  }

  // 检测重复消息 - 防止循环
  const lastMessages = messages.slice(-5);
  const lastAIMessages = lastMessages.filter(
    (m) =>
      m &&
      (m.constructor.name === "AIMessage" || (m as any)._getType?.() === "ai"),
  );

  // 检查最近的AI消息是否重复
  if (lastAIMessages.length >= 2) {
    const lastContent = String(
      lastAIMessages[lastAIMessages.length - 1]?.content || "",
    );
    const prevContent = String(
      lastAIMessages[lastAIMessages.length - 2]?.content || "",
    );

    // 如果最近两条AI消息内容相似（前50个字符相同），可能陷入循环
    if (
      lastContent.substring(0, 50) === prevContent.substring(0, 50) &&
      lastContent.length > 10
    ) {
      console.warn(`[executor] 检测到重复AI回复，可能陷入循环`);

      // 强制推进到下一个任务
      if (todos.length > 0) {
        const nextIndex = currentTodoIndex + 1;
        if (nextIndex >= todos.length) {
          console.log(`[executor] 所有任务已完成（循环检测触发）`);
          return new Command({
            update: {
              taskStatus: "completed" as const,
              iterationCount: 0,
            },
            goto: END,
          });
        }

        console.log(`[executor] 强制推进到任务 ${nextIndex + 1}`);
        return new Command({
          update: {
            currentTodoIndex: nextIndex,
            iterationCount: 0,
          },
          goto: "executor",
        });
      }
    }
  }

  // 检测重复的工具调用 - 防止循环
  const recentMessages = messages.slice(-15);
  const toolCallMessages = recentMessages.filter(
    (m) => m && (m as any).tool_calls?.length > 0,
  );

  if (toolCallMessages.length >= 4) {
    const recentToolCalls = toolCallMessages.slice(-4).map((m) => {
      const calls = (m as any).tool_calls || [];
      return calls.map((tc: any) => tc.name).join(",");
    });

    const uniqueCalls = new Set(recentToolCalls);
    if (uniqueCalls.size === 1 && recentToolCalls[0]) {
      const repeatedTool = recentToolCalls[0];
      console.error(
        `[executor] ⚠️ 检测到循环: ${repeatedTool} 被连续调用 ${recentToolCalls.length} 次`,
      );

      if (repeatedTool === "list_directory") {
        console.error(
          `[executor] 🔍 诊断: list_directory 循环通常是 projectRoot 配置错误`,
        );
        console.error(
          `[executor] 当前 projectRoot: ${state.projectRoot || "未设置"}`,
        );
      }

      return new Command({
        update: {
          error: `检测到循环调用工具: ${repeatedTool}`,
          messages: [
            new SystemMessage({
              content: [
                `⚠️ 检测到循环,已自动停止执行。`,
                ``,
                `工具 "${repeatedTool}" 被连续调用 ${recentToolCalls.length} 次。`,
                ``,
                `可能原因:`,
                `1. projectRoot 配置错误`,
                `2. 文件路径不存在`,
                `3. 权限问题`,
                `4. AI 陷入思维循环`,
                ``,
                `建议:`,
                `- 检查 projectRoot 配置`,
                `- 验证文件路径是否正确`,
                `- 查看工具调用日志`,
              ].join("\n"),
            }),
          ],
          taskStatus: "completed" as const,
        },
        goto: END,
      });
    }
  }

  // 检测重复的 AI 回复内容 - 防止无工具调用的循环
  const recentAIMessages = recentMessages
    .filter(
      (m) =>
        m &&
        (m as any)._getType?.() === "ai" &&
        !((m as any).tool_calls?.length > 0),
    )
    .slice(-3); // 最近3条AI文本回复

  if (recentAIMessages.length >= 3) {
    const messageContents = recentAIMessages.map((m) => {
      const content = String((m as any).content || "");
      // 只比较前200个字符,避免细微差异
      return content.substring(0, 200).trim().toLowerCase();
    });

    // 如果3条消息都非常相似
    const allSimilar = messageContents.every((content, i) => {
      if (i === 0) return true;
      const prev = messageContents[i - 1];
      // 计算相似度(简单的字符串匹配)
      const similarity =
        content === prev ||
        content.includes(prev.substring(0, 100)) ||
        prev.includes(content.substring(0, 100));
      return similarity;
    });

    if (allSimilar && messageContents[0].length > 10) {
      console.error(`[executor] ⚠️ 检测到重复的 AI 回复,可能陷入循环`);
      console.error(`[executor] 🛑 强制完成当前任务以打破循环`);

      // 强制完成当前任务
      const nextIndex = currentTodoIndex + 1;
      const allDone = nextIndex >= todos.length;

      if (allDone) {
        return new Command({
          update: {
            messages: [
              new SystemMessage(`⚠️ 检测到重复回复循环,已强制完成所有任务`),
            ],
            currentTodoIndex: nextIndex,
            taskCompleted: true,
            taskStatus: "completed" as const,
            iterationCount: 0,
          },
          goto: END,
        });
      }

      return new Command({
        update: {
          messages: [new SystemMessage(`⚠️ 检测到重复回复循环,跳过到下一任务`)],
          currentTodoIndex: nextIndex,
          taskCompleted: true,
          iterationCount: 0,
        },
        goto: "executor",
      });
    }
  }

  // 构建上下文消息
  const contextMessages: SystemMessage[] = [];

  // 添加项目树（限制大小）
  if (projectTreeText && projectTreeText.trim()) {
    const maxTreeLength = 5000;
    const truncatedTree =
      projectTreeText.length > maxTreeLength
        ? projectTreeText.substring(0, maxTreeLength) + "\n...（已截断）"
        : projectTreeText;

    contextMessages.push(
      new SystemMessage({
        content: `## 项目结构\n\n${truncatedTree}\n`,
      }),
    );
  }

  // 添加当前任务信息
  if (todos.length > 0 && currentTodoIndex < todos.length) {
    const currentTask = todos[currentTodoIndex];
    const taskNumber = currentTodoIndex + 1;
    const totalTasks = todos.length;

    contextMessages.push(
      new SystemMessage({
        content: [
          `你是一个高效的开发助手，专注于完成任务。`,
          `==========================`,
          `📋 当前任务 (${taskNumber}/${totalTasks}):`,
          `「${currentTask}」`,
          `==========================`,
          ``,
          `**执行规则**:`,
          `1. 直接执行任务，使用必要的工具（如 write_file, read_file 等）`,
          `2. 完成后必须明确说"✅ 任务完成"`,
          `3. 不要询问用户是否需要帮助`,
          `4. 不要说"如果你需要..."之类的话`,
          `5. 一次性完成整个任务，不要分步骤`,
          `6. 如果任务需要创建文件，必须调用 write_file 工具`,
          ``,
          `**禁止的回复**:`,
          `❌ "如果你需要进一步的帮助..."`,
          `❌ "请告诉我..."`,
          `❌ "还有什么我可以帮你的吗？"`,
          `❌ 不调用工具就说任务完成`,
          ``,
          `**正确的回复**:`,
          `✅ 先调用工具完成实际操作`,
          `✅ 然后说"✅ 任务完成。已创建XXX文件..."`,
          ``,
          `现在开始执行任务！必须调用工具来完成任务！`,
        ].join("\n"),
      }),
    );

    console.log(
      `[executor] 当前任务 (${taskNumber}/${totalTasks}): ${currentTask.substring(0, 50)}...`,
    );
  }

  // 添加摘要
  if (summary) {
    contextMessages.push(
      new SystemMessage({
        content: `对话摘要：\n${summary}`,
      }),
    );
  }

  // 合并所有消息 - 只保留最近的消息避免上下文过大
  const recentMessagesForContext = messages.slice(-20); // 只保留最近20条消息
  const fullMessages = [...contextMessages, ...recentMessagesForContext];

  // 调用模型
  console.log(
    `[executor] 调用模型（迭代 ${iterationCount + 1}/${maxIterations}）`,
  );
  const response = await modelWithTools.invoke(fullMessages);

  const newIterationCount = iterationCount + 1;

  // 决定路由

  // 1. 如果有工具调用 - 这是正常的执行路径
  if (response.tool_calls?.length) {
    const toolNames = response.tool_calls.map((t) => t.name).join(", ");
    console.log(`[executor] 检测到工具调用: ${toolNames}`);

    const hasSensitive = response.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    // 检查是否为演示模式
    const demoMode = state.demoMode || false;

    if (hasSensitive && !demoMode) {
      console.log(`[executor] 包含敏感工具，需要人工审批`);
      return new Command({
        update: {
          messages: [response],
          pendingToolCalls: response.tool_calls,
          iterationCount: newIterationCount,
        },
        goto: "review",
      });
    }

    if (hasSensitive && demoMode) {
      console.log(`[executor] 演示模式: 自动批准敏感工具`);
    } else {
      console.log(`[executor] 普通工具，直接执行`);
    }

    return new Command({
      update: {
        messages: [response],
        pendingToolCalls: response.tool_calls,
        iterationCount: newIterationCount,
      },
      goto: "tools",
    });
  }

  // 2. 没有工具调用 - 检查任务是否完成
  const content = String(response.content || "").toLowerCase();

  // 更严格的任务完成判断
  const hasCompletionKeyword =
    content.includes("任务完成") ||
    content.includes("已完成") ||
    content.includes("完成了") ||
    content.includes("task completed") ||
    content.includes("completed") ||
    /✅/.test(String(response.content || ""));

  // 检测无用的询问式回复
  const isAskingForHelp =
    content.includes("如果你需要") ||
    content.includes("if you need") ||
    content.includes("请告诉我") ||
    content.includes("let me know") ||
    content.includes("还有什么") ||
    content.includes("需要帮助");

  // 检测本次迭代中是否有工具执行(查看最近的消息)
  const recentToolMessages = messages
    .slice(-10)
    .filter(
      (m) =>
        m &&
        ((m as any)._getType?.() === "tool" ||
          m.constructor.name === "ToolMessage"),
    );
  const hasRecentToolExecution = recentToolMessages.length > 0;

  // 任务完成的条件(简化逻辑):
  // 1. 有完成关键词 = 直接认为完成
  // 2. 或者迭代次数超过阈值（防止无限循环）
  const taskReallyCompleted = hasCompletionKeyword;
  const stuckInLoop = newIterationCount >= 3 && !response.tool_calls?.length;

  if ((taskReallyCompleted || stuckInLoop) && todos.length > 0) {
    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;

    if (stuckInLoop && !taskReallyCompleted) {
      console.log(
        `[executor] 检测到循环（无工具调用），强制完成任务 ${currentTodoIndex + 1}`,
      );
    } else {
      console.log(`[executor] 任务 ${currentTodoIndex + 1} 完成`);
    }

    if (allDone) {
      console.log(`[executor] 所有任务已完成`);
      return new Command({
        update: {
          messages: [response],
          currentTodoIndex: nextIndex,
          taskCompleted: true,
          taskStatus: "completed" as const,
          iterationCount: 0,
        },
        goto: END,
      });
    }

    console.log(`[executor] 继续下一个任务`);
    return new Command({
      update: {
        messages: [response],
        currentTodoIndex: nextIndex,
        taskCompleted: true,
        iterationCount: 0, // 重置计数
      },
      goto: "executor",
    });
  }

  // 3. 如果是询问式回复,视为任务完成信号
  if (isAskingForHelp && hasRecentToolExecution) {
    console.log(`[executor] 检测到询问式回复(有工具执行记录),视为任务完成`);

    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;

    if (allDone) {
      console.log(`[executor] 所有任务已完成`);
      return new Command({
        update: {
          messages: [response],
          currentTodoIndex: nextIndex,
          taskCompleted: true,
          taskStatus: "completed" as const,
          iterationCount: 0,
        },
        goto: END,
      });
    }

    console.log(`[executor] 继续下一个任务`);
    return new Command({
      update: {
        messages: [response],
        currentTodoIndex: nextIndex,
        taskCompleted: true,
        iterationCount: 0,
      },
      goto: "executor",
    });
  }

  // 4. 如果没有任何有用信息且没有工具调用,可能是无意义的回复
  if (
    !hasCompletionKeyword &&
    !hasRecentToolExecution &&
    newIterationCount >= 2
  ) {
    console.log(`[executor] 检测到无意义回复,强制继续下一任务`);

    const nextIndex = currentTodoIndex + 1;
    const allDone = nextIndex >= todos.length;

    if (allDone) {
      return new Command({
        update: {
          messages: [response],
          currentTodoIndex: nextIndex,
          taskCompleted: true,
          taskStatus: "completed" as const,
          iterationCount: 0,
        },
        goto: END,
      });
    }

    return new Command({
      update: {
        messages: [response],
        currentTodoIndex: nextIndex,
        taskCompleted: true,
        iterationCount: 0,
      },
      goto: "executor",
    });
  }

  // 5. 继续当前任务
  console.log(`[executor] 继续处理当前任务`);
  return new Command({
    update: {
      messages: [response],
      iterationCount: newIterationCount,
    },
    goto: "executor",
  });
}

/**
 * 工具执行节点
 */
const toolsNodeBase = new ToolNode(tools);

export async function toolsNode(state: AgentState) {
  console.log("🛑 [tools] === 进入工具节点调试模式 ===");

  const lastMsg = state.messages[state.messages.length - 1];

  // 1. 检查输入消息
  if (lastMsg._getType() !== "ai" || !(lastMsg as any).tool_calls?.length) {
    console.error(
      "[tools] ❌ 错误: 并没有检测到工具调用请求！最后一条消息是:",
      lastMsg,
    );
    return new Command({ goto: "executor" });
  }

  const toolCall = (lastMsg as any).tool_calls[0];
  console.log(`[tools] 🎯 Agent 想要执行: "${toolCall.name}"`);
  console.log(`[tools] 📦 参数:`, JSON.stringify(toolCall.args));

  try {
    // 2. 检查工具是否存在 (这是最常见的问题!)
    // 假设你的 toolsNodeBase 是通过 new ToolNode(tools) 创建的
    // 我们这里没办法直接访问内部 tools 列表，所以我们要看 invoke 的结果

    console.log("[tools] 🚀 正在调用 toolsNodeBase.invoke...");
    const result = await toolsNodeBase.invoke(state);

    console.log(
      "[tools] 📥 toolsNodeBase 返回原始数据:",
      JSON.stringify(result, null, 2),
    );

    // 3. 关键检查: 是否生成了 messages
    if (!result.messages || result.messages.length === 0) {
      console.error(
        `[tools] 😱 严重错误: 工具 "${toolCall.name}" 似乎没有被执行！`,
      );
      console.error(
        `[tools] 可能原因: 工具名称定义不匹配。Agent 叫它 "${toolCall.name}"，但你定义的工具可能有不同名字？`,
      );

      // 强制返回一个错误消息，打破死循环
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

    // 4. 成功情况
    const outputMsg = result.messages[0];
    console.log(
      `[tools] ✅ 执行成功! 返回内容预览: ${(outputMsg.content as string).slice(0, 50)}...`,
    );

    return new Command({
      update: {
        messages: result.messages,
        pendingToolCalls: [],
        projectTreeInjected: false,
      },
      goto: "executor",
    });
  } catch (error) {
    console.error("[tools] 💥 工具执行炸了:", error);

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
  console.log("👮 [review] === 进入审批节点调试模式 ===");

  const lastMsg = state.messages[state.messages.length - 1];
  console.log(`[review] 最后一条消息类型: ${lastMsg._getType()}`);

  // 情况 1: 用户拒绝 (前端通常会插入一条 ToolMessage 说 "User rejected")
  if (
    lastMsg._getType() === "tool" ||
    (lastMsg.content && (lastMsg.content as string).includes("rejected"))
  ) {
    console.log("[review] 🛑 检测到拒绝信号，跳过工具执行，回 executor");
    return new Command({ goto: "executor" });
  }

  // 情况 2: 用户批准
  // 此时最后一条消息应该是 AI 之前发出的请求 (AIMessage 且带 tool_calls)
  if (lastMsg._getType() === "ai" && (lastMsg as any).tool_calls?.length > 0) {
    console.log("[review] ✅ 检测到待执行的工具，批准通过！");
    console.log("[review] 🚀 正在跳转到 -> tools 节点...");

    // 🔥 核心修复：必须显式返回 goto: "tools"
    return new Command({
      goto: "tools",
    });
  }

  // 情况 3: 异常状态
  console.warn(
    "[review] ⚠️ 这里的状态有点奇怪，既不是拒绝也不是待执行的工具，默认回 executor",
  );
  return new Command({ goto: "executor" });
}
