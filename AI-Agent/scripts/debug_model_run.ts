import { buildCodeWithTestPlanPrompt } from '../src/agent/prompt.ts';
import { baseModel } from '../src/config/model.ts';

async function main() {
  const prompt = buildCodeWithTestPlanPrompt({
    currentTask: '实现一个函数，接受一个整数数组和目标值，返回数组中两数之和的索引（两数之和问题）。',
    programmingLanguage: 'TypeScript',
    codeContext: '',
  });

  console.log('=== Debug model run ===');
  console.log('Timestamp (start):', new Date().toISOString());
  console.log('Prompt preview (first 600 chars):\n', prompt.slice(0, 600));

  try {
    const start = Date.now();
    const response = await baseModel.invoke([ { role: 'system', content: prompt } as any ]);
    const duration = Date.now() - start;

    console.log('\n--- Response received ---');
    console.log('Timestamp (end):', new Date().toISOString());
    console.log('Duration (ms):', duration);
    // 尝试打印 response.content（通常是字符串或消息对象的文本字段）
    console.log('\n--- response.content (full) ---');
    try {
      const content = (response as any).content ?? response;
      if (typeof content === 'string') {
        console.log(content);
      } else {
        // 尝试 JSON 序列化复杂对象
        console.log(JSON.stringify(content, null, 2));
      }
    } catch (e) {
      console.log('无法序列化 response.content，打印原始 response：', String(response));
    }

    // Try to print structured fields if available
    if ((response as any).tool_calls) {
      console.log('\nTool calls:', JSON.stringify((response as any).tool_calls, null, 2));
    }
    if ((response as any).usage) {
      console.log('\nUsage:', JSON.stringify((response as any).usage, null, 2));
    }

  } catch (err) {
    console.error('Model call error:', err);
  }
}

main();
