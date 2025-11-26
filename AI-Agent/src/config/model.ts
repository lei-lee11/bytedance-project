import { ChatOpenAI } from "@langchain/openai";
import { tools } from "../utils/tools/index.ts";
export const baseModel = new ChatOpenAI({
  model: "doubao-seed-1-6-251015",
  temperature: 0,
  streaming: false,
  maxRetries: 3,
  timeout: 30000,
  apiKey: " fc223d35-9d61-483a-9d5b-7d319d2b7494",
  configuration: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  },
});
export const modelWithTools = baseModel.bindTools(tools);
