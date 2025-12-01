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
  const response = await modelWithTools.invoke(fullMessages);

  // 这里不在 agent 里自增 currentTodoIndex，循环由 graph 的路由控制
  // 只记录一下当前任务，方便下游节点使用
  return {
    messages: [...messages, response],
    currentTask: effectiveTask,
  };
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


function parseTodosFromPlan(planText: string): string[] {
  const lines = planText.split("\n");

  const todosSectionStart = lines.findIndex((line) =>
    line.trim().startsWith("## 开发 ToDo 列表"),
  );

  if (todosSectionStart === -1) {
    // 没有找到标题，就退回到简单暴力版：解析所有行
    return lines
      .map((l) => l.replace(/^\s*[-•\d.\[\]\s]+/, "").trim())
      .filter(Boolean);
  }

  const todoLines: string[] = [];
  for (let i = todosSectionStart + 1; i < lines.length; i++) {
    const line = lines[i];

    // 碰到下一个二级标题，说明 ToDo 部分结束
    if (line.trim().startsWith("## ")) break;

    // 只抽列表项
    if (/^\s*[-•\d.]/.test(line)) {
      const cleaned = line.replace(/^\s*[-•\d.\[\]\s]+/, "").trim();
      if (cleaned) {
        todoLines.push(cleaned);
      }
    }
  }

  return todoLines;
}

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];

  // 如果你在 StateAnnotation 里给 projectRoot 设置了默认值，这里直接用即可
  const projectRoot = state.projectRoot ?? "C:\\projects\\playground";

  const system = new SystemMessage(
    [
      "你是一名资深软件架构师兼项目规划助手，负责为一个本地项目做完整的技术规划和开发任务拆解。",
      "",
      "你的输出会被一个只能“写代码和进行文件操作”的智能体使用，所以：",
      "1. 你需要先做『项目规划』：",
      "   - 根据需求选择合适的技术栈（例如 TypeScript + React + Vite，或 Node.js + Express 等），并简要说明选择理由。",
      "   - 规划项目目录结构（使用相对于项目根目录的路径，例如 src/, tests/, src/pages/Home.tsx 等）。",
      "   - 说明关键模块/文件的作用。",
      "",
      "2. 然后做『开发 ToDo 拆解』：",
      "   - 每一条 ToDo 必须是可以通过“编写/修改代码 + 文件操作”完成的具体任务。",
      "   - 每条 ToDo 要尽量指明涉及的文件或目录（相对路径）。",
      "   - 禁止出现以下类型的任务：",
      "     - 原型设计、UI/交互/视觉设计、线框图绘制。",
      "     - 与用户/产品沟通、需求确认、会议、评审。",
      "     - 抽象的目标，如“提升用户体验”、“优化交互逻辑”这类无法直接编码执行的任务。",
      "   - 任务粒度建议为：一个 ToDo 大致能在 1~3 次 agent 调用内完成。",
      "   - 示例（✅ 可以）：",
      "     - `在 src/pages/PostDetail.tsx 中实现文章详情页组件，包含标题、日期、正文占位。`",
      "     - `在 src/api/posts.ts 中实现 getPostById(id: string) 函数，从本地 JSON 读取文章详情。`",
      "   - 反例（❌ 禁止）：",
      "     - `完成文章详情页原型设计。`",
      "     - `和产品确认文章推荐模块的交互细节。`",
      "",
      "3. 输出格式必须严格遵守：",
      "   - 第一部分标题：`## 项目规划`",
      "     - 描述技术栈选择、项目结构、关键模块。",
      "   - 第二部分标题：`## 开发 ToDo 列表`",
      "     - 使用 Markdown 列表形式列出 ToDo（可以用 `-` 或 `1.` 开头）。",
      "   - 不要输出其他顶级标题。",
      "",
      "你的回答将被直接解析并驱动后续自动开发流程，请确保结构清晰、任务可执行。",
    ].join("\n"),
  );

  const user = new HumanMessage(
    [
      `项目根目录（由系统给定，仅供参考，不需要修改）：\`${projectRoot}\``,
      "",
      "下面是用户的需求，请基于此进行项目规划和任务拆解：",
      "",
      "--------------------------------",
      lastUser?.content ?? "",
      "--------------------------------",
    ].join("\n"),
  );

  const res = await baseModel.invoke([system, user]);

  const fullPlanText = (res as AIMessage).content as string;
  const todos = parseTodosFromPlan(fullPlanText);

  return {
    // 1. 保存规划结果，方便 agent 作为上下文参考
    messages: [...state.messages, res],

    // 2. 保存完整项目规划文本（技术栈 + 结构 + todo）
    codeContext: fullPlanText,

    // 3. 初始化 ToDo 列表
    todos,
    currentTodoIndex: 0,

    // 4. 可以顺便设置一个笼统的当前任务描述
    currentTask: "根据项目规划逐条完成开发 ToDo 列表中的任务",
  };
}
