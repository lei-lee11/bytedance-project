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

  const systemMsg = new SystemMessage({
    content: `下面是当前项目的目录结构（已做截断，请在写代码时遵循该结构）：

${treeText}`,
  });

  // 给这条 system 消息记录一个可追踪 id（也可以直接用 systemMsg.id，如果 LangChain 已经生成了）
  const generatedId =
    typeof randomUUID === "function"
      ? randomUUID()
      : `project-tree-${Date.now()}`;

  // 设置 message id（部分 Message 实现可能不暴露 setter）
  try {
    (systemMsg as unknown as { id?: string }).id = generatedId;
  } catch {
    // ignore if not writable
  }

  // 如果之前有项目结构的 message，生成对应的删除指令
  const deletes = state.projectTreeMessageId
    ? [new RemoveMessage({ id: state.projectTreeMessageId })]
    : [];

  return {
    // ❗这里是关键：只返回删除 + 新消息，不要再拼 state.messages
    messages: [
      ...deletes,  // 删除旧的
      systemMsg,   // 加新的
    ],
    projectTreeText: treeText,
    projectTreeMessageId: generatedId,
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
    testPlanText, 
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
  const promptText = buildUnitTestOnlyPrompt({
    currentTask,
    programmingLanguage,
    codeUnderTest,
    // 这里就是我们刚才说的 existingTestPlan，可选
    existingTestPlan: testPlanText,
  } as any); // 如果你的 buildUnitTestOnlyPrompt 还没更新签名，这里可以先去改它

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

// 自定义工具执行器：直接执行模型请求的 tool_calls，并把结果或错误作为消息写回 state
export const toolExecutor = async (state: AgentState) => {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];
  const outMsgs: SystemMessage[] = [];

  if (!lastMessage || !AIMessage.isInstance(lastMessage)) {
    return {};
  }

  const toolCalls = ((lastMessage as unknown) as { tool_calls?: unknown }).tool_calls as Array<any> | undefined || [];
  if (!toolCalls.length) return {};

  for (const call of toolCalls) {
    const name = call.name;
    const args = call.args || {};

    // 遍历 args，检测可能的路径参数并强制为绝对路径或报错
    const strict = process.env.STRICT_ABSOLUTE_PATHS === "true";
    const projectRootBase = (state.projectRoot && path.resolve(state.projectRoot)) || process.cwd();

      const isPathKey = (k: string) => /\b(?:path|file|dir|directory|workingDir|workingDirectory|file_path|filePath|target)\b/i.test(k);

    for (const key of Object.keys(args)) {
      if (!isPathKey(key)) continue;
      const raw = args[key];
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
          // 跳过本次工具调用
          continue;
        }
        // 合法，继续
        args[key] = resolved;
        continue;
      }

      // 非绝对路径
      if (strict) {
        outMsgs.push(
          new SystemMessage({ content: `路径参数必须为绝对路径：${key} -> ${raw}. 请提供以盘符或 '/' 开头的绝对路径。` }),
        );
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
        continue;
      }
      args[key] = resolved;
    }

    // 查找对应工具实例
    const tool = (tools as Array<unknown>).find((t: any) => (t && (t.name === name || (t.metadata && t.metadata.name === name))));
    if (!tool) {
      outMsgs.push(new SystemMessage({ content: `工具未找到: ${name}` }));
      continue;
    }

    try {
      // 调用工具：把 state.projectRoot 放入 config.configurable 里，便于工具获取
      const config = { configurable: { projectRoot: state.projectRoot } } as unknown as Record<string, unknown>;
      const result = await (tool as any).func?.(args, config);
      outMsgs.push(new SystemMessage({ content: `工具 ${name} 执行成功：\n${String(result)}` }));
    } catch (err) {
      const errMsg = typeof err === "string" ? err : (err as Error)?.message || String(err);
      outMsgs.push(new SystemMessage({ content: `工具 ${name} 执行失败：\n${errMsg}` }));
    }
  }

  if (outMsgs.length === 0) return {};
  return {
    messages: [...messages, ...outMsgs],
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
  } = state;

  const contextMessages: SystemMessage[] = [];

  // 1. 当前要做的 Todo / 任务
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


function parseTodos(planText: string): string[] {
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
  const lastUser = state.messages[state.messages.length - 1];
  const projectRoot = state.projectRoot ?? "C:\\projects\\playground";

  const system = new SystemMessage(
    [
      "你是一个给“代码智能体”做项目规划的助手。",
      "规划结果会直接驱动自动写代码/改文件的过程，所以你只能输出对编码有直接帮助的内容。",
      "",
      "【重要约束】",
      "1. 只允许输出以下三个部分，且顺序必须一致：",
      "   ## 技术栈与项目概要",
      "   ## 项目目录结构",
      "   ## 开发 ToDo 列表",
      "",
      "2. 各部分要求：",
      "   - 技术栈与项目概要：",
      "     - 选择主要技术栈（例如：React + TypeScript + Vite + Tailwind CSS）。",
      "     - 用 2~5 句解释选择理由和整体思路。",
      "   - 项目目录结构：",
      "     - 用 tree 风格列出核心目录和关键文件，路径相对项目根目录（例如：src/pages/Home.tsx）。",
      "     - 不要展开到每一个小组件，只列对整体结构重要的部分。",
      "   - 开发 ToDo 列表：",
      "     - 列出 8~20 条“可以通过代码和文件操作完成”的开发任务。",
      "     - 每条 ToDo 必须尽量指明涉及的文件/目录（相对路径）。",
      "     - 每条 ToDo 粒度大致能在 1~3 次智能体调用内完成。",
      "",
      "3. 明确禁止输出：",
      "   - ‘可能的扩展功能’、未来规划、商业计划、监控、安全、CI/CD、大量功能脑暴。",
      "   - 任何与“持续幸福/持续增长/持续发展”等抽象愿景相关的内容。",
      "   - 部署计划、日志分析、A/B 测试、PWA、安全加固等非本次 demo 必须内容。",
      "",
      "4. ToDo 形态示例（✅ 可以）：",
      "   - `在 src/pages/PostList.tsx 中实现文章列表页，使用 PostCard 展示所有文章。`",
      "   - `在 src/utils/posts.ts 中实现 getPostById(id: string) 函数，从 data/posts.json 中读取文章详情。`",
      "   反例（❌ 禁止）：",
      "   - `完成文章详情页原型设计。`（这是设计工作，不是具体代码实现）",
      "   - `优化用户体验`（过于抽象，不可直接执行）。",
      "",
      "5. 输出要求：",
      "   - 严格使用这三个标题和顺序，不要添加其他 `##` 标题。",
      "   - 内容总长度控制在一个中等篇幅内，不要写长篇说明文，也不要做功能脑暴。",
      "   - 不要输出任何工具名称、版本号、ASCII 艺术或品牌信息。",
    ].join("\n"),
  );

  const user = new HumanMessage(
    [
      `项目根目录（由系统指定，仅作为参考前提，不需要修改）：\`${projectRoot}\``,
      "",
      "下面是用户的需求，请基于此进行项目规划和 ToDo 拆解：",
      "",
      "--------------------------------",
      lastUser?.content ?? "",
      "--------------------------------",
    ].join("\n"),
  );

  const res = await baseModel.invoke([system, user]);
  const fullPlanText = (res as AIMessage).content as string;
  const todos = parseTodos(fullPlanText);

  return {
    messages: [...state.messages, res],
    codeContext: fullPlanText,
    todos,
    currentTodoIndex: 0,
    currentTask: "根据项目规划逐条完成开发 ToDo 列表中的任务",
  };
}
