import {
  SystemMessage,
  RemoveMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { AgentState } from "./state.js";
import { baseModel, modelWithTools } from "../config/model.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";
// import { Command } from "@langchain/langgraph";
import { z } from "zod";
import { tools } from "../utils/tools/index.ts";
import { randomUUID } from "crypto";
const MAX_RETRIES = 5;
import { project_tree } from "../utils/tools/project_tree.ts";

//解析用户输入，提取用户意图
export const parseUserInput = async (state: AgentState) => {
  // 使用LLM总结对话历史，提取用户意图
  const parsePrompt = [
    new SystemMessage({
      content: `你是一个任务解析器。请根据完整的对话上下文，提取当前用户的编程意图。当前对话历史：
${state.messages
  .map(
    (msg) => `[${msg.type === "human" ? "User" : "Assistant"}]: ${msg.content}`,
  )
  .join("\n")}

请输出以下字段（即使与之前相同也需显式写出）：
- currentTask: 当前要实现的功能（必须明确，不可省略）
- programmingLanguage: 目标编程语言
- codeContext: 相关代码片段（若无则为空字符串）
输出严格 JSON，不要任何其他内容。`,
    }),
    // 注意：不再单独加 HumanMessage，因为历史已包含
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

  // 创建摘要提示词
  let summaryMessage: string;
  if (summary) {
    // 已存在摘要
    summaryMessage =
      `这是截至目前的对话摘要: ${summary}\n\n` +
      "请根据以上新消息扩展此摘要，重点关注编程任务和代码内容:";
  } else {
    summaryMessage =
      "请为以上对话创建一个摘要，需包含:\n" +
      "1. 主要编程任务和目标\n" +
      "2. 使用的编程语言和技术栈\n" +
      "3. 关键代码片段或解决方案\n" +
      "4. 重要决策和结论\n" +
      "请保持摘要简洁但信息完整:";
  }

  // 将提示词添加到对话历史中
  const messages = [
    ...state.messages,
    new HumanMessage({ content: summaryMessage }),
  ];
  const response = await baseModel.invoke(messages);

  // 删除除最后2条外的所有消息
  const deleteMessages = state.messages
    .slice(0, -2)
    .filter((m) => m.id !== undefined)
    .map((m) => new RemoveMessage({ id: m.id! }));

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

  // 确保 systemMsg 有一个可用于后续删除的唯一 id
  const generatedId = typeof randomUUID === "function" ? randomUUID() : `project-tree-${Date.now()}`;
  try {
    // 某些 Message 实例可能是只读类型，这里通过 unknown -> 指定类型 赋值 id
    (systemMsg as unknown as { id?: string }).id = generatedId;
  } catch {
    // 忽略赋值错误，仍然将 id 返回给 state
  }

  // 如果之前已经有一条项目结构消息，先给它发个删除指令
  const deletes =
    state.projectTreeMessageId
      ? [new RemoveMessage({ id: state.projectTreeMessageId })]
      : [];

  return {
    messages: [
      ...deletes,            // 先删旧的
      systemMsg,             // 再插新的
      ...state.messages,     // 然后是原来的内容
    ],
    projectTreeText: treeText,
    projectTreeMessageId: generatedId,
    projectTreeInjected: true,
  };
};




// 生成代码，根据用户意图和上下文
export const generateCode = async (state: AgentState) => {
  const { messages, currentTask, programmingLanguage, codeContext } = state;

  // 构建专门用于代码生成的提示
  const codePrompt = [
    new SystemMessage({
      content: `你是一个专业的编程助手，专注于生成高质量的${programmingLanguage}代码。
任务描述: ${currentTask}
代码上下文: ${codeContext}
请只返回可执行的代码，不要包含任何解释性文字。`,
    }),
    ...messages,
  ];

  const response = await baseModel.invoke(codePrompt);
  return { messages: [...messages, response] }; //reduce的原理
};
export const CodeReviewSchema = z.object({
  decision: z
    .enum(["pass", "fail"])
    .describe("审查结论：'pass' 表示代码合格，'fail' 表示不合格"),

  reason: z
    .string()
    .optional()
    .describe(
      "仅当 decision 为 'fail' 时填写，说明代码存在的问题（如语法错误、未实现功能、包含解释文字等）",
    ),
});
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
  const reviewPrompt = [
    new SystemMessage({
      content: `你是一个严格的代码审查专家。
请根据以下要求评估用户提供的代码：
- 编程任务：${currentTask}
- 目标语言：${programmingLanguage}
审查标准：
1. 代码是否完整实现了任务？
2. 是否使用了正确的编程语言？
3. 语法是否正确（能否编译/运行）？
4. 是否只包含纯代码？禁止包含任何解释性文字、注释（除非必要）、Markdown 围栏（如 \`\`\`cpp）等非代码内容。
请严格按照指定 JSON 格式输出，不要包含任何额外文本、说明或 Markdown。`,
    }),

    new HumanMessage({
      content: `代码如下：\n\n${generatedCode}`,
    }),
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

