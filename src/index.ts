import 'dotenv/config';
import { callVolcEngine } from './tools/volcengine.js';

export async function runPrompt(prompt?: string) {
  const p = prompt ?? process.argv.slice(2).join(' ');
  if (!p) {
    console.log('用法: npx tsx src/index.ts "你的问题"  或  node dist/index.js "你的问题"');
    return;
  }
  try {
    const r = await callVolcEngine(p);
    console.log('\nAI> ', r);
    return r;
  } catch (err) {
    console.error('调用失败：', err && (err as Error).message ? (err as Error).message : err);
    process.exitCode = 1;
  }
}

// 当直接用 node/tsx 运行时支持命令行参数
if (process.argv.length > 2) {
  runPrompt().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
