import { startBackgroundProcess, listBackgroundProcesses } from './src/utils/tools/backgroundProcess.js';

async function testToolCall() {
  console.log('测试工具调用机制...');
  try {
    // 测试启动一个简单的后台进程
    const result = await startBackgroundProcess.func({
      command: 'echo',
      args: ['Hello', 'World'],
      description: '测试工具调用'
    });
    console.log('工具调用成功，结果:', result);
    
    // 测试列出后台进程
    const listResult = await listBackgroundProcesses.func({});
    console.log('列出进程结果:', listResult);
    
    console.log('测试完成，工具调用机制正常!');
  } catch (error) {
    console.error('测试失败:', error);
  }
}

testToolCall();
