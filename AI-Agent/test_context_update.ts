// 测试上下文优化效果的脚本
import { AgentState } from './src/agent/state.ts';
import { graph } from './src/agent/graph.ts';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

async function testContextUpdate() {
  console.log('开始测试上下文优化效果...');
  
  // 创建测试目录
  const testDir = path.join(process.cwd(), 'test_context_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir);
  }
  
  // 创建初始文件
  const initialFile = path.join(testDir, 'initial.txt');
  fs.writeFileSync(initialFile, 'Initial content');
  
  try {
    // 1. 第一次运行工作流
    const threadId1 = uuidv4();
    console.log('\n=== 第一轮工作流执行（初始状态）===');
    
    const initialState: Partial<AgentState> = {
      messages: [
        {
          type: 'human',
          content: `列出${testDir}目录下的文件，然后告诉我有哪些文件。`
        }
      ],
      projectRoot: testDir
    };
    
    const result1 = await graph.invoke(initialState, {
      configurable: { thread_id: threadId1 }
    });
    
    console.log('第一轮执行完成，检查输出中是否包含 initial.txt');
    
    // 2. 在目录中添加新文件，模拟文件系统变化
    console.log('\n=== 在目录中添加新文件 new_file.txt ===');
    const newFile = path.join(testDir, 'new_file.txt');
    fs.writeFileSync(newFile, 'New file content');
    
    // 3. 第二轮运行工作流，应该能检测到新文件
    const threadId2 = uuidv4();
    console.log('\n=== 第二轮工作流执行（目录已更新）===');
    
    const secondState: Partial<AgentState> = {
      messages: [
        {
          type: 'human',
          content: `再次列出${testDir}目录下的文件，告诉我现在有哪些文件。`
        }
      ],
      projectRoot: testDir
    };
    
    const result2 = await graph.invoke(secondState, {
      configurable: { thread_id: threadId2 }
    });
    
    console.log('\n第二轮执行完成，检查输出中是否包含 new_file.txt');
    console.log('\n上下文优化测试完成！');
    console.log('如果第二轮输出中包含 new_file.txt，则说明优化生效，每次工具调用后项目目录被正确更新。');
    
  } catch (error) {
    console.error('测试过程中出错:', error);
  } finally {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.readdirSync(testDir).forEach(file => {
        fs.unlinkSync(path.join(testDir, file));
      });
      fs.rmdirSync(testDir);
    }
  }
}

// 运行测试
testContextUpdate();
