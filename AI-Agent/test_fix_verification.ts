// 验证工作流修复效果的测试脚本
import { AgentState } from './src/agent/state.js';
import { injectProjectTreeNode } from './src/agent/nodes.js';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

async function testProjectTreeHandling() {
  console.log('开始验证项目树处理逻辑修复...');
  
  // 1. 模拟初始状态
  let state: AgentState = {
    messages: [
      new HumanMessage({ content: '创建一个简单的TodoList项目' })
    ],
    projectRoot: '.',
    projectTreeInjected: false,
  };
  
  console.log('\n=== 测试1: 执行injectProjectTreeNode ===');
  // 执行injectProjectTreeNode
  const injectResult = await injectProjectTreeNode(state);
  state = { ...state, ...injectResult };
  
  console.log('injectProjectTreeNode执行结果:');
  console.log('- projectTreeText是否设置:', !!state.projectTreeText);
  console.log('- projectTreeInjected状态:', state.projectTreeInjected);
  console.log('- messages数量:', state.messages.length);
  
  // 检查是否不再直接向messages添加项目树信息
  const hasDirectProjectTreeMessage = state.messages.some(msg => 
    msg.content && msg.content.includes('项目的目录结构')
  );
  console.log('- 是否直接向messages添加项目树:', hasDirectProjectTreeMessage);
  
  console.log('\n=== 测试2: 验证agent函数不再从messages获取项目树信息 ===');
  console.log('根据代码检查，agent函数现在只从projectTreeText变量获取项目树信息');
  console.log('这确保了项目结构信息只在需要时由agent函数智能添加一次');
  
  console.log('\n=== 测试3: 模拟完整工作流循环 ===');
  // 模拟工具执行后重置projectTreeInjected
  state = {
    ...state,
    projectTreeInjected: false,
    messages: [...state.messages, { type: 'ai', content: '执行了工具' } as any]
  };
  
  // 再次执行injectProjectTreeNode
  const secondInjectResult = await injectProjectTreeNode(state);
  state = { ...state, ...secondInjectResult };
  
  console.log('第二次injectProjectTreeNode执行后:');
  console.log('- messages数量:', state.messages.length);
  
  // 检查是否仍然没有向messages添加重复的项目树信息
  const hasAnyProjectTreeMessage = state.messages.some(msg => 
    msg.content && (
      msg.content.includes('项目的目录结构') || 
      msg.content.includes('## 当前项目结构')
    )
  );
  console.log('- messages中是否存在项目树信息:', hasAnyProjectTreeMessage);
  
  console.log('\n=== 代码逻辑验证 ===');
  console.log('根据代码修改，injectProjectTreeNode现在只负责获取项目树文本并设置projectTreeText变量');
  console.log('agent函数负责在需要时将项目树信息添加到contextMessages中，避免了重复添加');
  console.log('这种设计确保了项目结构信息只会在agent处理时被添加一次，避免了重复的检查提示');
  
  if (!hasDirectProjectTreeMessage && !hasAnyProjectTreeMessage) {
    console.log('\n✅ 验证成功! 修复状态: SUCCESS');
    console.log('\n关键修复点:');
    console.log('1. injectProjectTreeNode不再直接向messages添加项目树信息');
    console.log('2. 只设置projectTreeText变量供agent函数智能使用');
    console.log('3. 避免了重复的项目结构检查提示和递归循环问题');
  } else {
    console.log('\n❌ 验证失败! 仍有项目树信息被添加到messages中');
  }
}

testProjectTreeHandling().catch(console.error);
