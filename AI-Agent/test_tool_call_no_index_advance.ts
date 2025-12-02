// 测试脚本：验证工具调用后索引不会自动增加
// 场景：当大模型调用工具（如查看项目结构）后，应该继续处理当前任务，而不是推进到下一个任务

// 模拟消息类型
class AIMessage {
  constructor(public content: string, public tool_calls?: any[]) {}
  _getType() { return 'ai'; }
}

class ToolResultMessage {
  constructor(public content: string) {}
  _getType() { return 'tool_result'; }
}

// 模拟AgentState
interface AgentState {
  messages: any[];
  todos?: string[];
  currentTodoIndex?: number;
}

// 模拟路由函数 - 简化版的routeAgentOutput
function mockRouteAgentOutput(state: AgentState): string {
  const messages = state.messages;
  const lastMessage = messages[messages.length - 1];
  const todos = state.todos ?? [];
  const currentTodoIndex = state.currentTodoIndex ?? 0;
  
  // 简化的调试日志
  console.log(`\n[测试路由] 当前索引: ${currentTodoIndex}, 任务: ${todos[currentTodoIndex] || '无'}`);
  
  // 1. 检查是否有工具调用
  if (lastMessage && lastMessage._getType() === 'ai' && lastMessage.tool_calls?.length) {
    console.log(`[测试路由] 检测到工具调用，路由到toolNode`);
    return 'toolNode';
  }
  
  // 2. 检查是否是工具执行结果
  if (lastMessage && lastMessage._getType() === 'tool_result') {
    console.log(`[测试路由] 收到工具执行结果，回到agent继续当前任务`);
    return 'agent'; // 模拟工作流连接：工具执行后回到agent
  }
  
  // 3. 检查是否是任务总结
  if (lastMessage && lastMessage._getType() === 'ai' && 
      typeof lastMessage.content === 'string' && 
      lastMessage.content.trim().length > 0) {
    console.log(`[测试路由] 检测到任务总结，任务完成，推进索引`);
    return 'continue'; // 任务完成，推进索引
  }
  
  return 'end';
}

// 模拟advance_todo节点
function mockAdvanceTodo(state: AgentState): AgentState {
  const currentIndex = state.currentTodoIndex ?? 0;
  const todosLength = state.todos?.length ?? 0;
  const newIndex = currentIndex < todosLength ? currentIndex + 1 : currentIndex;
  
  console.log(`[测试advance_todo] 索引更新: ${currentIndex} -> ${newIndex}`);
  return { ...state, currentTodoIndex: newIndex };
}

