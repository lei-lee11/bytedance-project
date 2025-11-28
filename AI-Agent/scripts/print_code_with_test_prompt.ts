import { buildCodeWithTestPlanPrompt } from '../src/agent/prompt.ts';

async function main() {
  const prompt = buildCodeWithTestPlanPrompt({
    currentTask: '实现一个函数，接受一个整数数组和目标值，返回数组中两数之和的索引（两数之和问题）。',
    programmingLanguage: 'TypeScript',
    codeContext: ''
  });

  console.log('--- buildCodeWithTestPlanPrompt 输出开始 ---\n');
  console.log(prompt);
  console.log('\n--- buildCodeWithTestPlanPrompt 输出结束 ---');
}

main().catch((e) => { console.error(e); process.exit(1); });
