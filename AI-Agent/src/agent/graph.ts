import { StateGraph, START, END } from "@langchain/langgraph";
import { StateAnnotation } from "./state.ts";
import { initializeCheckpointer } from "../config/checkpointer.js";
import {
  initializeNode,
  intentClassifierNode,
  plannerNode,
  executorNode,
  chatNode,
  toolsNode,
  reviewNode,
} from "./nodes.ts";
import { MemorySaver } from "@langchain/langgraph";
/**
 * 构建 Graph
 */
function buildGraph() {
  console.log("[graph] 构建 Graph");
  const workflow = new StateGraph(StateAnnotation)
    // 添加节点，指定可能的出口
    .addNode("initialize", initializeNode, {
      ends: ["classifier"],
    })
    .addNode("classifier", intentClassifierNode, {
      ends: ["planner", "chat"],
    })
    .addNode("chat", chatNode, {
      ends: [END],
    })
    .addNode("planner", plannerNode, {
      ends: ["executor"],
    })
    .addNode("executor", executorNode, {
      ends: ["executor", "tools", "review", END],
    })
    .addNode("tools", toolsNode, {
      ends: ["executor"],
    })
    .addNode("review", reviewNode, {
      ends: ["tools"],
    })

    // 只需要定义入口边
    .addEdge(START, "initialize");

  console.log("[graph] Graph 构建完成");
  return workflow;
}

/**
 * 初始化并编译 Graph
 * @param options - 配置选项
 * @param options.demoMode - 演示模式,跳过人工审批
 * @param options.recursionLimit - 递归限制，默认100
 */
export let graph: any;

export async function initializeGraph(
  options: { demoMode?: boolean; recursionLimit?: number } = {},
) {
  const { demoMode = false, recursionLimit = 100 } = options;

  // 如果已有graph且模式匹配,直接返回
  if (graph && graph._demoMode === demoMode) {
    console.log(`[graph] 使用已编译的 Graph (演示模式: ${demoMode})`);
    return graph;
  }

  console.log(
    `[graph] 初始化 Graph (演示模式: ${demoMode}, 递归限制: ${recursionLimit})`,
  );

  const checkpointer = await initializeCheckpointer();
  const workflow = buildGraph();

  // 根据模式决定是否启用人工审批
  const compileOptions: any = {
    //checkpointer: checkpointer,
    checkpointer: new MemorySaver(),
  };

  if (!demoMode) {
    // 生产模式: 启用人工审批
    compileOptions.interruptBefore = ["review"];
    console.log("[graph] 启用人工审批机制");
  } else {
    // 演示模式: 跳过人工审批
    console.log("[graph] 演示模式: 跳过人工审批");
  }

  graph = workflow.compile(compileOptions);
  //graph._demoMode = demoMode; // 标记当前模式
  graph._recursionLimit = recursionLimit; // 保存递归限制

  console.log("[graph] Graph 编译完成");
  return graph;
}

/**
 * 获取推荐的递归限制
 * 根据任务数量动态计算
 */
export function getRecommendedRecursionLimit(taskCount: number): number {
  // 每个任务大约需要 5-10 次迭代（调用模型 + 工具执行）
  // 加上初始化和规划阶段的开销
  const baseLimit = 20; // 初始化和规划
  const perTaskLimit = 15; // 每个任务的迭代次数
  return baseLimit + taskCount * perTaskLimit;
}
