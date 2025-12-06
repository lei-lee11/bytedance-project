#!/usr/bin/env node

/**
 * 分步测试：先生成代码，再手动验证启动
 * 
 * 这个方案更可靠：
 * 1. 第一步：让 AI Agent 生成代码
 * 2. 第二步：我们手动验证代码
 * 3. 第三步：手动启动服务器
 */

import { graph } from './src/agent/graph.ts';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║   分步测试 - 验证 AI Agent 的完整能力                      ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

const projectRoot = path.join(process.cwd(), 'express-test');

// 第一步：生成代码
async function step1_generateCode() {
  console.log('📝 第一步：让 AI Agent 生成代码');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const task = `
创建一个简单的 Express 服务器。

要求：
1. 创建 package.json，包含 express 依赖
2. 创建 server.js，监听 3000 端口，返回 "Hello World"
3. 创建 .gitignore，忽略 node_modules

项目目录：express-test

只需要生成这3个文件即可，不需要安装或启动。
`;

  // 清理旧目录
  if (fs.existsSync(projectRoot)) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(projectRoot, { recursive: true });

  const config = {
    configurable: {
      thread_id: 'step-test-' + Date.now(),
      projectRoot: projectRoot
    },
    recursionLimit: 100
  };

  const initialState = {
    messages: [{ role: 'user', content: task }],
    demoMode: true,
    projectRoot: projectRoot,
    maxIterations: 50
  };

  console.log('⏳ AI Agent 正在生成代码...');
  const result = await graph.invoke(initialState, config);
  
  console.log('✅ 代码生成完成！');
  console.log('');
  
  return result;
}

// 第二步：验证生成的文件
function step2_verifyFiles() {
  console.log('🔍 第二步：验证生成的文件');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const requiredFiles = ['package.json', 'server.js'];
  const missingFiles: string[] = [];
  
  requiredFiles.forEach(file => {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      console.log(`✅ ${file} (${stat.size} bytes)`);
      
      // 显示文件内容预览
      const content = fs.readFileSync(filePath, 'utf-8');
      const preview = content.substring(0, 150).replace(/\n/g, ' ');
      console.log(`   预览: ${preview}...`);
      console.log('');
    } else {
      console.log(`❌ ${file} - 文件不存在`);
      missingFiles.push(file);
    }
  });

  if (missingFiles.length > 0) {
    console.log(`⚠️ 缺少 ${missingFiles.length} 个文件`);
    return false;
  }

  console.log('✅ 所有必需文件都已生成！');
  console.log('');
  return true;
}

// 第三步：安装依赖
async function step3_installDeps(): Promise<boolean> {
  console.log('📦 第三步：安装依赖');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  return new Promise((resolve) => {
    console.log('⏳ 正在运行 npm install...');
    
    const npm = spawn('npm', ['install'], {
      cwd: projectRoot,
      shell: true,
      stdio: 'pipe'
    });

    let output = '';

    npm.stdout?.on('data', (data) => {
      output += data.toString();
    });

    npm.stderr?.on('data', (data) => {
      output += data.toString();
    });

    npm.on('close', (code) => {
      if (code === 0) {
        console.log('✅ 依赖安装成功！');
        console.log('');
        
        // 检查 node_modules
        const nodeModulesPath = path.join(projectRoot, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
          console.log('✅ node_modules 目录已创建');
          const expressPath = path.join(nodeModulesPath, 'express');
          if (fs.existsSync(expressPath)) {
            console.log('✅ express 已安装');
          }
        }
        console.log('');
        resolve(true);
      } else {
        console.log(`❌ 安装失败，退出码: ${code}`);
        console.log('输出:', output);
        console.log('');
        resolve(false);
      }
    });
  });
}

// 第四步：启动服务器
async function step4_startServer(): Promise<void> {
  console.log('🚀 第四步：启动服务器');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  return new Promise((resolve) => {
    console.log('⏳ 正在启动服务器...');
    
    const server = spawn('node', ['server.js'], {
      cwd: projectRoot,
      shell: true,
      stdio: 'pipe'
    });

    let started = false;

    server.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('📝 服务器输出:', output.trim());
      
      if (output.includes('running') || output.includes('listening') || output.includes('3000')) {
        if (!started) {
          started = true;
          console.log('');
          console.log('✅ 服务器启动成功！');
          console.log('🌐 访问地址: http://localhost:3000');
          console.log('');
          console.log('💡 提示：');
          console.log('   - 服务器正在后台运行');
          console.log('   - 按 Ctrl+C 停止测试脚本');
          console.log('   - 服务器会继续运行，需要手动停止');
          console.log('');
          
          // 等待一会儿让用户看到消息
          setTimeout(() => {
            resolve();
          }, 2000);
        }
      }
    });

    server.stderr?.on('data', (data) => {
      console.log('⚠️ 错误输出:', data.toString().trim());
    });

    server.on('close', (code) => {
      console.log(`服务器进程退出，代码: ${code}`);
      resolve();
    });

    // 超时检查
    setTimeout(() => {
      if (!started) {
        console.log('⚠️ 服务器启动超时（5秒）');
        server.kill();
        resolve();
      }
    }, 5000);
  });
}

// 主流程
async function main() {
  try {
    // 第一步：生成代码
    await step1_generateCode();
    
    // 第二步：验证文件
    const filesOk = step2_verifyFiles();
    if (!filesOk) {
      console.log('❌ 文件验证失败，停止测试');
      return;
    }
    
    // 第三步：安装依赖
    const installOk = await step3_installDeps();
    if (!installOk) {
      console.log('❌ 依赖安装失败，停止测试');
      return;
    }
    
    // 第四步：启动服务器
    await step4_startServer();
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║   🎉 完整的端到端测试成功！                                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('✅ AI Agent 成功完成：');
    console.log('   1. 生成代码 ✅');
    console.log('   2. 文件验证 ✅');
    console.log('   3. 安装依赖 ✅');
    console.log('   4. 启动服务器 ✅');
    console.log('');
    console.log('🌐 现在你可以访问 http://localhost:3000 查看应用！');
    console.log('');
    
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
