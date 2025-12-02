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
} from "./prompt.ts";
import { AgentState } from "./state.js";
import { baseModel, modelWithTools } from "../config/model.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { Command } from "@langchain/langgraph";
import { z } from "zod";
// 简单的代码审查结构化输出 schema，供 reviewCode 节点使用（避免导入时 ReferenceError）
const CodeReviewSchema = z.object({
  decision: z.enum(["pass", "fail"]),
  issues: z.string().optional(),
});

// 从模型生成的文本中尝试提取测试计划（简单实现：查找 '### Step 2' 后的内容）
function extractTestPlan(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const marker = "### Step 2";
  const idx = text.indexOf(marker);
  if (idx === -1) return undefined;
  return text.slice(idx);
}
import { tools, SENSITIVE_TOOLS } from "../utils/tools/index.ts";
import path from "path";
import { randomUUID } from "crypto";
const MAX_RETRIES = 5;
import { project_tree } from "../utils/tools/project_tree.ts";

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

//解析用户输入，提取用户意图
export const parseUserInput = async (state: AgentState) => {
  const historyText = state.messages
    .map((msg) => `[${msg.type === "human" ? "User" : "Assistant"}]: ${msg.content}`)
    .join("\n");

  const parsePrompt = [new SystemMessage({ content: buildParseUserInputPrompt(historyText) })];
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
  const messages = [...state.messages, new HumanMessage({ content: promptText })];
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
    codeUnderTest = "（当前上下文中没有明确的实现代码，可根据任务描述和函数约定设计测试。）";
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
  const { system, human } = buildReviewPrompt({ currentTask, programmingLanguage, generatedCode });
  const reviewPrompt = [new SystemMessage({ content: system }), new HumanMessage({ content: human })];
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

export async function projectPlannerNode(state: AgentState): Promise<Partial<AgentState>> {
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
  const projectPlanText = (res.projectPlanText as string) || String(res.projectPlanText || "");
  const techStackSummary = (res.techStackSummary as string) || "";
  const projectInitSteps = Array.isArray(res.projectInitSteps) ? res.projectInitSteps : [];

  // 把可读的计划文本写回消息流（不要直接 push 结构化对象）
  const snapshot = `PROJECT_PLANNER_SNAPSHOT:\nprojectInitSteps=${projectInitSteps.length}, techStackSummary=${techStackSummary.slice(0,100)}, planPreview=${projectPlanText.slice(0,200)}`;
  return {
    messages: [...state.messages, new SystemMessage({ content: projectPlanText }), new SystemMessage({ content: snapshot })],
    projectPlanText,
    techStackSummary,
    projectInitSteps,
  } as Partial<import("./state.js").AgentState>;
}

export async function taskPlannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];
  const projectPlan = state.projectPlanText ?? "";
  const initSteps = state.projectInitSteps ?? [];

  const system = new SystemMessage({
    content: [
      "你是开发任务拆解助手，负责生成可以直接执行的 ToDo 列表。",
      "前几条任务必须覆盖上游提供的 projectInitSteps（不允许遗漏）。",
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
      "请根据以上信息生成一个有序的 ToDo 列表（todos 字段），前几条必须覆盖所有 projectInitSteps。",
    ].join("\n"),
  });

  const structured = baseModel.withStructuredOutput(TaskPlanSchema);
  const res = await structured.invoke([system, user]);

  const todos = Array.isArray(res.todos) ? res.todos : [];

  // 把 todos 写入消息流以便下游能看到最新的文本消息
  const todosText = todos.length ? `ToDos:\n${todos.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}` : "";
  return {
    messages: [...state.messages, new SystemMessage({ content: todosText || "(无 ToDo)" })],
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

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return {};
  }

  const toolCalls: ToolCall[] = Array.isArray((lastMessage as { tool_calls?: unknown }).tool_calls)
    ? (lastMessage as { tool_calls?: ToolCall[] }).tool_calls ?? []
    : [];
  if (!toolCalls.length) return {};

  for (const call of toolCalls) {
    const name = call.name;
    const rawArgs = call.args || {};
    const sanitizedArgs: Record<string, unknown> = { ...rawArgs };
    let skipCall = false;

    // 遍历 args，检测可能的路径参数并强制为绝对路径或报错
    const strict = process.env.STRICT_ABSOLUTE_PATHS === "true";
    const projectRootBase = (state.projectRoot && path.resolve(state.projectRoot)) || process.cwd();

      const isPathKey = (k: string) => /\b(?:path|file|dir|directory|workingDir|workingDirectory|file_path|filePath|target)\b/i.test(k);

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
            new SystemMessage({ content: `路径参数拒绝：${key} -> ${raw}（不得超出 projectRoot: ${projectRootBase}）` }),
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
          new SystemMessage({ content: `路径参数必须为绝对路径：${key} -> ${raw}. 请提供以盘符或 '/' 开头的绝对路径。` }),
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
          new SystemMessage({ content: `解析后的路径超出 projectRoot：${key} -> ${resolved}（原始：${raw}）。已拒绝。` }),
        );
        skipCall = true;
        continue;
      }
      sanitizedArgs[key] = resolved;
    }

    if (skipCall) {
      outMsgs.push(new SystemMessage({ content: `工具 ${name} 已被跳过，请修正路径参数后重试。` }));
      continue;
    }

    // 查找对应工具实例
    const tool = (tools as ToolLike[]).find(
      (t) => t && (t.name === name || t.metadata?.name === name),
    );
    if (!tool || typeof tool.func !== "function") {
      outMsgs.push(new SystemMessage({ content: `工具未找到: ${name}` }));
      continue;
    }

    try {
      // 调用工具：把 state.projectRoot 放入 config.configurable 里，便于工具获取
      const config = { configurable: { projectRoot: state.projectRoot } } as Record<string, unknown>;
      const result = await tool.func?.(sanitizedArgs, config);
      outMsgs.push(new SystemMessage({ content: `工具 ${name} 执行成功：\n${String(result)}` }));
    } catch (err) {
      const errMsg = typeof err === "string" ? err : (err as Error)?.message || String(err);
      outMsgs.push(new SystemMessage({ content: `工具 ${name} 执行失败：\n${errMsg}` }));
    }
  }

  if (outMsgs.length === 0) return {};
  
  // 关键优化：每次工具执行后，强制重置项目目录注入标志为false
  // 这样下次agent调用前会重新获取最新的项目结构
  return {
    messages: [...messages, ...outMsgs],
    projectTreeInjected: false,
  };
};

