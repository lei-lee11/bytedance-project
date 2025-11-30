/**
 * Nodes implementation.
 * Prompts/templates are centralized in `src/agent/prompt.ts`.
 * Keep prompts in that file and call the builder functions from nodes.
 */
import {
  SystemMessage,
  RemoveMessage,
  HumanMessage,
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
import { tools } from "../utils/tools/index.ts";
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
  let { messages } = state;
  const { summary } = state;
  if (summary) {
    const systemMessage = new SystemMessage({
      content: `Summary of conversation earlier: ${summary}`,
    });
    messages = [systemMessage, ...messages];
  }
  const response = await modelWithTools.invoke(messages);
  return { messages: [...messages, response] };
};
export const humanReviewNode = async (_state: AgentState) => {
  // 这里可以处理人工的输入。
  // 比如：如果人工在这个阶段修改了 State（例如取消了 tool_calls），可以在这里处理。
  // 简单起见，这里只是一个传递节点。
  console.log("--- 人工已审批，继续执行 ---");
  return {};
};

