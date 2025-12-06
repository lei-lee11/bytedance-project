#!/usr/bin/env tsx

/**
 * 测试 AI Agent 自动开发 Express 全栈应用
 *
 * 使用新版 graph.new.ts
 *
 * 测试流程：
 * 1. 启动 AI Agent
 * 2. 发送任务："开发一个 Express.js 全栈应用"
 * 3. AI Agent 自动创建项目结构、编写代码、配置数据库等
 * 4. 观察工作过程
 * 5. 验证生成的代码
 */

import { initializeGraph } from "./src/agent/graph.ts";
import fs from "fs";
import path from "path";

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║   测试 AI Agent 开发 Express 全栈应用 (新版 Graph)        ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log("");

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, "express-app-generated");

async function testExpressAppDevelopment() {
  console.log("📝 任务：开发 Express.js 全栈应用");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  // 清理旧的生成目录
  if (fs.existsSync(outputDir)) {
    console.log("🗑️  清理旧的生成目录...");
    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log("✅ 清理完成");
    console.log("");
  }

  // 简化的任务描述 - 分步骤创建
  const task = `创建一个 Express.js 应用，项目目录为 express-app-generated。

第一步：创建基础文件
1. 创建 express-app-generated/package.json，包含：
   - 名称: "express-app-generated"
   - 依赖: express, cors
   - 启动脚本: "start": "node server.js"

2. 创建 express-app-generated/server.js，实现：
   - 导入 express 和 cors
   - 创建 Express 应用
   - 配置 CORS
   - 添加静态文件服务（public 目录）
   - 使用用户路由
   - 监听 3000 端口
   - 包含注释

3. 创建 express-app-generated/routes/users.js，实现：
   - GET /api/users - 返回用户数组
   - POST /api/users - 创建用户
   - GET /api/users/:id - 获取单个用户
   - PUT /api/users/:id - 更新用户
   - DELETE /api/users/:id - 删除用户
   - 使用内存数组存储数据

4. 创建 express-app-generated/public/index.html，包含：
   - 标题 "用户管理系统"
   - 用户列表显示区域
   - 添加用户表单（姓名、邮箱）
   - 现代化 CSS 样式

5. 创建 express-app-generated/public/app.js，实现：
   - 加载用户列表
   - 添加新用户
   - 删除用户
   - 使用 Fetch API

6. 创建 express-app-generated/README.md，说明：
   - 项目介绍
   - 安装步骤: npm install
   - 启动步骤: npm start
   - API 端点列表

请一次性创建所有6个文件，确保代码完整可运行。`;

  console.log("任务描述：");
  console.log("━".repeat(60));
  console.log(task);
  console.log("━".repeat(60));
  console.log("");

  // 初始化 Graph
  console.log("🔧 初始化 AI Agent...");
  const graph = await initializeGraph({
    demoMode: true, // 演示模式，自动批准文件操作
    recursionLimit: 300, // 给予更高的递归限制，因为这是个复杂任务
  });
  console.log("✅ AI Agent 初始化完成");
  console.log("");

  const config = {
    configurable: {
      thread_id: "express-fullstack-new-" + Date.now(),
      projectRoot: projectRoot,
    },
    recursionLimit: 300,
  };

  const initialState = {
    messages: [{ role: "user", content: task }],
    demoMode: true,
    projectRoot: projectRoot,
    maxIterations: 50,
  };

  console.log("⏳ AI Agent 开始工作...");
  console.log("");
  console.log("💡 提示：这个任务比较复杂，可能需要几分钟时间");
  console.log("");

  const startTime = Date.now();

  try {
    const result = await graph.invoke(initialState, config);

    const duration = Date.now() - startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);

    console.log("");
    console.log("━".repeat(60));
    console.log(`✅ AI Agent 完成！耗时: ${minutes}分${seconds}秒`);
    console.log("━".repeat(60));
    console.log("");

    // 验证生成的文件
    console.log("🔍 验证生成的项目");
    console.log("━".repeat(60));
    console.log("");

    const requiredFiles = [
      "package.json",
      "server.js",
      "routes/users.js",
      "public/index.html",
      "public/app.js",
      "README.md",
    ];

    const results: any[] = [];
    let allFilesExist = true;

    for (const file of requiredFiles) {
      const filePath = path.join(outputDir, file);
      const exists = fs.existsSync(filePath);
      results.push({ file, exists, path: filePath });

      if (!exists) {
        allFilesExist = false;
      }
    }

    // 显示文件检查结果
    console.log("📁 文件结构检查：");
    results.forEach((r) => {
      const icon = r.exists ? "✅" : "❌";
      console.log(`   ${icon} ${r.file}`);

      if (r.exists) {
        const stat = fs.statSync(r.path);
        console.log(`      大小: ${stat.size} bytes`);
      }
    });
    console.log("");

    // 检查 package.json
    if (fs.existsSync(path.join(outputDir, "package.json"))) {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(outputDir, "package.json"), "utf-8"),
      );
      console.log("📦 package.json 检查：");
      console.log(`   名称: ${packageJson.name || "❌ 未设置"}`);
      console.log(`   版本: ${packageJson.version || "❌ 未设置"}`);
      console.log(
        `   依赖: ${packageJson.dependencies ? Object.keys(packageJson.dependencies).join(", ") : "❌ 无"}`,
      );
      console.log(`   启动脚本: ${packageJson.scripts?.start || "❌ 未设置"}`);
      console.log("");
    }

    // 显示 README 内容
    const readmePath = path.join(outputDir, "README.md");
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, "utf-8");
      console.log("📖 README.md 预览：");
      console.log("━".repeat(60));
      const lines = readme.split("\n").slice(0, 20);
      lines.forEach((line) => console.log(line));
      if (readme.split("\n").length > 20) {
        console.log("... (内容已截断)");
      }
      console.log("━".repeat(60));
      console.log("");
    }

    // 最终结果
    if (allFilesExist) {
      console.log(
        "╔════════════════════════════════════════════════════════════╗",
      );
      console.log(
        "║   🎉 测试成功！所有文件都已生成                            ║",
      );
      console.log(
        "╚════════════════════════════════════════════════════════════╝",
      );
      console.log("");
      console.log("📂 项目位置：");
      console.log(`   ${outputDir}`);
      console.log("");
      console.log("🚀 启动应用：");
      console.log("   1. cd express-app-generated");
      console.log("   2. npm install");
      console.log("   3. npm start");
      console.log("   4. 打开浏览器访问 http://localhost:3000");
      console.log("");
      console.log("📝 API 测试：");
      console.log("   - GET    http://localhost:3000/api/users");
      console.log("   - POST   http://localhost:3000/api/users");
      console.log("   - GET    http://localhost:3000/api/users/1");
      console.log("   - PUT    http://localhost:3000/api/users/1");
      console.log("   - DELETE http://localhost:3000/api/users/1");
      console.log("");

      return true;
    } else {
      console.log("⚠️ 部分文件未生成");
      console.log("");
      console.log("💡 可能的原因：");
      console.log("   - AI Agent 可能需要更多时间");
      console.log("   - 任务可能过于复杂");
      console.log("   - 检查上面的日志查看详细信息");
      console.log("");
      return false;
    }
  } catch (error: any) {
    console.error("");
    console.error("❌ 测试失败:", error.message);
    console.error("");
    console.error("错误详情:");
    console.error(error.stack);
    return false;
  }
}

// 主函数
async function main() {
  try {
    const success = await testExpressAppDevelopment();
    process.exit(success ? 0 : 1);
  } catch (error: any) {
    console.error("❌ 程序异常:", error.message);
    process.exit(1);
  }
}

void main();
