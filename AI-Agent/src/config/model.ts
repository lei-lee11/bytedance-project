// import { ChatOpenAI } from "@langchain/openai";
// import { tools } from "../utils/tools/index.ts";
// export const baseModel = new ChatOpenAI({
//   model: "doubao-seed-1-6-251015",
import { tools } from "../utils/tools/index.ts";
import { ChatDeepSeek } from "@langchain/deepseek";
export const baseModel = new ChatDeepSeek({
  model: "doubao-seed-1-6-thinking-250715",
  temperature: 0,
  //streaming: false,
  maxRetries: 3,
  timeout: 30000,
  apiKey: " 61aef3ae-9f04-4ba7-9bd8-e7923d8807c9",
  configuration: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  },
});

export const modelWithTools = baseModel.bindTools(tools);
