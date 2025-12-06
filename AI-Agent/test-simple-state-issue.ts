/**
 * 简化测试：验证持续对话中的 State 问题
 * 
 * 核心问题：
 * 当使用相同的 thread_id 进行第二次对话时，工作流没有重新进入 intent_classifier 节点
 */

import { HumanMessage } from "@langchain/core/messages";
import { initializeGraph } from "./src/agent/graph.js";

async function testSimple() {
  console.log("=".repeat(80));
  console.log("🧪 简化测试：持续对话 State 问题");
  console.log("=".repeat(80));

  const graph = await initializeGraph();
  const threadId = `test-simple-${Date.now()}`;

  console.log(`\nThread ID: ${threadId}\n`);

  // 第一次对话
  console.log("📌 第一次对话");
  console.log("-".repeat(80));
  
  const config1 = { configurable: { thread_id: threadId } };
  
  await graph.invoke({
    messages: [new HumanMessage("创建一个 Express 服务器")],
    projectRoot: process.cwd(),
    demoMode: true,
  }, config1);

  const state1 = await graph.getState(config1);
  console.log(`✓ 第一次对话完成`);
  console.log(`  - todos: ${state1.values.todos?.length || 0} 个`);
  console.log(`  - userIntent: ${state1.values.userIntent}`);
  console.log(`  - next节点: ${state1.next?.join(", ") || "无"}`);

  // 等待一下
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 第二次对话
  console.log("\n📌 第二次对话（使用相同的 thread_id）");
  console.log("-".repeat(80));
  
  await graph.invoke({
    messages: [new HumanMessage("现在创建一个 React 项目")],
    projectRoot: process.cwd(),
    demoMode: true,
  }, config1); // 使用相同的 config

  const state2 = await graph.getState(config1);
  console.log(`✓ 第二次对话完成`);
  console.log(`  - todos: ${state2.values.todos?.length || 0} 个`);
  console.log(`  - userIntent: ${state2.values.userIntent}`);
  console.log(`  - next节点: ${state2.next?.join(", ") || "无"}`);

  // 分析
  console.log("\n" + "=".repeat(80));
  console.log("📊 分析结果");
  console.log("=".repeat(80));
  
  const todosChanged = JSON.stringify(state1.values.todos) !== JSON.stringify(state2.values.todos);
  
  console.log(`\n❓ todos 是否改变？ ${todosChanged ? "✅ 是" : "❌ 否"}`);
  console.log(`❓ 是否重新分类意图？ ${state2.values.userIntent === "task" ? "✅ 是" : "❌ 否"}`);
  
  if (!todosChanged) {
    console.log("\n⚠️  问题确认：第二次对话没有生成新的 todos");
    console.log("   原因：工作流没有重新进入 intent_classifier 节点");
    console.log("   而是直接从上次中断的地方继续执行");
  }

  console.log("\n" + "=".repeat(80));
}

testSimple().catch(console.error);