export const agent = async (state: AgentState) => {
  const {
    messages,
    summary,
    projectProfile,
    testPlanText,
    todos = [],
    currentTodoIndex = 0,
    currentTask,
    projectTreeText
  } = state;

  const contextMessages: SystemMessage[] = [];
  
  // 1. 添加项目结构信息（如果有），限制大小以避免上下文过大
  if (projectTreeText && projectTreeText.trim()) {
    // 限制项目树文本的大小，避免上下文超限
    const maxTreeLength = 5000; // 设置合理的最大长度
    const truncatedTreeText = projectTreeText.length > maxTreeLength 
      ? projectTreeText.substring(0, maxTreeLength) + '\n...（项目结构过大，已截断）'
      : projectTreeText;
    
    contextMessages.push(
      new SystemMessage({
        content: `## 当前项目结构\n\n${truncatedTreeText}\n`
      }),
    );
  }
  
  // 2. 当前要做的 Todo / 任务
  const todoFromList = todos[currentTodoIndex];
  const effectiveTask = todoFromList || currentTask; // 优先用 todo 列表里的

  if (effectiveTask) {
    contextMessages.push(
      new SystemMessage({
        content:
          `你正在帮用户完成一个编程小项目。\n` +
          `当前只需要专注完成下面这一条任务（不要跳到后面的任务）：\n` +
          `「${effectiveTask}」\n\n` +
          `如果需要，可以调用可用的工具来完成这个任务。`,
      }),
    );
  }

  // 2. 添加摘要（如果有）
  if (summary) {
    contextMessages.push(
      new SystemMessage({
        content:
          `对话摘要：\n${summary}\n\n` +
          `请基于此摘要和最新消息生成响应。`,
      }),
    );
  }

  // 3. 添加项目信息（如果有）
  if (projectProfile) {
    contextMessages.push(
      new SystemMessage({
        content:
          `项目信息：\n` +
          `- 主要语言: ${projectProfile.primaryLanguage}\n` +
          `- 测试框架: ${projectProfile.testFrameworkHint || "未知"}\n\n` +
          `请生成符合项目风格的代码和文件操作，尽量沿用既有风格。`,
      }),
    );
  }

  // 4. 添加测试计划（如果有）
  if (testPlanText) {
    contextMessages.push(
      new SystemMessage({
        content:
          `当前测试计划摘要：\n${testPlanText}\n\n` +
          `请确保生成的代码和文件操作有利于通过这些测试。`,
      }),
    );
  }

  // 5. 合并消息并调用模型
  const fullMessages = [...contextMessages, ...messages];
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
      console.warn('Failed to restore cwd:', err);
    }
    return {
      messages: [...messages, response],
      currentTask: effectiveTask,
    };
  } finally {
    try {
      process.chdir(originalCwd);
    } catch (err) {
      console.warn('Failed to restore cwd:', err);
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
  if (lastMessage && AIMessage.isInstance(lastMessage) && lastMessage.tool_calls?.length) {
    const sensitiveCalls = lastMessage.tool_calls.filter(tool => 
      SENSITIVE_TOOLS.includes(tool.name)
    );
    
    console.log("=== 人工审批请求 ===");
    console.log(`待审批工具调用: ${sensitiveCalls.length} 个`);
    
    // 详细显示每个敏感工具调用的信息
    sensitiveCalls.forEach((call, index) => {
      console.log(`\n工具 ${index + 1}: ${call.name}`);
      console.log(`参数: ${JSON.stringify(call.args, null, 2)}`);
      
      // 为文件操作提供额外说明
      if (call.name.includes('file') || call.name.includes('code')) {
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

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  // 兼容旧的 plannerNode：改为顺序调用新的 project & task planner
  const projectRes = await projectPlannerNode(state as AgentState);
  const intermediateState = { ...state, ...projectRes } as AgentState;
  const taskRes = await taskPlannerNode(intermediateState as AgentState);

  return {
    ...projectRes,
    ...taskRes,
  };
}
