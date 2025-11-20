// 大模型API调用模块
import { config } from 'dotenv';
config(); // ✅ 100%必须在文件最顶部

//API配置常量
const API_URL = process.env.VOLCENGINE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const MODEL_NAME = process.env.MODEL_ID; // ✅ 严格按curl命令写

export async function callVolcEngine(prompt: string): Promise<string> {
  // 1. 构建请求体（严格按curl格式）
  const requestBody = {
    model: MODEL_NAME,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: prompt }
    ]
  };

  // 2. 发送请求（使用Node.js原生fetch，无需额外安装）
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.VOLCENGINE_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  // 3. 处理响应（只提取content）
  const data = await response.json();
  return data.choices[0].message.content;
}

// 用于后续在types.ts中定义
export interface VolcEngineResponse {
  choices: Array<{ message: { content: string } }>;
}