import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export type AgentState = typeof StateAnnotation.State;
export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  currentTask: Annotation<string>,
  codeContext: Annotation<string>, //相关代码上下文
  programmingLanguage: Annotation<string>, // 编程语言
});
