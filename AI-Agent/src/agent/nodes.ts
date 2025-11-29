import {
  SystemMessage,
  RemoveMessage,
  HumanMessage,
} from "@langchain/core/messages";
import { AgentState } from "./state.ts";
import { baseModel, modelWithTools } from "../config/model.ts";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tools } from "../utils/tools/index.ts";

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
