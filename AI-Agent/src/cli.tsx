#!/usr/bin/env node
// src/cli.tsx
import { render } from "ink";
import { App } from "./ui/App.js";
import minimist from "minimist";
import { cleanupAllProcesses } from "./utils/tools/backgroundProcess.js";

// 设置环境变量PROJECT_ROOT为当前工作目录
// 这样智能体就会自动将运行命令的目录作为项目根目录
process.env.PROJECT_ROOT = process.cwd();

// 解析命令行参数
const args = minimist(process.argv.slice(2));

// 获取第一个非 flag 参数作为初始消息
// 例如: npm start "帮我写个代码" -> initialMessage = "帮我写个代码"
const initialMessage = args._[0] ? String(args._[0]) : undefined;

// 渲染 UI
// clear: true 会在退出时清除 UI，根据喜好设置
render(<App initialMessage={initialMessage} />);

// 注册进程清理钩子
process.on('SIGINT', () => {
  console.log('\n🛑 收到中断信号，清理后台进程...');
  cleanupAllProcesses()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('清理进程时出错:', error);
      process.exit(1);
    });
});

