#!/usr/bin/env node

/**
 * 自动化测试：让 AI Agent 开发 Express.js 全栈应用
 *
 * 这个脚本会：
 * 1. 直接调用 AI Agent 的 graph
 * 2. 发送开发任务
 * 3. 观察 AI Agent 的工作过程
 * 4. 记录生成的文件
 */

import { initializeGraph } from "./src/agent/graph.ts";
import fs from "fs";
import path from "path";

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║   AI Agent 自动开发 Express 应用 - 端到端测试              ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log("");

// 任务描述
const task = `
开发一个完整的 Express.js 全栈任务管理应用。

要求：
1. 用户注册和登录功能（使用 JWT 和 Bcrypt）
2. 任务 CRUD 操作（增删改查）
3. SQLite 数据库持久化
4. 响应式前端界面（HTML/CSS/JS）
5. RESTful API 设计
6. 完整的 README 文档

项目目录：express-fullstack-app

请一步步实现所有功能，创建所有必需的文件。
`;

console.log("📋 任务描述:");
console.log(task);
console.log("");
console.log("⏳ 启动 AI Agent...");
console.log("");
// 列出所有文件
function listFiles(dir: string, prefix = "") {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      console.log(`${prefix}📁 ${file}/`);
      listFiles(filePath, prefix + "  ");
    } else {
      const size = stat.size;
      console.log(`${prefix}📄 ${file} (${size} bytes)`);
    }
  });
}
try {
  console.log("🔧 配置自动批准模式...");

  // 设置项目根目录为当前目录下的 express-fullstack-app
  const projectRoot = path.join(process.cwd(), "express-fullstack-app");
  console.log(`📁 项目目录: ${projectRoot}`);
  console.log("");

  console.log("🚀 开始执行（自动批准模式）...");
  console.log("");

  // 初始化 graph
  const graph = await initializeGraph({ demoMode: true });

  // 初始状态，设置 demoMode 和 projectRoot
  const initialState = {
    messages: [
      {
        role: "user",
        content: task,
      },
    ],
    demoMode: true, // 启用演示模式，跳过人工审批
    projectRoot: projectRoot,
    maxIterations: 50,
  };

  // 调用 AI Agent，启用 demoMode 跳过人工审批
  const config = {
    configurable: {
      thread_id: "express-dev-test-" + Date.now(),
      projectRoot: projectRoot, // 通过 configurable 传递 projectRoot
    },
    recursionLimit: 100, // 增加递归限制
  };

  const result = await graph.invoke(initialState, config);

  console.log("");
  console.log("✅ AI Agent 执行完成！");
  console.log("");
  console.log("📊 结果:");
  console.log(JSON.stringify(result, null, 2));
  console.log("");

  // 检查生成的文件
  console.log("📁 检查生成的文件...");
  const projectDir = path.join(process.cwd(), "express-fullstack-app");

  if (fs.existsSync(projectDir)) {
    console.log("✅ 项目目录已创建:", projectDir);

    listFiles(projectDir);
  } else {
    console.log("⚠️ 项目目录未创建");
  }

  console.log("");
  console.log("✅ 测试完成！");
} catch (error) {
  console.error("❌ 错误:", (error as Error).message);
  console.error((error as Error).stack);
  process.exit(1);
}