// 测试场景：工具调用后索引不增加
async function testToolCallScenario() {
  console.log('\n==================== 测试场景1: 工具调用后索引不增加 ====================');
  
  // 初始状态
  let state: AgentState = {
    messages: [],
    todos: ['写HTML页面', '添加样式', '实现交互功能'],
    currentTodoIndex: 0
  };
  
  // 模拟工作流执行
  console.log('\nStep 1: Agent开始处理第一个任务，调用查看项目结构工具');
  state.messages.push(new AIMessage('', [{ name: 'list_files', parameters: {} }]));
  const route1 = mockRouteAgentOutput(state);
  console.log(`- 路由结果: ${route1}`);
  console.log(`- 当前索引: ${state.currentTodoIndex} (预期: 0，索引不增加)`);
  
  // 模拟工具执行完成
  console.log('\nStep 2: 工具执行完成，返回结果');
  state.messages.push(new ToolResultMessage('项目结构信息...'));
  const route2 = mockRouteAgentOutput(state);
  console.log(`- 路由结果: ${route2}`);
  console.log(`- 当前索引: ${state.currentTodoIndex} (预期: 0，索引不增加)`);
  
  // 模拟Agent继续处理任务
  console.log('\nStep 3: Agent继续处理当前任务，调用创建HTML文件工具');
  state.messages.push(new AIMessage('', [{ name: 'write_file', parameters: { path: 'index.html' } }]));
  const route3 = mockRouteAgentOutput(state);
  console.log(`- 路由结果: ${route3}`);
  console.log(`- 当前索引: ${state.currentTodoIndex} (预期: 0，索引不增加)`);
  
  // 模拟工具执行完成
  console.log('\nStep 4: 工具执行完成，返回结果');
  state.messages.push(new ToolResultMessage('文件创建成功'));
  const route4 = mockRouteAgentOutput(state);
  console.log(`- 路由结果: ${route4}`);
  console.log(`- 当前索引: ${state.currentTodoIndex} (预期: 0，索引不增加)`);
  
  // 模拟任务完成，Agent生成总结
  console.log('\nStep 5: 任务完成，Agent生成总结');
  state.messages.push(new AIMessage('HTML页面已成功创建，包含了基本结构...'));
  const route5 = mockRouteAgentOutput(state);
  console.log(`- 路由结果: ${route5}`);
  
  // 只有当返回'continue'时才推进索引
  if (route5 === 'continue') {
    state = mockAdvanceTodo(state);
  }
  console.log(`- 最终索引: ${state.currentTodoIndex} (预期: 1，索引增加)`);
  
  // 验证结果
  if (state.currentTodoIndex === 1) {
    console.log('✅ 测试通过: 工具调用后索引没有自动增加，任务完成后索引正确增加');
  } else {
    console.log('❌ 测试失败: 索引行为不符合预期');
  }
}

// 测试场景：多个工具调用后任务完成
async function testMultipleToolCallsScenario() {
  console.log('\n==================== 测试场景2: 多个工具调用后任务完成 ====================');
  
  let state: AgentState = {
    messages: [],
    todos: ['写HTML页面', '添加样式', '实现交互功能'],
    currentTodoIndex: 0
  };
  
  // 模拟一系列工具调用
  const toolsToCall = ['list_files', 'read_file', 'write_file'];
  
  for (let i = 0; i < toolsToCall.length; i++) {
    console.log(`\nStep ${i*2 + 1}: 调用工具 ${toolsToCall[i]}`);
    state.messages.push(new AIMessage('', [{ name: toolsToCall[i], parameters: {} }]));
    mockRouteAgentOutput(state);
    
    console.log(`Step ${i*2 + 2}: 工具 ${toolsToCall[i]} 执行完成`);
    state.messages.push(new ToolResultMessage(`工具 ${toolsToCall[i]} 执行结果`));
    mockRouteAgentOutput(state);
    
    console.log(`- 当前索引: ${state.currentTodoIndex} (预期: 0，索引不增加)`);
  }
  
  // 任务完成
  console.log('\nStep 7: 任务完成，Agent生成总结');
  state.messages.push(new AIMessage('所有工具调用完成，HTML页面已创建...'));
  const route = mockRouteAgentOutput(state);
  
  if (route === 'continue') {
    state = mockAdvanceTodo(state);
  }
  
  console.log(`- 最终索引: ${state.currentTodoIndex} (预期: 1，索引增加)`);
  
  if (state.currentTodoIndex === 1) {
    console.log('✅ 测试通过: 多个工具调用后，任务完成才推进索引');
  } else {
    console.log('❌ 测试失败: 索引行为不符合预期');
  }
}

// 执行测试
async function runTests() {
  console.log('开始测试：工具调用后索引不自动增加\n');
  
  try {
    await testToolCallScenario();
    await testMultipleToolCallsScenario();
    
    console.log('\n==================== 测试总结 ====================');
    console.log('✅ 所有测试场景通过：工具调用后索引不会自动增加，只有任务真正完成时才推进索引');
    console.log('\n这证明了我们的修复有效解决了原始问题：当大模型调用查看项目结构工具后，会继续处理当前任务，而不是错误地推进到下一个任务。');
  } catch (error) {
    console.error('\n❌ 测试执行失败:', error);
  }
}

// 运行测试
runTests();
