import { graph } from './src/agent/graph.js';
import { AgentState } from './src/agent/state.js';
import { v4 as uuidv4 } from 'uuid';

async function testWorkflow() {
  console.log('测试完整工作流程...');
  try {
    // 创建一个简单的测试状态
    const initialState: Partial<AgentState> = {
      messages: [
        { role: 'human', content: '列出当前目录下的文件' }
      ],
      projectRoot: process.cwd()
    };

    // 创建配置并添加必需的thread_id
    const config = {
      configurable: {
        thread_id: uuidv4()
      }
    };

    // 执行工作流
    const result = await graph.invoke(initialState, config);
    console.log('工作流执行成功！');
    console.log('最终状态摘要:', {
      messages: result.messages?.length,
      todos: result.todos?.length
    });
  } catch (error) {
    console.error('工作流测试失败:', error);
  }
}

testWorkflow();
