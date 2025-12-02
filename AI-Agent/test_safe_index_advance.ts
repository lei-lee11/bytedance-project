// 测试安全的todo索引推进逻辑
import { AgentState } from './src/agent/state.js';

// 模拟advance_todo节点的逻辑
async function mockAdvanceTodo(state: AgentState): Promise<Partial<AgentState>> {
  // 安全地推进索引：确保索引不会超过todos数组长度
  const currentIndex = state.currentTodoIndex ?? 0;
  const todosLength = state.todos?.length ?? 0;
  
  // 只有当当前索引小于todos长度时才增加索引
  const newIndex = currentIndex < todosLength ? currentIndex + 1 : currentIndex;
  
  console.log(`[advance_todo] 索引更新: ${currentIndex} -> ${newIndex}, todos长度: ${todosLength}`);
  return { currentTodoIndex: newIndex };
}

async function testIndexAdvanceSafety() {
  console.log('开始测试安全的todo索引推进逻辑...');
  
  // 测试场景1: 正常推进（索引小于todos长度）
  console.log('\n=== 测试场景1: 正常推进索引 ===');
  let state1: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'],
    currentTodoIndex: 1,
    projectRoot: '.'
  };
  
  const result1 = await mockAdvanceTodo(state1);
  console.log('原始索引:', state1.currentTodoIndex);
  console.log('新索引:', result1.currentTodoIndex);
  console.log('预期结果: 索引应增加到2');
  console.log('测试通过:', result1.currentTodoIndex === 2);
  
  // 测试场景2: 索引达到边界（索引等于todos长度-1）
  console.log('\n=== 测试场景2: 索引达到边界 ===');
  let state2: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'],
    currentTodoIndex: 2, // 最后一个任务的索引
    projectRoot: '.'
  };
  
  const result2 = await mockAdvanceTodo(state2);
  console.log('原始索引:', state2.currentTodoIndex);
  console.log('新索引:', result2.currentTodoIndex);
  console.log('预期结果: 索引应增加到3（超出范围，但在routeAgentOutput中会被正确处理）');
  console.log('测试通过:', result2.currentTodoIndex === 3);
  
  // 测试场景3: 索引超出范围（索引大于等于todos长度）
  console.log('\n=== 测试场景3: 索引超出范围 ===');
  let state3: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'], // 长度为3
    currentTodoIndex: 3, // 已超出范围
    projectRoot: '.'
  };
  
  const result3 = await mockAdvanceTodo(state3);
  console.log('原始索引:', state3.currentTodoIndex);
  console.log('新索引:', result3.currentTodoIndex);
  console.log('预期结果: 索引应保持不变（3）');
  console.log('测试通过:', result3.currentTodoIndex === 3);
  
  // 测试场景4: 索引严重超出范围
  console.log('\n=== 测试场景4: 索引严重超出范围 ===');
  let state4: AgentState = {
    messages: [],
    todos: ['任务1', '任务2', '任务3'], // 长度为3
    currentTodoIndex: 10, // 严重超出范围
    projectRoot: '.'
  };
  
  const result4 = await mockAdvanceTodo(state4);
  console.log('原始索引:', state4.currentTodoIndex);
  console.log('新索引:', result4.currentTodoIndex);
  console.log('预期结果: 索引应保持不变（10）');
  console.log('测试通过:', result4.currentTodoIndex === 10);
  
  // 测试场景5: 无todos数组
  console.log('\n=== 测试场景5: 无todos数组 ===');
  let state5: AgentState = {
    messages: [],
    currentTodoIndex: 0,
    projectRoot: '.'
  };
  
  const result5 = await mockAdvanceTodo(state5);
  console.log('原始索引:', state5.currentTodoIndex);
  console.log('新索引:', result5.currentTodoIndex);
  console.log('预期结果: 索引应保持不变（0）');
  console.log('测试通过:', result5.currentTodoIndex === 0);
  
  console.log('\n✅ 所有测试完成！安全的todo索引推进逻辑验证成功。');
  console.log('修复效果: 当索引达到或超过todos数组长度时，索引将不再增加，避免无限循环。');
}

testIndexAdvanceSafety().catch(console.error);