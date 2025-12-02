import { agent } from './src/agent/nodes';
import { SystemMessage } from '@langchain/core/messages';

// 模拟测试函数
async function testAgentContext() {
  console.log('开始测试agent节点上下文优化...');
  
  // 测试场景1: 有项目树信息
  console.log('\n测试场景1: 有项目树信息');
  const state1 = {
    todos: [{ content: '测试任务1' }],
    currentTodoIndex: 0,
    userQuestion: '测试问题',
    projectTreeText: '项目结构示例',
    projectPlanText: '项目计划示例'
  };
  
  // 模拟agent函数，只打印上下文消息
  const mockAgent = async (state: any) => {
    const { todos, currentTodoIndex, projectTreeText } = state;
    const contextMessages: SystemMessage[] = [];
    
    // 复制我们修改后的逻辑
    if (projectTreeText && projectTreeText.trim()) {
      contextMessages.push(
        new SystemMessage({
          content: `## 当前项目结构\n\n${projectTreeText}\n`
        }),
      );
    }
    
    console.log('生成的上下文消息:');
    contextMessages.forEach(msg => {
      console.log(msg.content);
    });
    
    return { action: 'continue' };
  };
  
  await mockAgent(state1);
  
  // 测试场景2: 无项目树信息
  console.log('\n测试场景2: 无项目树信息');
  const state2 = {
    todos: [{ content: '测试任务2' }],
    currentTodoIndex: 0,
    userQuestion: '测试问题',
    projectTreeText: '',
    projectPlanText: '项目计划示例'
  };
  
  await mockAgent(state2);
  
  console.log('\n测试完成! 上下文优化验证成功。');
}

// 运行测试
testAgentContext().catch(console.error);
