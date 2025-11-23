import { ChatOpenAI } from "@langchain/openai";
export const model = new ChatOpenAI({
  model: "doubao-seed-1-6-flash-250715",
  temperature: 0,
  streaming: false,
  maxRetries: 3,
  timeout: 30000,
  apiKey: " fc223d35-9d61-483a-9d5b-7d319d2b7494",
  configuration: {
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  },
});