import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { RunnableConfig } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import {
  SystemMessage,
  AIMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { StateAnnotation, AgentState } from "./state.js";
import { z } from "zod";
import * as dotenv from "dotenv";

// 加载环境变量
dotenv.config();

const model = new ChatOpenAI({
  model: "doubao-seed-1-6-flash-250715",
  temperature: 0,
  streaming: false,
  maxRetries: 3,
  timeout: 30000,
  configuration: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    apiKey: process.env.ARK_API_KEY,
  },
});
// // 提示词模板函数
// const promptTemplate = (config: RunnableConfig) => {
//   const user_name = config?.configurable?.user_name || "user";
//   const system_prompt = `你是一个智能助手，用户的名字是${user_name}`;
//   return [new SystemMessage({ content: system_prompt })];
// };

// 工具定义
// const getWeather = tool(({ city }) => `It's always sunny in ${city}!`, {
//   name: "get_weather",
//   description: "Get the weather for a given city",
//   schema: z.object({
//     city: z.string(),
//   }),
// });

// 创建工具节点
// const tools = [getWeather];
// const toolNode = new ToolNode(tools);

// //解析用户输入
// const parseUserInput = async (state: AgentState) => {
//   const lastMessage = state.messages[state.messages.length - 1];
//   if (!lastMessage || lastMessage.type !== "human") {
//     throw new Error("No human message found to parse");
//   }
//   const userInput = lastMessage.content as string;
//   const parsePrompt = [
//     new SystemMessage({
//       content: `你是一个任务解析器。请从用户的自然语言请求中提取以下信息：
// - 编程任务描述（currentTask）
// - 使用的编程语言（programmingLanguage）
// - 相关代码上下文（codeContext，若无则为空字符串）
// 请以严格的 JSON 格式输出，不要包含任何其他内容。例如：
// {"currentTask": "...", "programmingLanguage": "...", "codeContext": "..."}`,
//     }),
//     new HumanMessage({ content: userInput }),
//   ];
//   const response = await model.invoke(parsePrompt);
//   const parsed = JSON.parse(response.content as string);
//   return {
//     // currentTask: parsed.currentTask || "",
//     // programmingLanguage: parsed.programmingLanguage || "",
//     // codeContext: parsed.codeContext || "",
//      currentTask: parsed.currentTask || state.currentTask,
//     programmingLanguage: parsed.programmingLanguage || state.programmingLanguage,
//     codeContext: parsed.codeContext || state.codeContext,
//   };
// };
const parseUserInput = async (state: AgentState) => {
  // 使用LLM总结对话历史，提取用户意图
  const parsePrompt = [
    new SystemMessage({
      content: `你是一个任务解析器。请根据完整的对话上下文，提取当前用户的编程意图。当前对话历史：
${state.messages.map(
    (msg) => `[${msg.type === "human" ? "User" : "Assistant"}]: ${msg.content}`,
  ).join("\n")}

请输出以下字段（即使与之前相同也需显式写出）：
- currentTask: 当前要实现的功能（必须明确，不可省略）
- programmingLanguage: 目标编程语言
- codeContext: 相关代码片段（若无则为空字符串）
输出严格 JSON，不要任何其他内容。`,
    }),
    // 注意：不再单独加 HumanMessage，因为历史已包含
  ];
  const response = await model.invoke(parsePrompt);
  const parsed = JSON.parse(response.content as string);
  return {
    currentTask: parsed.currentTask?.trim() || "",
    programmingLanguage: parsed.programmingLanguage?.trim() || "",
    codeContext: parsed.codeContext?.trim() || "",
  };
};
// Agent 节点逻辑
const generateCode = async (state: AgentState) => {
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

  const response = await model.invoke(codePrompt);
  return { messages: [...messages, response] }; //reduce的原理
};
const CodeReviewSchema = z.object({
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
const MAX_RETRIES = 5;
const reviewCode = async (state: AgentState) => {
  const { messages, currentTask, programmingLanguage, retryCount } = state;

  const lastAIMessage = [...messages]
    .reverse()
    .find((msg) => msg.type === "ai");
  if (!lastAIMessage) {
    throw new Error("No AI-generated code found for review");
  }
  const generatedCode = lastAIMessage.content as string;
  const structuredModel = model.withStructuredOutput(CodeReviewSchema);
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
const routingFunction = (state: AgentState) => {
  return state.reviewResult === "pass" ? "end" : "regenerate";
};
// 创建图实例
const workflow = new StateGraph(StateAnnotation)
  .addNode("parse", parseUserInput)
  .addNode("generate", generateCode)
  .addNode("review", reviewCode)
  .addEdge(START, "parse")
  .addEdge("parse", "generate")
  .addEdge("generate", "review")
  .addConditionalEdges("review", routingFunction, {
    end: END,
    regenerate: "generate",
  });
export const graph = workflow.compile();
