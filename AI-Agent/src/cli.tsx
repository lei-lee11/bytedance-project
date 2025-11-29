#!/usr/bin/env node
// src/cli.tsx
import { render } from "ink";
import { App } from "./ui/App.js";
import minimist from "minimist";

// 解析命令行参数
const args = minimist(process.argv.slice(2));

// 获取第一个非 flag 参数作为初始消息
// 例如: npm start "帮我写个代码" -> initialMessage = "帮我写个代码"
const initialMessage = args._[0] ? String(args._[0]) : undefined;

// 渲染 UI
// clear: true 会在退出时清除 UI，根据喜好设置
render(<App initialMessage={initialMessage} />);
