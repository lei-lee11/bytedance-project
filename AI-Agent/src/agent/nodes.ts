/**
 * Nodes implementation.
 * Prompts/templates are centralized in `src/agent/prompt.ts`.
 * Keep prompts in that file and call the builder functions from nodes.
 */
import {
  SystemMessage,
  RemoveMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import {
  buildParseUserInputPrompt,
  buildSummarizePrompt,
  buildCodeWithTestPlanPrompt,
  buildUnitTestOnlyPrompt,
  buildReviewPrompt,
} from "./prompt.ts`";
import { AgentState } from "./state";
import { baseModel, modelWithTools } from "../config/model";
import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { tools, SENSITIVE_TOOLS } from "../utils/tools/index.js";
import path from "path";

import { project_tree } from "../utils/tools/project_tree.js";

// 简单的代码审查结构化输出 schema，供 reviewCode 节点使用（避免导入时 ReferenceError）
const CodeReviewSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  issues: z.string().optional(),
});

// 行动记录更新节点：将最近的工具调用记录整理为可读的 recentActions
export const updateRecentActionsNode = (state: AgentState): Partial<AgentState> => {
  const { lastToolCalls = [], recentActions = "" } = state;

  if (!lastToolCalls.length) return {};

  const newLines = lastToolCalls.map(
    (c) => `- 工具 ${c.name}: ${c.detail}`
  );

  const newRecentActions = 
    (recentActions ? recentActions + "\n" : "") + newLines.join("\n");

  // 限制 recentActions 的最大长度
  const maxLen = 4000;
  const clipped = 
    newRecentActions.length > maxLen
      ? newRecentActions.slice(-maxLen)
      : newRecentActions;

  return {
    recentActions: clipped,
    lastToolCalls: [], // 清空，下一轮再填
  };
};

// 任务意图分类节点：判断本次任务的类型
export const TaskIntentSchema = z.object({
  mode: z.enum(["new_project", "bug_fix", "feature", "refactor"]),
  reason: z.string().describe("Why this mode was chosen, in Chinese."),
});

