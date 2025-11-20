import { callVolcEngine } from '../tools/volcengine.js';
import readline from 'readline';

async function singleShot(prompt: string) {
	try {
		const res = await callVolcEngine(prompt);
		console.log('\nAI> ', res);
	} catch (err) {
		console.error('调用失败：', err && (err as Error).message ? (err as Error).message : err);
		process.exitCode = 1;
	}
}

function startRepl() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'You> ' });
	console.log('进入交互模式，输入 exit 或 quit 退出。');
	rl.prompt();
	rl.on('line', async (line) => {
		const text = line.trim();
		if (!text) {
			rl.prompt();
			return;
		}
		if (text === 'exit' || text === 'quit') {
			rl.close();
			return;
		}
		try {
			const res = await callVolcEngine(text);
			console.log('\nAI> ', res);
		} catch (err) {
			console.error('调用失败：', err && (err as Error).message ? (err as Error).message : err);
		}
		rl.prompt();
	});
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length === 0) {
		console.log('用法: node dist/cli/commands.js "你的问题"  或  node dist/cli/commands.js --repl');
		console.log('示例: node dist/cli/commands.js "请用一句话介绍自己。"');
		return;
	}

	if (argv.includes('--repl') || argv.includes('-r')) {
		startRepl();
		return;
	}

	// 把所有参数拼接成一个提示
	const prompt = argv.join(' ');
	await singleShot(prompt);
}

main();