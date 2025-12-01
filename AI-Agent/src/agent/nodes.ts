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


function parseTodos(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-•\d.]+\s*/, "").trim())
    .filter(Boolean);
}

export async function plannerNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastUser = state.messages[state.messages.length - 1];

  const system = new SystemMessage(
    "你是一个项目规划助手，请把用户的整体需求拆分成可执行的开发 ToDo 列表。"
  );
  const user = new HumanMessage(
    `根据下面的需求，输出一个有序的待办列表，每行一个事项：\n\n${lastUser?.content ?? ""}`
  );

  const res = await baseModel.invoke([system, user]);

  const todos = parseTodos((res as AIMessage).content as string);

  return {
    // 把规划结果也写进 messages 里，方便之后 agent 参考
    messages: [...state.messages, res],
    todos,
    currentTodoIndex: 0,
  };
}