export async function intentNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];

  const system = new SystemMessage({
    content: [
      "你是任务意图分类助手。",
      "根据用户的自然语言说明，判断这次任务属于哪一类：",
      "- new_project: 从零新建一个项目 / 脚手架 / 目录结构 / 选 tech stack",
      "- bug_fix: 主要目标是修复错误、让测试通过、解决报错",
      "- feature: 在已有项目上增加新功能、接口、模块、页面等",
      "- refactor: 调整已有代码结构、优化设计、重构（功能基本不变）",
      "",
      "只输出 mode 和简短 reason，不要输出其他自由文本。",
    ].join("\n"),
  });

  const user = new HumanMessage({
    content: [
      "用户当前的完整需求如下：",
      "----------------------",
      String(lastUser?.content ?? ""),
      "----------------------",
      "",
      "请根据以上内容选择最合适的 mode。",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(TaskIntentSchema);
  const res = await structured.invoke([system, user]);

  return {
    mode: res.mode,
    // 把 reason 写进 summary 里，让后面 agent 也能看到
    summary: `${state.summary ?? ""}\n[Intent] 模式 = ${res.mode}，原因：${res.reason}`,
  };
}

// 从模型生成的文本中尝试提取测试计划（简单实现：查找 '### Step 2' 后的内容）
function extractTestPlan(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const marker = "### Step 2";
  const idx = text.indexOf(marker);
  if (idx === -1) return undefined;
  return text.slice(idx);
}
const MAX_RETRIES = 5;

type ToolLike = {
  name?: string;
  metadata?: { name?: string };
  func?: (
    args: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
};

type ToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

// 结构化输出 schema：project planner
const ProjectPlanSchema = z.object({
  projectPlanText: z.string(),
  techStackSummary: z.string().optional(),
  projectInitSteps: z.array(z.string()).optional(),
});

// 结构化输出 schema：task planner（返回 todos 列表）
const TaskPlanSchema = z.object({
  todos: z.array(z.string()),
});

// Bug 修复规划 schema
const BugFixPlanSchema = z.object({
  todos: z.array(z.string().describe("一个详细任务描述")),
});

// 代码变更规划 schema
const CodeChangePlanSchema = z.object({
  todos: z.array(z.string()),
});

import { attachFilesToContext } from "../utils/tools/fileContext.js";

// plannerNode 总调度：根据 mode 分发到不同的规划器
export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const mode = state.mode ?? "feature"; // 没识别出来默认按 feature

  if (mode === "new_project") {
    // 继续用原来的两段式规划
    const projectRes = await projectPlannerNode(state as AgentState);
    const intermediateState = { ...state, ...projectRes } as AgentState;
    const taskRes = await taskPlannerNode(intermediateState as AgentState);
    return {
      ...projectRes,
      ...taskRes,
    };
  }

  if (mode === "bug_fix") {
    // 新的 bug 修复型 planner
    return bugFixTaskPlannerNode(state);
  }

  // feature / refactor 共用一个
  return codeChangeTaskPlannerNode(state);
}

// bugFixTaskPlannerNode：专门为“修 bug”拆 todo
export async function bugFixTaskPlannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];
  const projectRoot = state.projectRoot || ".";
  const projectTree = state.projectTreeText ?? "";
  const testPlan = state.testPlanText ?? "";

  const system = new SystemMessage({
    content: [
      "你是 Bug 修复任务拆解助手，负责生成详细、可直接执行的 ToDo 列表。",
      "此次任务是 bug_fix（修复错误），目标通常是：让报错消失 / 测试通过。",
      "",
      "要求：",
      "1. ToDo 列表必须体现典型的 Debug 流程，例如：",
      "   - 理解报错信息 / 失败测试",
      "   - 定位相关文件和函数",
      "   - 阅读和分析相关代码",
      "   - 修改代码并解释修改思路",
      "   - 运行测试命令（例如 pytest），验证是否修复",
      "2. 每个 ToDo 文本应包含：",
      "   - 具体目标（比如：找出导致 test_xxx 失败的原因）",
      "   - 建议使用的工具或操作（例如：read_file, run_command）",
      "   - 验收标准（例如：指定测试用例通过、不再出现某个错误信息）。",
      "3. ToDo 数量建议 3~8 条之间，粒度适中。",
      "4. 只输出结构化字段 todos（string[]），不要输出其他内容。",
    ].join("\n"),
  });

  const user = new HumanMessage({
    content: [
      `项目根目录: ${projectRoot}`,
      "",
      "===== 项目结构（可能已截断） =====",
      projectTree,
      "",
      "===== 测试计划 / 已知测试信息 =====",
      testPlan || "(无)",
      "",
      "===== 用户原始需求（包含错误描述或失败测试） =====",
      String(lastUser?.content ?? ""),
      "",
      "请根据以上信息生成 bug 修复的 ToDo 列表。",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(BugFixPlanSchema);
  const res = await structured.invoke([system, user]);
  const todos = Array.isArray(res.todos) ? res.todos : [];

  const todosText = todos.length
    ? `Bug Fix ToDos:\n${todos
        .map((t: string, i: number) => `${i + 1}. ${t}`)
        .join("\n")}`
    : "";

  return {
    messages: [
      ...state.messages,
      new SystemMessage({ content: todosText || "(无 ToDo)" }),
    ],
    todos,
    currentTodoIndex: 0,
    currentTask: todos[0] ?? "按照 ToDo 列表逐条修复 bug",
  };
}

// codeChangeTaskPlannerNode：给“改代码 / 写项目功能”用
export async function codeChangeTaskPlannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];
  const projectPlan = state.projectPlanText ?? "";      // 有可能是空（比如老项目）
  const initSteps = state.projectInitSteps ?? [];
  const projectTree = state.projectTreeText ?? "";

  const system = new SystemMessage({
    content: [
      "你是开发任务拆解助手，负责为功能开发 / 重构生成详细 ToDo 列表。",
      "本次任务类型为 feature/refactor（在现有项目上增加功能或重构）。",
      "",
      "要求：",
      "1. 任务描述必须详细具体，包含：目标、主要操作步骤、验收标准、预期输出。",
      "2. ToDo 应体现在现有项目结构基础上工作，充分利用已有模块。",
      "3. 如果提供了 projectInitSteps，则前几条任务需要完成这些前置步骤（如安装依赖、基础配置），之后进入具体功能开发。",
      "4. 只输出结构化字段 todos（string[]）。",
    ].join("\n"),
  });

  const user = new HumanMessage({
    content: [
      "===== 项目规划文档（如有） =====",
      projectPlan || "(无)",
      "",
      "===== 工程级前置步骤 projectInitSteps（如有） =====",
      initSteps.length
        ? initSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "(无)",
      "",
      "===== 项目结构（可能已截断） =====",
      projectTree || "(未提供)",
      "",
      "===== 用户原始需求 =====",
      String(lastUser?.content ?? ""),
      "",
      "请生成一个有序的 ToDo 列表，数量建议在 4~10 条之间。",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(CodeChangePlanSchema);
  const res = await structured.invoke([system, user]);
  const todos = Array.isArray(res.todos) ? res.todos : [];

  const todosText = todos.length
    ? `Dev ToDos:\n${todos.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : "";

  return {
    messages: [
      ...state.messages,
      new SystemMessage({ content: todosText || "(无 ToDo)" }),
    ],
    todos,
    currentTodoIndex: 0,
    currentTask: todos[0] ?? "根据 ToDo 列表逐条完成开发任务",
  };
}

// 解析用户输入，提取用户意图
export const parseUserInput = async (state: AgentState) => {
  const historyText = state.messages
    .map(
      (msg) =>
        `[${msg.type === "human" ? "User" : "Assistant"}]: ${msg.content}`,
    )
    .join("\n");

  const parsePrompt = [
    new SystemMessage({ content: buildParseUserInputPrompt(historyText) }),
  ];
  const response = await baseModel.invoke(parsePrompt);
  const parsed = JSON.parse(response.content as string);
  return {
    currentTask: parsed.currentTask?.trim() || "",
    programmingLanguage: parsed.programmingLanguage?.trim() || "",
    codeContext: parsed.codeContext?.trim() || "",
  };
};

// 总结对话历史，截取最新6条message
export const summarizeConversation = async (state: AgentState) => {
  // 首先获取现有的摘要
  const summary = state.summary || "";

  // 摘要提示由 prompt builder 生成

  // 将提示词添加到对话历史中（使用 prompt builder）
  const promptText = buildSummarizePrompt(summary);
  const messages = [
    ...state.messages,
    new HumanMessage({ content: promptText }),
  ];
  const response = await baseModel.invoke(messages);

  // 删除除最后2条外的所有消息（保留原逻辑）
  const deleteMessages = state.messages
    .slice(0, -2)
    .reduce((acc: RemoveMessage[], m) => {
      if (m && typeof (m as { id?: unknown }).id === "string") {
        const id = (m as { id?: string }).id as string;
        acc.push(new RemoveMessage({ id }));
      }
      return acc;
    }, []);

  return {
    summary: response.content,
    messages: deleteMessages,
  };
};

/**
 * 处理用户引用的文件，将内容直接注入为系统消息
 * 这样文件内容只在当前轮次使用，不会持久化累积
 */
export const processReferencedFiles = async (state: AgentState) => {
  const newFilePaths = state.pendingFilePaths || [];

  if (newFilePaths.length === 0) {
    return {}; // 没有新文件，不做任何操作
  }

  try {
    const projectRoot = state.projectRoot || process.cwd();

    // 读取并格式化文件
    const { formattedContext } = await attachFilesToContext(
      newFilePaths,
      projectRoot,
    );

    // 将文件内容作为 SystemMessage 直接注入到消息流
    // 这样内容会成为对话历史的一部分，可被 summarize 压缩
    const fileContextMessage = new SystemMessage({
      content: formattedContext,
      additional_kwargs: {
        message_type: "file_context",
      },
    });

    return {
      messages: [fileContextMessage], // 直接添加到消息流
      pendingFilePaths: [], // 清空待处理队列
    };
  } catch (error) {
    console.error("Failed to process referenced files:", error);
    return {
      pendingFilePaths: [], // 清空以避免重复错误
    };
  }
};

//扫描项目结构
export const injectProjectTreeNode = async (state: AgentState) => {
  // 如果不需要更新就直接返回
  if (state.projectTreeInjected) {
    return {};
  }

  const root = state.projectRoot || ".";
  const treeText = await project_tree.invoke({
    root_path: root,
    max_depth: -1,
    include_hidden: false,
    include_files: true,
    max_entries: 3000,
  });

  // 重要修改：不再向messages中添加项目树信息
  // 只设置projectTreeText变量，让agent函数在需要时智能添加

  return {
    projectTreeText: treeText,
    projectTreeInjected: true,
  };
};

// 生成代码，根据用户意图和上下文
export const generateCode = async (state: AgentState) => {
  const { messages, currentTask, programmingLanguage, codeContext } = state;

  const promptText = buildCodeWithTestPlanPrompt({
    currentTask,
    programmingLanguage,
    codeContext,
  });

  const codePrompt = [new SystemMessage({ content: promptText }), ...messages];
  const response = await baseModel.invoke(codePrompt);

  let testPlanText: string | undefined;
  if (typeof response.content === "string") {
    testPlanText = extractTestPlan(response.content);
  }

  return {
    messages: [...messages, response],
    testPlanText: testPlanText ?? state.testPlanText ?? "",
  };
};

// 专门生成单元测试的节点
export const generateTests = async (state: AgentState) => {
  const {
    messages,
    currentTask,
    programmingLanguage,
    codeContext,
    testPlanText, // 我们在 StateAnnotation 里刚加的那个字段
  } = state;

  // 1. 确定“待测代码”
  let codeUnderTest = (codeContext || "").trim();

  // 如果 codeContext 里没有，就退回去找「最近一条 AI 消息」
  if (!codeUnderTest) {
    const lastAiMsg = [...messages].reverse().find((m) => m.type === "ai");
    if (lastAiMsg && typeof lastAiMsg.content === "string") {
      codeUnderTest = lastAiMsg.content;
    }
  }

  // 兜底：实在找不到，就让模型基于任务描述设计测试
  if (!codeUnderTest) {
    codeUnderTest =
      "（当前上下文中没有明确的实现代码，可根据任务描述和函数约定设计测试。）";
  }

  // 2. 构造 Prompt —— 把之前的测试计划（如果有）一起传进去
  const promptArgs = {
    currentTask,
    programmingLanguage,
    codeUnderTest,
    existingTestPlan: testPlanText,
  } as Parameters<typeof buildUnitTestOnlyPrompt>[0];

  const promptText = buildUnitTestOnlyPrompt(promptArgs);

  const systemMsg = new SystemMessage({ content: promptText });

  const response = await baseModel.invoke([systemMsg]);

  return {
    messages: [...messages, response],
  };
};

// 审查代码，判断是否符合要求
export const reviewCode = async (state: AgentState) => {
  const { messages, currentTask, programmingLanguage, retryCount } = state;

  const lastAIMessage = [...messages]
    .reverse()
    .find((msg) => msg.type === "ai");
  if (!lastAIMessage) {
    throw new Error("No AI-generated code found for review");
  }
  const generatedCode = lastAIMessage.content as string;
  const structuredModel = baseModel.withStructuredOutput(CodeReviewSchema);
  const { system, human } = buildReviewPrompt({
    currentTask,
    programmingLanguage,
    generatedCode,
  });
  const reviewPrompt = [
    new SystemMessage({ content: system }),
    new HumanMessage({ content: human }),
  ];
  const reviewResult = await structuredModel.invoke(reviewPrompt);
  const isPass = reviewResult.decision === "pass";
  if (isPass) {
    return {
      reviewResult: "pass",
      retryCount,
    };
  } else {
    const newRetryCount = retryCount + 1;
    if (newRetryCount >= MAX_RETRIES) {
      console.warn("Max retries reached. Accepting current code.");
      return {
        reviewResult: "pass", // 强制通过，避免死循环
        retryCount: newRetryCount,
      };
    }
    return {
      reviewResult: "fail",
      retryCount: newRetryCount,
    };
  }
};

export const toolNode = new ToolNode(tools);

export async function projectPlannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];
  const projectRoot = state.projectRoot || ".";

  const system = new SystemMessage({
    content: [
      "你是架构规划助手，只负责决定技术栈和项目结构，不负责拆细粒度 ToDo。",
      "你需要输出结构化结果：projectPlanText, techStackSummary, projectInitSteps。",
      "projectInitSteps 必须是可以直接执行的工程级初始化步骤（例如：创建项目、安装依赖、生成配置文件、初始化样式框架等）。",
      "不要输出额外说明或自由文本，严格按结构化格式返回。",
    ].join("\n"),
  });

  const user = new HumanMessage({
    content: [
      `项目根目录：\`${projectRoot}\``,
      "用户需求：",
      "--------------------------------",
      lastUser?.content ?? "",
      "--------------------------------",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(ProjectPlanSchema);
  const res = await structured.invoke([system, user]);

  // 兼容性处理：确保字段存在
  const projectPlanText =
    (res.projectPlanText as string) || String(res.projectPlanText || "");
  const techStackSummary = (res.techStackSummary as string) || "";
  const projectInitSteps = Array.isArray(res.projectInitSteps)
    ? res.projectInitSteps
    : [];

  // 把可读的计划文本写回消息流（不要直接 push 结构化对象）
  const snapshot = `PROJECT_PLANNER_SNAPSHOT:\nprojectInitSteps=${projectInitSteps.length}, techStackSummary=${techStackSummary.slice(0, 100)}, planPreview=${projectPlanText.slice(0, 200)}`;
  return {
    messages: [
      ...state.messages,
      new SystemMessage({ content: projectPlanText }),
      new SystemMessage({ content: snapshot }),
    ],
    projectPlanText,
    techStackSummary,
    projectInitSteps,
  } as Partial<import("./state.js").AgentState>;
}

export async function taskPlannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];
  const projectPlan = state.projectPlanText ?? "";
  const initSteps = state.projectInitSteps ?? [];

  const system = new SystemMessage({
    content: [
      "你是开发任务拆解助手，负责生成详细、可直接执行的 ToDo 列表。",
      "任务描述必须详细具体，包含：1)具体目标 2)操作步骤 3)验收标准 4)预期成果。",
      "前几条任务必须覆盖上游提供的 projectInitSteps（不允许遗漏），并对这些步骤进行详细描述和扩展。",
      "确保每个任务描述足够清晰，让执行agent一看就知道要做什么、如何做、以及完成标准是什么。",
      "任务粒度要适中，避免过于简单或过于复杂的任务描述。",
      "只输出结构化字段 todos（string[]）。",
    ].join("\n"),
  });

  const user = new HumanMessage({
    content: [
      "===== 项目规划文档 =====",
      projectPlan,
      "",
      "===== 上游提供的工程级前置步骤 projectInitSteps =====",
      initSteps.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n"),
      "",
      "===== 用户原始需求 =====",
      lastUser?.content ?? "",
      "",
      "请根据以上信息生成一个有序的 ToDo 列表（todos 字段）。每个任务描述必须包含：",
      "1. 明确的任务目标 - 说明这个任务要实现什么",
      "2. 具体的操作步骤 - 如何完成这个任务",
      "3. 明确的验收标准 - 如何判断任务已完成",
      "4. 预期输出成果 - 完成后会产生什么",
      "",
      "前几条任务必须覆盖并详细描述所有 projectInitSteps，每个任务描述长度建议在50-150字之间。",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(TaskPlanSchema);
  const res = await structured.invoke([system, user]);

  const todos = Array.isArray(res.todos) ? res.todos : [];

  // 把 todos 写入消息流以便下游能看到最新的文本消息
  const todosText = todos.length
    ? `ToDos:\n${todos.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`
    : "";
  return {
    messages: [
      ...state.messages,
      new SystemMessage({ content: todosText || "(无 ToDo)" }),
    ],
    todos,
    currentTodoIndex: 0,
    currentTask: "根据 ToDo 列表逐条完成开发任务",
  } as Partial<import("./state.js").AgentState>;
}

// 自定义工具执行器：直接执行模型请求的 tool_calls，并把结果或错误作为消息写回 state
export const toolExecutor = async (state: AgentState) => {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];
  const outMsgs: SystemMessage[] = [];
  const lastToolCalls = state.lastToolCalls || [];

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return {};
  }

  const toolCalls: ToolCall[] = Array.isArray(
    (lastMessage as { tool_calls?: unknown }).tool_calls,
  )
    ? ((lastMessage as { tool_calls?: ToolCall[] }).tool_calls ?? [])
    : [];
  if (!toolCalls.length) return {};

  for (const call of toolCalls) {
    const name = call.name;
    const rawArgs = call.args || {};
    const sanitizedArgs: Record<string, unknown> = { ...rawArgs };
    let skipCall = false;

    // 遍历 args，检测可能的路径参数并强制为绝对路径或报错
    const strict = process.env.STRICT_ABSOLUTE_PATHS === "true";
    const projectRootBase =
      (state.projectRoot && path.resolve(state.projectRoot)) || process.cwd();

    const isPathKey = (k: string) =>
      /\b(?:path|file|dir|directory|workingDir|workingDirectory|file_path|filePath|target)\b/i.test(
        k,
      );

    for (const key of Object.keys(rawArgs)) {
      if (!isPathKey(key)) continue;
      const raw = rawArgs[key];
      if (typeof raw !== "string" || raw.trim() === "") continue;
      // 如果已经是绝对路径，校验是否越界
      if (path.isAbsolute(raw)) {
        const resolved = path.resolve(raw);
        const rp = projectRootBase.toLowerCase();
        const rp2 = resolved.toLowerCase();
        if (!rp2.startsWith(rp)) {
          // 路径逃出 projectRoot
          outMsgs.push(
            new SystemMessage({
              content: `路径参数拒绝：${key} -> ${raw}（不得超出 projectRoot: ${projectRootBase}）`,
            }),
          );
          skipCall = true;
          continue;
        }
        // 合法，继续
        sanitizedArgs[key] = resolved;
        continue;
      }

      // 非绝对路径
      if (strict) {
        outMsgs.push(
          new SystemMessage({
            content: `路径参数必须为绝对路径：${key} -> ${raw}. 请提供以盘符或 '/' 开头的绝对路径。`,
          }),
        );
        skipCall = true;
        continue;
      }

      // 非严格模式：把相对路径解析到 projectRoot 下，并阻止越界
      const resolved = path.resolve(projectRootBase, raw);
      const rp = projectRootBase.toLowerCase();
      const rp2 = resolved.toLowerCase();
      if (!rp2.startsWith(rp)) {
        outMsgs.push(
          new SystemMessage({
            content: `解析后的路径超出 projectRoot：${key} -> ${resolved}（原始：${raw}）。已拒绝。`,
          }),
        );
        skipCall = true;
        continue;
      }
      sanitizedArgs[key] = resolved;
    }

    if (skipCall) {
      outMsgs.push(
        new SystemMessage({
          content: `工具 ${name} 已被跳过，请修正路径参数后重试。`,
        }),
      );
      lastToolCalls.push({
        name,
        detail: `工具 ${name} 已被跳过：路径参数错误`
      });
      continue;
    }

    // 查找对应工具实例
    const tool = (tools as ToolLike[]).find(
      (t) => t && (t.name === name || t.metadata?.name === name),
    );
    if (!tool || typeof tool.func !== "function") {
      outMsgs.push(new SystemMessage({ content: `工具未找到: ${name}` }));
      lastToolCalls.push({
        name,
        detail: `工具未找到: ${name}`
      });
      continue;
    }

    try {
      // 调用工具：把 state.projectRoot 放入 config.configurable 里，便于工具获取
      const config = {
        configurable: { projectRoot: state.projectRoot },
      } as Record<string, unknown>;
      const result = await tool.func?.(sanitizedArgs, config);
      outMsgs.push(
        new SystemMessage({
          content: `工具 ${name} 执行成功：\n${String(result)}`,
        }),
      );
      
      // 记录工具调用成功信息
      let detail = `工具 ${name} 执行成功`;
      if (name === 'write_file' || name === 'update_file') {
        const filePath = sanitizedArgs.file_path || sanitizedArgs.filePath;
        if (filePath) {
          detail += `：修改文件 ${filePath}`;
        }
      } else if (name === 'run_command') {
        const command = sanitizedArgs.command;
        if (command) {
          detail += `：执行命令 ${command}`;
        }
      } else if (name === 'read_file') {
        const filePath = sanitizedArgs.file_path || sanitizedArgs.filePath;
        if (filePath) {
          detail += `：读取文件 ${filePath}`;
        }
      } else if (name === 'list_files') {
        const dirPath = sanitizedArgs.dir_path || sanitizedArgs.dirPath;
        if (dirPath) {
          detail += `：列出目录 ${dirPath}`;
        }
      }
      
      lastToolCalls.push({ name, detail });
    } catch (err) {
      const errMsg =
        typeof err === "string" ? err : (err as Error)?.message || String(err);
      outMsgs.push(
        new SystemMessage({ content: `工具 ${name} 执行失败：\n${errMsg}` }),
      );
      lastToolCalls.push({
        name,
        detail: `工具 ${name} 执行失败：${errMsg.substring(0, 100)}${errMsg.length > 100 ? '...' : ''}`
      });
    }
  }

  if (outMsgs.length === 0) return {};

  // 关键优化：每次工具执行后，强制重置项目目录注入标志为false
  // 这样下次agent调用前会重新获取最新的项目结构
  return {
    messages: [...messages, ...outMsgs],
    projectTreeInjected: false,
    lastToolCalls
  };
};

export const agent = async (state: AgentState) => {
  const {
    messages,
    summary,
    recentActions,
    projectProfile,
    testPlanText,
    todos = [],
    currentTodoIndex = 0,
    currentTask,
    projectTreeText,
    mode = "feature",
  } = state;

  const parts: string[] = [];

  // 模式说明
  parts.push(
    [
      "你是一个命令行开发助手。",
      `当前任务模式: ${mode}`,
      mode === "bug_fix"
        ? "- 你的首要目标是修复错误 / 让测试通过。优先使用 run_command 运行测试，分析错误，再定位和修改代码。"
        : mode === "new_project"
        ? "- 你的首要目标是按照规划创建和初始化项目结构，然后逐步实现功能。"
        : "- 你的首要目标是在现有项目中实现新的功能或重构，保持原有行为不出错。",
    ].join("\n"),
  );

  // 1) 项目结构
  if (projectTreeText && projectTreeText.trim()) {
    const maxTreeLength = 5000;
    const truncatedTreeText =
      projectTreeText.length > maxTreeLength
        ? projectTreeText.substring(0, maxTreeLength) +
          "\n...（项目结构过大，已截断）"
        : projectTreeText;

    parts.push(`## 当前项目结构\n${truncatedTreeText}`);
  }

  // 2) 任务 & Todo 列表
  const todoFromList = todos[currentTodoIndex];
  const effectiveTask = todoFromList || currentTask;
  const totalTasks = todos.length;
  const currentTaskNumber = currentTodoIndex + 1;

  if (effectiveTask) {
    parts.push(
      [
        "你是一个专注执行任务的开发助手。",
        "==========================",
        `📋 当前任务 (${currentTaskNumber}/${totalTasks || "?"}):`,
        `「${effectiveTask}」`,
        "==========================",
        "重要说明:",
        "- 你的唯一目标是完成当前任务，不要处理其他任务",
        "- 任务列表由 taskPlannerNode 生成，你必须严格按照计划执行",
        "- 任务完成后自然结束回复，工作流会自动推进到下一个任务",
        "- 如果遇到问题无法完成，明确说明原因",
        "- 可以使用工具来完成任务，如创建/修改文件、运行命令等",
        "",
        "请直接开始执行当前任务，不要询问用户确认。",
      ].join("\n")
    );
  }

  if (todos.length > 0) {
    const todoSummary =
      "## 任务列表概览\n" +
      todos
        .map((todo, idx) => {
          const icon =
            idx === currentTodoIndex ? "🔄" : idx < currentTodoIndex ? "✅" : "⬜";
          return `${icon} ${idx + 1}. ${todo}`;
        })
        .join("\n") +
      `\n\n你现在正在执行任务 ${currentTaskNumber}。`;

    parts.push(todoSummary);
  }

  // 3) 对话长期摘要
  if (summary) {
    parts.push(`## 历史摘要\n${summary}`);
  }

  // 4) 最近几步的动作记录（关键！）
  if (recentActions) {
    parts.push(`## 最近几步的操作记录\n${recentActions}`);
  }

  // 5) 项目信息
  if (projectProfile) {
    parts.push(
      [
        "## 项目信息",
        `- 主要语言: ${projectProfile.primaryLanguage}`,
        `- 测试框架: ${projectProfile.testFrameworkHint || "未知"}`,
        "",
        "请生成符合项目风格的代码和文件操作，尽量沿用既有风格。",
      ].join("\n")
    );
  }

  // 6) 测试计划
  if (testPlanText) {
    parts.push(
      [
        "## 当前测试计划摘要",
        testPlanText,
        "",
        "请确保生成的代码和文件操作有利于通过这些测试。",
      ].join("\n")
    );
  }

  const systemContext = parts.join("\n\n");

  // 7) 对 messages 做一个简单截断（比如保留最后 10 条）
  const MAX_HISTORY = 10;
  const trimmedMessages =
    messages.length > MAX_HISTORY
      ? messages.slice(-MAX_HISTORY)
      : messages;

  const fullMessages = [
    new SystemMessage({ content: systemContext }),
    ...trimmedMessages,
  ];

  // 如果 state 指定了 projectRoot，临时切换进程工作目录
  const originalCwd = process.cwd();
  try {
    if (state.projectRoot) {
      try {
        process.chdir(state.projectRoot);
      } catch (err) {
        console.warn(`无法切换到 projectRoot: ${state.projectRoot} - ${err}`);
      }
    }
    const response = await modelWithTools.invoke(fullMessages);
    // 恢复 cwd
    try {
      process.chdir(originalCwd);
    } catch (err) {
      console.warn("Failed to restore cwd:", err);
    }
    return {
      messages: [...messages, response],
      currentTask: effectiveTask,
    };
  } finally {
    try {
      process.chdir(originalCwd);
    } catch (err) {
      console.warn("Failed to restore cwd:", err);
    }
  }
};

// 节点：推进当前 todo 索引（在工具执行后调用）
export const advanceTodo = async (state: AgentState) => {
  const todos = state.todos || [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;
  if (todos.length === 0) return {};
  // 如果已经到末尾则不再推进
  if (currentTodoIndex >= todos.length) return {};
  return {
    currentTodoIndex: currentTodoIndex + 1,
  };
};

// 优化后的humanReviewNode实现
export const humanReviewNode = async (state: AgentState) => {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];

  // 分析待审批的工具调用
  if (
    lastMessage &&
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls?.length
  ) {
    const sensitiveCalls = lastMessage.tool_calls.filter((tool) =>
      SENSITIVE_TOOLS.includes(tool.name),
    );

    console.log("=== 人工审批请求 ===");
    console.log(`待审批工具调用: ${sensitiveCalls.length} 个`);

    // 详细显示每个敏感工具调用的信息
    sensitiveCalls.forEach((call, index) => {
      console.log(`\n工具 ${index + 1}: ${call.name}`);
      console.log(`参数: ${JSON.stringify(call.args, null, 2)}`);

      // 为文件操作提供额外说明
      if (call.name.includes("file") || call.name.includes("code")) {
        console.log("这是一个文件操作，可能会修改项目文件结构。");
      }
    });

    console.log("\n=== 审批完成，继续执行 ===\n");
  }

  // 可以添加对状态的修改逻辑，例如记录审批时间等
  return {};
};

export function parseTodos(planText: string): string[] {
  const lines = planText.split("\n");

  const start = lines.findIndex((line) =>
    line.trim().startsWith("## 开发 ToDo 列表"),
  );
  if (start === -1) return [];

  const todos: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 碰到下一个标题就结束
    if (trimmed.startsWith("## ")) break;

    // 只收列表项
    if (/^[-•\d.]/.test(trimmed)) {
      const cleaned = trimmed.replace(/^[-•\d.\s]+/, "").trim();
      if (cleaned) todos.push(cleaned);
    }
  }

  return todos;
}


