/**
 * 测试生成工具功能验证脚本
 * Run with: tsx scripts/test_test_generation.ts
 */

import { generateTestTool } from "../src/utils/tools/testRunner.ts";
import * as fs from "fs/promises";
import * as path from "path";

async function testTestGeneration() {
  console.log("=".repeat(60));
  console.log("Testing Test Generation Tool");
  console.log("=".repeat(60));
  console.log();

  // 测试文件路径
  const testFiles = [
    "personal-website/script.js",
    "src/utils/tools/testRunner.ts",
  ];

  for (let i = 0; i < testFiles.length; i++) {
    const sourceFile = testFiles[i];
    console.log(`Test ${i + 1}: Generate tests for ${sourceFile}`);
    console.log("-".repeat(60));

    try {
      // 检查源文件是否存在
      try {
        await fs.access(sourceFile);
      } catch {
        console.log(`⚠️  源文件不存在，跳过: ${sourceFile}\n`);
        continue;
      }

      // 生成测试文件
      const result = await generateTestTool.invoke({
        sourceFilePath: sourceFile,
      });

      console.log(result);
      console.log();

      // 检查生成的测试文件是否存在
      const testFilePath = extractTestFilePath(result);
      if (testFilePath) {
        try {
          await fs.access(testFilePath);
          const stats = await fs.stat(testFilePath);
          console.log(`✅ 测试文件已创建: ${testFilePath}`);
          console.log(`   文件大小: ${stats.size} bytes\n`);

          // 读取并显示前几行
          const content = await fs.readFile(testFilePath, "utf-8");
          const lines = content.split("\n").slice(0, 15);
          console.log("   文件预览（前15行）:");
          lines.forEach((line, idx) => {
            console.log(`   ${idx + 1}: ${line}`);
          });
          console.log();
        } catch {
          console.log(`⚠️  测试文件未找到: ${testFilePath}\n`);
        }
      }
    } catch (error: any) {
      console.error(`❌ 错误: ${error.message}\n`);
    }
  }

  // 测试特定语言
  console.log("Test 3: Generate tests with specific language");
  console.log("-".repeat(60));
  try {
    const result = await generateTestTool.invoke({
      sourceFilePath: "personal-website/script.js",
      language: "javascript",
      testFramework: "jest",
    });
    console.log(result);
    console.log();
  } catch (error: any) {
    console.error(`❌ 错误: ${error.message}\n`);
  }

  // 测试自定义输出路径
  console.log("Test 4: Generate tests with custom output path");
  console.log("-".repeat(60));
  try {
    const customPath = "personal-website/custom_test.test.js";
    const result = await generateTestTool.invoke({
      sourceFilePath: "personal-website/script.js",
      outputPath: customPath,
    });
    console.log(result);
    console.log();

    // 检查文件是否存在
    try {
      await fs.access(customPath);
      console.log(`✅ 自定义路径测试文件已创建: ${customPath}\n`);
      
      // 清理测试文件
      await fs.unlink(customPath);
      console.log(`🧹 已清理测试文件: ${customPath}\n`);
    } catch {
      console.log(`⚠️  自定义路径测试文件未找到: ${customPath}\n`);
    }
  } catch (error: any) {
    console.error(`❌ 错误: ${error.message}\n`);
  }

  console.log("=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
}

/**
 * 从工具输出中提取测试文件路径
 */
function extractTestFilePath(output: string): string | null {
  const match = output.match(/📄 测试文件:\s*(.+)/);
  return match ? match[1].trim() : null;
}

// 运行测试
testTestGeneration().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});