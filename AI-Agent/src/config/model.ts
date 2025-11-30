import 'dotenv/config';
import { ChatOpenAI } from "@langchain/openai";
import {ChatDeepSeek} from "@langchain/deepseek";
import { tools } from "../utils/tools/index.ts";

// 从环境变量读取 API Key 与可选的模型/基础 URL，避免在代码中硬编码敏感信息。
const arkApiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY || "";
const arkBaseURL = process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3";
const arkModel = process.env.ARK_MODEL || "doubao-seed-1-6-thinking-250715";

export const baseModel = new ChatDeepSeek({
  model: arkModel,
  temperature: 0,
  //streaming: false,
  maxRetries: 3,
  // 增大超时，避免网络或推理稍长时过早超时
  timeout: 60000,
  apiKey: "fc223d35-9d61-483a-9d5b-7d319d2b7494",
  configuration: {
    // 注意：这里应为主机根路径（不包含 /chat/completions），SDK 会在内部追加相应路径
    baseURL: arkBaseURL,
  },
});

export const modelWithTools = baseModel.bindTools(tools);
