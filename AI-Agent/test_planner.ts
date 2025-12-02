import { HumanMessage } from "@langchain/core/messages";
import { plannerNode } from "./src/agent/nodes.js";
import { AgentState, createAgentState } from "./src/agent/state.js";

async function testPlannerNode() {
  console.log('开始测试planner节点...');
  
  // 创建初始状态
  const initialState: AgentState = createAgentState({
    messages: [
      new HumanMessage({
        content:
          '请帮我实现一个简单的待办事项应用，包含添加、删除和查看待办事项的功能。',
      }),
    ],
    projectRoot: process.cwd(),
  });
  
  try {
    // 调用planner节点
    const result = await plannerNode(initialState);
    
    // 验证结果
    console.log('\n测试结果:');
    console.log('1. 是否返回了待办事项列表:', Array.isArray(result.todos) && result.todos.length > 0);
    console.log('2. 当前待办事项索引:', result.currentTodoIndex);
    console.log('3. 消息数量是否增加:', (result.messages || []).length > initialState.messages.length);
    
    if (result.todos && result.todos.length > 0) {
      console.log('\n生成的待办事项列表:');
      result.todos.forEach((todo: string, index: number) => {
        console.log(`${index + 1}. ${todo}`);
      });
    }
    
    console.log('\nPlanner节点测试成功完成!');
  } catch (error) {
    console.error('\nPlanner节点测试失败:', error);
  }
}

// 运行测试
testPlannerNode();
