import { StateGraph, START, END } from "@langchain/langgraph";
import { StateAnnotation, AgentState } from "./state.js";
import { checkpointer } from "../config/checkpointer.js";
import { parseUserInput, generateCode, summarizeConversation, reviewCode } from "./nodes.js";

const routingFunction = (state: AgentState) => {
  return state.reviewResult === "pass" ? "end" : "regenerate";
};
 const shouldContinue = (state: AgentState) => {
  const messages = state.messages;
  // If there are more than six messages, then we summarize the conversation
  if (messages.length > 6) {
    return "summarize_conversation";
  }
  // Otherwise we can just end
  return "no_summarize";
};
// 创建图实例
const workflow = new StateGraph(StateAnnotation)
  .addNode("summarize", summarizeConversation)
  .addNode("parse", parseUserInput)
  .addNode("generate", generateCode)
  .addNode("review", reviewCode)
  .addEdge(START, "parse")
  .addConditionalEdges("parse", shouldContinue, {
    summarize_conversation: "summarize",
    no_summarize: "generate",
  })
  .addEdge("summarize", "generate")
  .addEdge("generate", "review")
  .addConditionalEdges("review", routingFunction, {
    regenerate: "generate",
    end: END,
  });

export const graph = workflow.compile({ checkpointer });
