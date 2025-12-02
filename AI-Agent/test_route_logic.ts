// 简化版的路由逻辑测试脚本
import { AgentState } from './src/agent/state.ts';
import { END } from '@langchain/langgraph';

// 模拟routeAgentOutput函数进行测试
function testRouteAgentOutput() {
  // 测试场景1: 所有todo完成的情况
  const state1: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'],
    currentTodoIndex: 3
  };
  
  // 测试场景2: 还有todo未完成的情况
  const state2: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'],
    currentTodoIndex: 1
  };
  
  // 测试场景3: 没有todo的情况
  const state3: AgentState = {
    messages: []
  };
  
  // 模拟路由决策
  function mockRouteAgentOutput(state: AgentState): string | typeof END {
    console.log(`[测试] 当前状态 - todos长度: ${state.todos?.length || 0}, 当前索引: ${state.currentTodoIndex || 0}`);
    
    const todos = state.todos ?? [];
    const currentTodoIndex = state.currentTodoIndex ?? 0;
    const hasTodos = todos.length > 0;
    const allTodosDone = hasTodos && currentTodoIndex >= todos.length;
    
    if (allTodosDone) {
      console.log(`[测试] 所有todo已完成，返回END`);
      return END;
    }
    
    if (hasTodos && currentTodoIndex < todos.length) {
      console.log(`[测试] 还有todo未完成，返回continue`);
      return "continue";
    }
    
    console.log(`[测试] 没有todo，返回END`);
    return END;
  }
  
  console.log('\n测试场景1: 所有todo完成');
  const result1 = mockRouteAgentOutput(state1);
  console.log(`结果: ${result1 === END ? 'END' : result1}`);
  
  console.log('\n测试场景2: 还有todo未完成');
  const result2 = mockRouteAgentOutput(state2);
  console.log(`结果: ${result2 === END ? 'END' : result2}`);
  
  console.log('\n测试场景3: 没有todo');
  const result3 = mockRouteAgentOutput(state3);
  console.log(`结果: ${result3 === END ? 'END' : result3}`);
  
  console.log('\n路由逻辑测试完成!');
}

// 运行测试
testRouteAgentOutput();
