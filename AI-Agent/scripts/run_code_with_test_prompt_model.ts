import { buildCodeWithTestPlanPrompt } from '../src/agent/prompt.ts';
import { baseModel } from '../src/config/model.ts';

async function main() {
  const prompt = buildCodeWithTestPlanPrompt({
    currentTask: '实现一个函数，接受一个整数数组和目标值，返回数组中两数之和的索引（两数之和问题）。',
    programmingLanguage: 'TypeScript',
    codeContext: ''
  });

  console.log('--- 发送给模型的提示词开始 ---\n');
  console.log(prompt);
  console.log('\n--- 提示词结束，正在调用模型... ---\n');

  try {
    const response = await baseModel.invoke(prompt);
    console.log('--- 模型回复开始 ---\n');
    console.log(response);
    console.log('\n--- 模型回复结束 ---');
  } catch (err) {
    console.error('调用模型时发生错误：', err);
    process.exitCode = 1;
  }
}

main();
