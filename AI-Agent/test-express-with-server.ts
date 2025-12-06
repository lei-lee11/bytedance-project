#!/usr/bin/env node

/**
 * 完整测试：让 AI Agent 开发 Express 应用并启动服务器
 *
 * 这个脚本会：
 * 1. 让 AI Agent 生成完整的 Express 应用
 * 2. 创建 package.json
 * 3. 安装依赖
 * 4. 启动服务器
 * 5. 验证服务器运行
 */

import { initializeGraph } from "./src/agent/graph.ts";
import fs from "fs";
import path from "path";

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║   AI Agent 完整测试 - 开发并启动 Express 应用              ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log("");

// 任务描述 - 明确要求启动服务器
const task = `
开发一个完整的 Express.js 任务管理应用，并启动服务器进行预览。

要求：
1. 创建项目目录：express-demo-app
2. 生成 package.json 文件，包含必要的依赖：
   - express
   - cors
   - dotenv
3. 创建 server.js 文件，实现：
   - 基本的 Express 服务器
   - CORS 中间件
   - 一个 GET / 路由返回 "Hello from Express!"
   - 一个 GET /api/tasks 路由返回示例任务列表
4. 创建 .env 文件，设置 PORT=3000
5. 创建 README.md 说明如何运行

**重要：完成代码后，请执行以下步骤：**
6. 使用 start_background_process 工具安装依赖：npm install
7. 等待安装完成后，使用 start_background_process 工具启动服务器：npm start
8. 使用 get_process_logs 工具查看服务器日志，确认服务器成功启动
9. 告诉我服务器的访问地址（http://localhost:3000）

项目目录：express-demo-app

请一步步完成所有任务，包括启动服务器！
`;

console.log("📋 任务描述:");
console.log(task);
console.log("");
console.log("⏳ 启动 AI Agent...");
console.log("");
const graph = await initializeGraph({ demoMode: true });
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

  const projectRoot = path.join(process.cwd(), "express-demo-app");
  console.log(`📁 项目目录: ${projectRoot}`);

  // 创建项目目录
  if (!fs.existsSync(projectRoot)) {
    fs.mkdirSync(projectRoot, { recursive: true });
    console.log(`✅ 已创建项目目录`);
  }
  console.log("");

  const config = {
    configurable: {
      thread_id: "express-server-test-" + Date.now(),
      projectRoot: projectRoot,
    },
    recursionLimit: 150, // 增加递归限制，因为需要更多步骤
  };

  console.log("🚀 开始执行（自动批准模式）...");
  console.log("");

  const initialState = {
    messages: [
      {
        role: "user",
        content: task,
      },
    ],
    demoMode: true, // 启用演示模式
    projectRoot: projectRoot,
    maxIterations: 100, // 增加最大迭代次数
  };

  const result = await graph.invoke(initialState, config);

  console.log("");
  console.log("✅ AI Agent 执行完成！");
  console.log("");
  console.log("📊 最终状态:");
  console.log(`- 消息数量: ${result.messages?.length || 0}`);
  console.log(`- 任务状态: ${result.taskStatus || "unknown"}`);
  console.log(`- 迭代次数: ${result.iterationCount || 0}`);
  console.log("");

  // 检查生成的文件
  console.log("📁 检查生成的文件...");
  if (fs.existsSync(projectRoot)) {
    console.log("✅ 项目目录已创建:", projectRoot);

    listFiles(projectRoot);
  } else {
    console.log("⚠️ 项目目录未创建");
  }

  console.log("");
  console.log("✅ 测试完成！");
  console.log("");
  console.log("💡 提示：");
  console.log("   如果服务器已启动，你可以访问 http://localhost:3000");
  console.log("   查看 AI Agent 的最后几条消息，了解服务器状态");
} catch (error: any) {
  console.error("❌ 错误:", error.message);
  console.error(error.stack);
  process.exit(1);
}
