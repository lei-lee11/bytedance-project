import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export type AgentState = typeof StateAnnotation.State;
export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  summary: Annotation<string>(),
  currentTask: Annotation<string>,//当前要执行的任务
  codeContext: Annotation<string>, //相关代码上下文
  programmingLanguage: Annotation<string>, // 编程语言
  retryCount: Annotation<number>({//重试次数
    reducer: (prev, next) => prev + next, 
    default: () => 0,
  }), 
  reviewResult: Annotation<string>//代码审核结果
});
