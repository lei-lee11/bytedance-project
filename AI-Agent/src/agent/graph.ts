import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { RunnableConfig } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { StateAnnotation, AgentState } from "./state.js";
import { z } from "zod";

const model = new ChatOpenAI({
  model: "doubao-seed-code-preview-251028",
  temperature: 0,
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

// 创建图实例
const workflow = new StateGraph(StateAnnotation)
  .addNode("generateCode", generateCode)
  .addEdge(START, "generateCode")
  .addEdge("generateCode", END);
export const graph = workflow.compile();
