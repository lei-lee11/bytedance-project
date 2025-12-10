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
} from "../agent/prompt.js";
import { z } from "zod";

// Schema 定义
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
  //console.log("[chat] 生成闲聊回复");

  try {
    // 使用完整的对话历史来生成回复
    const chatPrompt = buildChatAgentPrompt();
    const response = await baseModel.invoke([
      new SystemMessage(chatPrompt),
      ...state.messages, // 传递完整的对话历史
    ]);

    // console.log(
    //   `[chat] 回复: ${response.content.toString().substring(0, 100)}...`,
    // );

    // 返回回复并结束
    return new Command({
      update: {
        messages: [response],
      },
      goto: END,
    });
  } catch (error) {
    // console.error("[chat] 生成回复失败:", error);

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
 * 合并了 projectPlannerNode 和 taskPlannerNode
 */
// src/agent/nodes.ts

export async function plannerNode(state: AgentState) {
  // console.log("[planner] 开始规划");

  // 获取最后一条消息
  const lastMessage = state.messages[state.messages.length - 1];

  // 🛡️ [去重保护]
  const isLastMessagePlanConfirmation =
    lastMessage?.content &&
    String(lastMessage.content).includes("生成了") &&
    String(lastMessage.content).includes("个任务");

  if (isLastMessagePlanConfirmation) {
    return new Command({
      goto: "executor",
    });
  }

  // 初始根目录（默认为当前目录）
  const currentProjectRoot = state.projectRoot || ".";

  // 查找最近的用户输入
  const lastUserMsg = state.messages
    .slice()
    .reverse()
    .find((m) => m._getType() === "human");

  const userRequest = lastUserMsg ? lastUserMsg.content : "";

  // 1. 项目规划
  const projectPlanSystem = new SystemMessage({
    content: [
      "你是架构规划助手，只负责决定技术栈和项目结构。",
      "输出结构化结果：projectPlanText, techStackSummary, projectInitSteps, targetDirectory。",
      "projectInitSteps 必须是可以直接执行的工程级初始化步骤。",
      "",
      " **关于目标目录**:",
      "如果用户需求或提供的文档中明确指定了项目应该在某个特定的文件夹下创建（例如 '在 my-app 文件夹中初始化' 或 'Root: /src/project'），请务必将该路径填入 targetDirectory 字段。",
      "如果未指定，targetDirectory 留空。",
      "",
      "⚠️ **重要约束**:",
      "1. 步骤只能是动作描述，例如：'创建文件 xxx.js'。",
      "2. 绝对禁止包含具体代码实现。",
    ].join("\n"),
  });
  const fileContextMsg = state.messages.find(
    (m) =>
      m._getType() === "system" &&
      String(m.content).includes("Referenced Files Context"),
  );

  const fileContextContent = fileContextMsg
    ? String(fileContextMsg.content)
    : "";

  const projectPlanUser = new HumanMessage({
    content: [
      `当前运行目录：\`${currentProjectRoot}\``,
      "",
      "===== 上下文文件内容 =====",
      fileContextContent || "(无已加载文件，请根据需求自行判断)",
      "==========================",
      "",
      "用户需求：",
      String(userRequest),
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

  // ✨ [处理目标目录逻辑]
  const targetDir = projectPlan.targetDirectory;
  let mkdirTask: string | null = null;
  let finalProjectRoot = currentProjectRoot;

  // 如果 AI 识别出了新的目标目录，且不是当前目录
  if (targetDir && targetDir !== "." && targetDir !== "./") {
    // console.log(`[planner] 识别到新的目标根目录: ${targetDir}`);

    // 1. 更新后续任务使用的根目录
    // 注意：如果 targetDir 是相对路径，这里逻辑上是相对于当前运行目录的
    finalProjectRoot = targetDir;

    // 2. 创建一个显式的任务来建立这个文件夹
    mkdirTask = `创建并初始化项目根目录: ${targetDir}`;
  }

  // 2. 任务拆解
  const taskPlanSystem = new SystemMessage({
    content: [
      "你是技术执行官 (CTO)。你已经完成了所有的需求分析和架构设计（已在上下文中）。",
      "现在的目标是：**指挥初级工程师（Executor）真正把代码写出来**。",
      "",
      "请生成一份 `todos` 列表，必须严格遵守以下规则：",
      "",
      "1. 🚫 **严禁认知类任务**：不要包含 '分析需求'、'设计数据库'、'阅读文档'、'制定计划' 等任务。这些已经做完了。",
      "2. ✅ **必须是物理操作**：每个任务都必须明确指示去**操作文件系统**或**运行命令**。",
      "   - 好的例子：'初始化 server 目录并安装 express 依赖'",
      "   - 好的例子：'创建 models/User.js 和 models/Post.js 文件'",
      "3. 📦 **合理的任务聚合**：",
      "   - 不要把每个文件的创建都拆成一个单独任务。",
      "   - 将相关的操作合并。例如：'完成所有后端路由和控制器的编写' 作为一个任务。",
      "   - 整个项目通常拆分为 4-8 个核心实施步骤。",
      "4. 🔗 **严格的执行顺序**：",
      "   - 必须先创建目录和安装依赖（环境搭建）。",
      "   - 然后是核心配置（数据库连接）。",
      "   - 然后是后端逻辑。",
      "   - 最后是前端开发。",
      "",
      `注意：当前确定的项目根目录为 "${finalProjectRoot}"。所有文件操作都应基于此目录。`,
    ].join("\n"),
  });

  const taskPlanUser = new HumanMessage({
    content: [
      "===== 项目规划 =====",
      projectPlanText,
      `目标根目录: ${finalProjectRoot}`,
      "===== 上下文文件内容 =====",
      fileContextContent, // 显式告知 Task Planner
      "===== 初始化步骤 =====",
      projectInitSteps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      "===== 用户需求 =====",
      String(userRequest),
    ].join("\n"),
  });

  const taskModel = baseModel.withStructuredOutput(TaskPlanSchema);
  const taskPlan = await taskModel.invoke([taskPlanSystem, taskPlanUser]);

  let todos = Array.isArray(taskPlan.todos) ? taskPlan.todos : [];

  // ✨ [插入创建目录任务]
  // 如果我们需要切换目录，确保第一个任务是创建该目录
  if (mkdirTask) {
    todos = [mkdirTask, ...todos];
  }

  // console.log(`[planner] 新规划生成完毕: ${todos.length} 个任务 (Root: ${finalProjectRoot})`);

  return new Command({
    update: {
      messages: [
        new SystemMessage({
          content: `规划完成。已生成 ${todos.length} 个具体的开发任务，开始执行。`,
        }),
      ],
      projectPlanText,
      techStackSummary,
      projectInitSteps,

      // ✨ [关键] 更新全局 State 中的 projectRoot
      // 这样 executorNode 和后续的 tools 都会知道要在新目录下工作
      projectRoot: finalProjectRoot,

      // 🔥 强制覆盖旧任务
      todos,
      // 🔥 强制重置进度
      currentTodoIndex: 0,
      taskStatus: "executing" as const,
      // 🔥 重置循环计数器，给新任务一个干净的开始
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
  // console.log("[executor] 开始执行");

  const {
    messages,
    todos = [],
    currentTodoIndex = 0,
    iterationCount = 0,
    maxIterations = 50,
    projectTreeText,
    projectPlanText,
    summary,
  } = state;

  //  自动摘要逻辑
  if (messages.length > 40) {
    // 1. 智能确定切分点
    // 增加保留数量到 10，确保有足够的近期上下文
    const keepCount = 10;
    let cutIndex = messages.length - keepCount;

    // 🛡️ 安全回溯：确保切分点不落在 ToolMessage 上
    // 如果切分点是 ToolMessage，说明它的前一条通常是 AI 的 Tool Call，必须一起保留
    while (
      cutIndex > 0 &&
      (messages[cutIndex]._getType() === "tool" ||
        messages[cutIndex].constructor.name === "ToolMessage")
    ) {
      cutIndex--;
    }

    // 确保有内容可摘要
    if (cutIndex > 0) {
      const messagesToSummarize = messages.slice(0, cutIndex);

      // 2. 构造摘要 Prompt
      const summaryPrompt = `
你是一个专业的代码项目管理员。
这是之前的对话摘要：
${summary || "（无）"}

以下是即将归档的旧对话历史：
---------------------
（包含 ${messagesToSummarize.length} 条交互记录）
---------------------

请结合旧摘要和这段旧对话，生成一个新的、精简的【技术摘要】。
摘要要求：
1. 记录已完成的关键任务和修改的文件。
2. 记录重要的上下文信息（如变量名、路径约定）。
3. 记录当前遗留的问题或下一步的计划。
4. 忽略琐碎的闲聊。

请直接输出摘要内容，不要包含任何前缀或客套话。
`;

      // 3. 调用模型生成摘要
      // 建议：如果可能，这里最好使用不带工具绑定的纯模型实例，以防模型尝试调用工具
      const summaryResponse = await modelWithTools.invoke(
        [
          new SystemMessage(summaryPrompt),
          ...messagesToSummarize,
          new HumanMessage("请生成新的技术摘要。"),
        ],
        {
          callbacks: [],
        },
      );

      const newSummary = String(summaryResponse.content);

      // 4. 构建删除操作
      const deleteOperations = messagesToSummarize
        // 1. 先过滤：确保只处理有 id 的消息
        .filter((m) => m.id !== undefined && m.id !== null)
        // 2. 再映射：传入对象形式 { id: ... }，并使用 ! 断言 id 必定存在
        .map((m) => new RemoveMessage({ id: m.id! }));

      // 5. 更新状态并立即重载
      return new Command({
        update: {
          summary: newSummary,
          messages: deleteOperations,
        },
        goto: "executor",
      });
    }
  }

  // 循环保护 - 更严格的检测
  if (iterationCount >= maxIterations) {
    // console.error(`[executor] 达到最大迭代次数 ${maxIterations}，强制结束`);
    return new Command({
      update: {
        error: `达到最大迭代次数 ${maxIterations}`,
        taskStatus: "completed" as const,
      },
      goto: END,
    });
  }
  // (已删除重复的循环保护代码块)

  // 检查是否所有任务完成
  if (todos.length > 0 && currentTodoIndex >= todos.length) {
    // console.log("[executor] 所有任务已完成");
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

    if (
      lastContent.substring(0, 50) === prevContent.substring(0, 50) &&
      lastContent.length > 10
    ) {
      if (todos.length > 0) {
        const nextIndex = currentTodoIndex + 1;
        if (nextIndex >= todos.length) {
          return new Command({
            update: {
              taskStatus: "completed" as const,
              iterationCount: 0,
            },
            goto: END,
          });
        }

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

      if (repeatedTool === "write_file" || repeatedTool === "create_file") {
        console.log(
          `[executor] 检测到连续写文件操作 (${repeatedTool})，这是正常的生成过程，跳过循环检测。`,
        );
      } else {
        console.error(
          `[executor] ⚠️ 检测到循环: ${repeatedTool} 被连续调用 ${recentToolCalls.length} 次`,
        );

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
                ].join("\n"),
              }),
            ],
            taskStatus: "completed" as const,
          },
          goto: END,
        });
      }
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
    .slice(-3);

  if (recentAIMessages.length >= 3) {
    const messageContents = recentAIMessages.map((m) => {
      const content = String((m as any).content || "");
      return content.substring(0, 200).trim().toLowerCase();
    });

    const allSimilar = messageContents.every((content, i) => {
      if (i === 0) return true;
      const prev = messageContents[i - 1];
      const similarity =
        content === prev ||
        content.includes(prev.substring(0, 100)) ||
        prev.includes(content.substring(0, 100));
      return similarity;
    });

    if (allSimilar && messageContents[0].length > 10) {
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
  if (projectPlanText && projectPlanText.trim()) {
    contextMessages.push(
      new SystemMessage({
        content: `## 核心项目规划与技术规范

${projectPlanText}

请严格遵循上述规范进行开发。`,
      }),
    );
  }

  if (projectTreeText && projectTreeText.trim()) {
    const maxTreeLength = 5000;
    const truncatedTree =
      projectTreeText.length > maxTreeLength
        ? projectTreeText.substring(0, maxTreeLength) + "\n...（已截断）"
        : projectTreeText;

    contextMessages.push(
      new SystemMessage({
        content: `## 项目结构

${truncatedTree}
`,
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
          `4. 一次性完成整个任务，不要分步骤`,
          `5. 如果任务需要创建文件，必须调用 write_file 工具`,
          ``,
          `**禁止的回复**:`,
          `❌ "如果你需要进一步的帮助..."`,
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
  }

  // 添加摘要
  if (summary) {
    contextMessages.push(
      new SystemMessage({
        content: `对话摘要：
${summary}`,
      }),
    );
  }

  // 合并所有消息
  // 🚨 修正：不再使用 slice(-20)，因为我们已经有自动摘要机制确保 messages 不会过长。
  // 如果使用 slice(-20)，会导致第21-39条消息（尚未触发摘要时）对模型不可见，造成记忆缺失。
  // 直接使用 full messages，依靠上方的自动摘要逻辑来控制长度。
  const fullMessages = [...contextMessages, ...messages];

  const response = await modelWithTools.invoke(fullMessages);

  const newIterationCount = iterationCount + 1;

  // 决定路由

  // 1. 如果有工具调用
  if (response.tool_calls?.length) {
    // 检查敏感工具
    const hasSensitive = response.tool_calls.some((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    const demoMode = state.demoMode || false;

    if (hasSensitive && !demoMode) {
      return new Command({
        update: {
          messages: [response],
          pendingToolCalls: response.tool_calls,
          iterationCount: newIterationCount,
        },
        goto: "review",
      });
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

  const hasCompletionKeyword =
    content.includes("任务完成") ||
    content.includes("已完成") ||
    content.includes("完成了") ||
    content.includes("task completed") ||
    content.includes("completed") ||
    /✅/.test(String(response.content || ""));

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

  const taskReallyCompleted = hasCompletionKeyword;
  const stuckInLoop = newIterationCount >= 10 && !response.tool_calls?.length;

  if ((taskReallyCompleted || stuckInLoop) && todos.length > 0) {
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

  // 3. 如果是询问式回复,视为任务完成信号
  if (isAskingForHelp && hasRecentToolExecution) {
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

  // 4. 兜底逻辑
  if (
    !hasCompletionKeyword &&
    !hasRecentToolExecution &&
    newIterationCount >= 5
  ) {
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
  // console.log("🛑 [tools] === 进入工具节点调试模式 ===");

  const lastMsg = state.messages[state.messages.length - 1];

  // 1. 检查输入消息
  if (lastMsg._getType() !== "ai" || !(lastMsg as any).tool_calls?.length) {
    // console.error(
    //   "[tools] ❌ 错误: 并没有检测到工具调用请求！最后一条消息是:",
    //   lastMsg,
    // );
    return new Command({ goto: "executor" });
  }

  const toolCall = (lastMsg as any).tool_calls[0];
  // console.log(`[tools] 🎯 Agent 想要执行: "${toolCall.name}"`);
  // console.log(`[tools] 📦 参数:`, JSON.stringify(toolCall.args));

  try {
    // 2. 检查工具是否存在 (这是最常见的问题!)
    // 假设你的 toolsNodeBase 是通过 new ToolNode(tools) 创建的
    // 我们这里没办法直接访问内部 tools 列表，所以我们要看 invoke 的结果

    //console.log("[tools] 🚀 正在调用 toolsNodeBase.invoke...");
    const result = await toolsNodeBase.invoke(state);

    // console.log(
    //   "[tools] 📥 toolsNodeBase 返回原始数据:",
    //   JSON.stringify(result, null, 2),
    // );

    // 3. 关键检查: 是否生成了 messages
    if (!result.messages || result.messages.length === 0) {
      // console.error(
      //   `[tools] 😱 严重错误: 工具 "${toolCall.name}" 似乎没有被执行！`,
      // );
      // console.error(
      //   `[tools] 可能原因: 工具名称定义不匹配。Agent 叫它 "${toolCall.name}"，但你定义的工具可能有不同名字？`,
      // );

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
    //const outputMsg = result.messages[0];
    // console.log(
    //   `[tools] ✅ 执行成功! 返回内容预览: ${(outputMsg.content as string).slice(0, 50)}...`,
    // );

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
    // console.error("[tools] 💥 工具执行炸了:", error);

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
  //  console.log("👮 [review] === 进入审批节点调试模式 ===");

  const lastMsg = state.messages[state.messages.length - 1];
  //console.log(`[review] 最后一条消息类型: ${lastMsg._getType()}`);

  // 情况 1: 用户拒绝 (前端通常会插入一条 ToolMessage 说 "User rejected")
  if (
    lastMsg._getType() === "tool" ||
    (lastMsg.content && (lastMsg.content as string).includes("rejected"))
  ) {
    //console.log("[review] 🛑 检测到拒绝信号，跳过工具执行，回 executor");
    return new Command({ goto: "executor" });
  }

  // 情况 2: 用户批准
  // 此时最后一条消息应该是 AI 之前发出的请求 (AIMessage 且带 tool_calls)
  if (lastMsg._getType() === "ai" && (lastMsg as any).tool_calls?.length > 0) {
    // console.log("[review] ✅ 检测到待执行的工具，批准通过！");
    // console.log("[review] 🚀 正在跳转到 -> tools 节点...");

    // 🔥 核心修复：必须显式返回 goto: "tools"
    return new Command({
      goto: "tools",
    });
  }

  // 情况 3: 异常状态
  // console.warn(
  //   "[review] ⚠️ 这里的状态有点奇怪，既不是拒绝也不是待执行的工具，默认回 executor",
  // );
  return new Command({ goto: "executor" });
}
