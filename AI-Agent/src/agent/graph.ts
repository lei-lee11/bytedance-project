import { StateGraph, START, END, Command } from "@langchain/langgraph";
import {
  AIMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { StateAnnotation, AgentState } from "./state.ts";
import { initializeCheckpointer } from "../config/checkpointer.js";
import { SENSITIVE_TOOLS, tools } from "../utils/tools/index.ts";
import { baseModel, modelWithTools } from "../config/model.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { project_tree } from "../utils/tools/project_tree.ts";
import { attachFilesToContext } from "../utils/tools/fileContext.js";
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

/**
 * 初始化节点
 * 合并了 processReferencedFiles 和 injectProjectTreeNode
 */
async function initializeNode(state: AgentState) {
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

  return new Command({
    update: updates,
    goto: "planner",
  });
}

/**
 * 规划节点
 * 合并了 projectPlannerNode 和 taskPlannerNode
 */
async function plannerNode(state: AgentState) {
  console.log("[planner] 开始规划");

  // 如果已经有 todos，跳过规划
  if (state.todos && state.todos.length > 0) {
    console.log("[planner] 已有任务列表，跳过规划");
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
 *
 * 1. 增强循环检测 - 检测重复的AI回复
 * 2. 更严格的任务完成判断
 * 3. 添加消息ID追踪避免重复处理
 */
async function executorNode(state: AgentState) {
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
  const recentMessages = messages.slice(-20); // 只保留最近20条消息
  const fullMessages = [...contextMessages, ...recentMessages];

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

  // 检测是否真的执行了任务（通过检查是否有工具执行结果在消息中）
  const hasToolResults = messages.some(
    (m) =>
      m &&
      ((m as any)._getType?.() === "tool" ||
        m.constructor.name === "ToolMessage"),
  );

  // 任务完成的条件：
  // 1. 有完成关键词 且 之前有工具执行结果
  // 2. 或者迭代次数超过阈值（防止无限循环）
  const taskReallyCompleted = hasCompletionKeyword && hasToolResults;
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

  // 3. 如果是询问式回复，不添加到消息中，直接重试
  if (isAskingForHelp) {
    console.log(`[executor] 检测到询问式回复，重试`);
    return new Command({
      update: {
        iterationCount: newIterationCount,
      },
      goto: "executor",
    });
  }

  // 4. 继续当前任务
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

async function toolsNode(state: AgentState) {
  console.log("[tools] 执行工具");

  try {
    // 执行工具
    const result = await toolsNodeBase.invoke(state);

    console.log("[tools] 工具执行完成");

    // 返回到 executor
    return new Command({
      update: {
        ...result,
        projectTreeInjected: false, // 重置，下次重新扫描
      },
      goto: "executor",
    });
  } catch (error) {
    console.error("[tools] 工具执行失败:", error);

    return new Command({
      update: {
        messages: [
          new SystemMessage({
            content: `工具执行失败: ${error}`,
          }),
        ],
      },
      goto: "executor",
    });
  }
}

/**
 * 人工审批节点
 */
async function reviewNode(state: AgentState) {
  console.log("[review] 等待人工审批");

  const { pendingToolCalls = [] } = state;

  console.log("=== 人工审批请求 ===");
  console.log(`待审批工具: ${pendingToolCalls.length} 个`);

  pendingToolCalls.forEach((call, index) => {
    console.log(`\n工具 ${index + 1}: ${call.name}`);
    console.log(`参数: ${JSON.stringify(call.args, null, 2)}`);
  });

  console.log("\n=== 审批完成，继续执行 ===\n");

  // 这里会被 interruptBefore 中断
  // 用户批准后继续到 tools

  return new Command({
    update: {},
    goto: "tools",
  });
}

/**
 * 构建 Graph
 */
function buildGraph() {
  console.log("[graph] 构建 Graph");

  const workflow = new StateGraph(StateAnnotation)
    // 添加节点，指定可能的出口
    .addNode("initialize", initializeNode, {
      ends: ["planner"],
    })
    .addNode("planner", plannerNode, {
      ends: ["executor"],
    })
    .addNode("executor", executorNode, {
      ends: ["executor", "tools", "review", END],
    })
    .addNode("tools", toolsNode, {
      ends: ["executor"],
    })
    .addNode("review", reviewNode, {
      ends: ["tools"],
    })

    // 只需要定义入口边
    .addEdge(START, "initialize");

  console.log("[graph] Graph 构建完成");
  return workflow;
}

/**
 * 初始化并编译 Graph
 * @param options - 配置选项
 * @param options.demoMode - 演示模式,跳过人工审批
 * @param options.recursionLimit - 递归限制，默认100
 */
export let graph: any;

export async function initializeGraph(
  options: { demoMode?: boolean; recursionLimit?: number } = {},
) {
  const { demoMode = false, recursionLimit = 100 } = options;

  // 如果已有graph且模式匹配,直接返回
  if (graph && graph._demoMode === demoMode) {
    console.log(`[graph] 使用已编译的 Graph (演示模式: ${demoMode})`);
    return graph;
  }

  console.log(
    `[graph] 初始化 Graph (演示模式: ${demoMode}, 递归限制: ${recursionLimit})`,
  );

  const checkpointer = await initializeCheckpointer();
  const workflow = buildGraph();

  // 根据模式决定是否启用人工审批
  const compileOptions: any = {
    checkpointer,
  };

  if (!demoMode) {
    // 生产模式: 启用人工审批
    compileOptions.interruptBefore = ["review"];
    console.log("[graph] 启用人工审批机制");
  } else {
    // 演示模式: 跳过人工审批
    console.log("[graph] 演示模式: 跳过人工审批");
  }

  graph = workflow.compile(compileOptions);
  graph._demoMode = demoMode; // 标记当前模式
  graph._recursionLimit = recursionLimit; // 保存递归限制

  console.log("[graph] Graph 编译完成");
  return graph;
}

/**
 * 获取推荐的递归限制
 * 根据任务数量动态计算
 */
export function getRecommendedRecursionLimit(taskCount: number): number {
  // 每个任务大约需要 5-10 次迭代（调用模型 + 工具执行）
  // 加上初始化和规划阶段的开销
  const baseLimit = 20; // 初始化和规划
  const perTaskLimit = 15; // 每个任务的迭代次数
  return baseLimit + taskCount * perTaskLimit;
}
