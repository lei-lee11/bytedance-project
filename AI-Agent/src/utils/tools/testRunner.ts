import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readdir, access, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname, basename, extname, resolve } from "path";
import { LANGUAGE_CONFIGS, detectLanguageFromExtension } from "./languageConfig.js";

const execAsync = promisify(exec);

// 自动检测项目语言
async function detectProjectLanguage(cwd: string): Promise<string[]> {
  const detectedLanguages = new Set<string>();
  
  try {
    const files = await readdir(cwd);
    
    // 检查配置文件来推断语言
    const configFiles: Record<string, string> = {
      'package.json': 'javascript',
      'tsconfig.json': 'typescript',
      'requirements.txt': 'python',
      'pyproject.toml': 'python',
      'Pipfile': 'python',
      'setup.py': 'python',
      'pom.xml': 'java',
      'build.gradle': 'java',
      'go.mod': 'go',
      'Cargo.toml': 'rust',
      'Gemfile': 'ruby',
      'composer.json': 'php',
      'CMakeLists.txt': 'cpp'
    };
    
    for (const file of files) {
      if (configFiles[file]) {
        detectedLanguages.add(configFiles[file]);
      }
      // 检查 .csproj 文件
      if (file.endsWith('.csproj')) {
        detectedLanguages.add('csharp');
      }
    }
    
    // 如果没有检测到配置文件，检查源代码文件
    if (detectedLanguages.size === 0) {
      for (const file of files) {
        const ext = file.includes('.') ? file.substring(file.lastIndexOf('.')) : '';
        if (ext === '.ts' || ext === '.tsx') {
          detectedLanguages.add('typescript');
          continue;
        }
        const lang = detectLanguageFromExtension(ext);
        if (lang) {
          detectedLanguages.add(lang);
        }
      }
    }
  } catch (error) {
    console.error("语言检测失败:", error);
  }
  
  return Array.from(detectedLanguages);
}

export { detectProjectLanguage };

// 检查 package.json 是否有 test 脚本
async function hasTestScript(cwd: string): Promise<boolean> {
  try {
    const packageJsonPath = join(cwd, 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    return packageJson.scripts && packageJson.scripts.test !== undefined;
  } catch {
    return false;
  }
}

// 检测可用的测试命令
async function findAvailableTestCommand(
  language: string,
  cwd: string
): Promise<string | null> {
  const config = LANGUAGE_CONFIGS[language];
  if (!config) return null;
  
  for (const command of config.testCommands) {
    try {
      // 检查命令的第一部分是否存在
      const commandBase = command.split(' ')[0];
      
      // 对于本地脚本（如 npm），检查 package.json 和 test 脚本
      if (commandBase === 'npm' || commandBase === 'yarn' || commandBase === 'pnpm') {
        const packageJsonPath = join(cwd, 'package.json');
        try {
          await access(packageJsonPath);
          // 检查是否有 test 脚本
          if (command.includes('test') && !command.startsWith('npx')) {
            const hasScript = await hasTestScript(cwd);
            if (!hasScript) {
              continue; // 没有 test 脚本，跳过
            }
          }
          return command;
        } catch {
          continue;
        }
      }
      
      // 对于其他命令，尝试检查是否可执行
      try {
        await execAsync(`${commandBase} --version`, { timeout: 5000 });
        return command;
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }
  
  return null;
}

export { findAvailableTestCommand };

// 查找单个文件测试命令
async function findAvailableSingleFileTestCommand(
  language: string,
  cwd: string,
  testFilePath: string
): Promise<string | null> {
  const config = LANGUAGE_CONFIGS[language];
  if (!config || !config.singleFileTestCommands) return null;

  for (const commandTemplate of config.singleFileTestCommands) {
    try {
      const commandBase = commandTemplate.split(" ")[0];

      // 对于本地脚本（如 npm），检查 package.json 和 test 脚本
      if (
        commandBase === "npm" ||
        commandBase === "yarn" ||
        commandBase === "pnpm"
      ) {
        const packageJsonPath = join(cwd, "package.json");
        try {
          await access(packageJsonPath);
          // 对于包含 test 的命令，检查是否有 test 脚本
          if (
            commandTemplate.includes("test") &&
            !commandTemplate.startsWith("npx")
          ) {
            const hasScript = await hasTestScript(cwd);
            if (!hasScript) {
              continue; // 没有 test 脚本，跳过
            }
          }
          return commandTemplate.replace("{file}", testFilePath);
        } catch {
          continue;
        }
      }

      // 对于其他命令，尝试检查是否可执行
      try {
        await execAsync(`${commandBase} --version`, { timeout: 5000 });
        return commandTemplate.replace("{file}", testFilePath);
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export { findAvailableSingleFileTestCommand };

// ========== 测试生成辅助函数 ==========

/**
 * 分析 JavaScript/TypeScript 代码结构
 */
function analyzeJavaScriptCode(content: string): {
  functions: string[];
  classes: string[];
  exports: string[];
  imports: string[];
} {
  const functions: string[] = [];
  const classes: string[] = [];
  const exports: string[] = [];
  const imports: string[] = [];

  // 匹配函数声明
  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }

  // 匹配箭头函数导出
  const arrowFunctionRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g;
  while ((match = arrowFunctionRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }

  // 匹配类声明
  const classRegex = /(?:export\s+)?class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    classes.push(match[1]);
  }

  // 匹配 export 语句
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // 匹配 import 语句
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  return { functions, classes, exports, imports };
}

/**
 * 分析 Python 代码结构
 */
function analyzePythonCode(content: string): {
  functions: string[];
  classes: string[];
  imports: string[];
} {
  const functions: string[] = [];
  const classes: string[] = [];
  const imports: string[] = [];

  // 匹配函数定义
  const functionRegex = /def\s+(\w+)\s*\(/g;
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }

  // 匹配类定义
  const classRegex = /class\s+(\w+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    classes.push(match[1]);
  }

  // 匹配 import 语句
  const importRegex = /(?:from\s+(\S+)\s+)?import\s+([^\n]+)/g;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) imports.push(match[1]);
    if (match[2]) imports.push(...match[2].split(",").map((s) => s.trim()));
  }

  return { functions, classes, imports };
}

/**
 * 生成测试文件路径
 */
function generateTestFilePath(
  sourceFilePath: string,
  language: string
): string {
  const sourceDir = dirname(sourceFilePath);
  const sourceName = basename(sourceFilePath, extname(sourceFilePath));
  const sourceExt = extname(sourceFilePath);

  // 根据语言确定测试文件命名规则
  const testPatterns: Record<string, string> = {
    javascript: `${sourceName}.test.js`,
    typescript: `${sourceName}.test.ts`,
    python: `test_${sourceName}.py`,
    java: `${sourceName}Test.java`,
    go: `${sourceName}_test.go`,
    rust: `${sourceName}_test.rs`,
    csharp: `${sourceName}Tests.cs`,
    cpp: `${sourceName}_test.cpp`,
    ruby: `${sourceName}_test.rb`,
    php: `${sourceName}Test.php`,
  };

  const testFileName =
    testPatterns[language] || `${sourceName}.test${sourceExt}`;
  
  // 优先使用 tests 目录，如果源文件在 src 下，则在项目根目录创建 tests
  // 否则在源文件同级目录创建 __tests__ 目录
  let testDir: string;
  if (sourceDir.includes("src") || sourceDir.includes("lib")) {
    testDir = join(sourceDir, "..", "tests");
  } else {
    testDir = join(sourceDir, "__tests__");
  }

  return join(testDir, testFileName);
}

/**
 * 生成测试文件模板
 */
function generateTestTemplate(
  sourceFilePath: string,
  language: string,
  codeAnalysis: {
    functions?: string[];
    classes?: string[];
    exports?: string[];
    imports?: string[];
  },
  testFramework?: string
): string {
  const sourceName = basename(sourceFilePath, extname(sourceFilePath));
  const relativePath = sourceFilePath.replace(/\\/g, "/");

  switch (language) {
    case "javascript":
    case "typescript": {
      const ext = language === "typescript" ? "ts" : "js";
      const functions = codeAnalysis.functions || [];
      const classes = codeAnalysis.classes || [];
      const testItems = [...functions, ...classes];
      
      // 根据测试框架选择不同的导入
      const framework = testFramework || "jest";
      let importStatement = "";
      if (framework === "vitest") {
        importStatement = "import { describe, it, expect, beforeEach, afterEach } from 'vitest';";
      } else if (framework === "mocha") {
        importStatement = "// Mocha + Chai\nconst { expect } = require('chai');";
      } else {
        importStatement = "import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';";
      }

      return `/**
 * 单元测试: ${sourceName}.${ext}
 * 源文件: ${relativePath}
 * 测试框架: ${framework}
 * 生成时间: ${new Date().toISOString()}
 */

${importStatement}
${codeAnalysis.imports && codeAnalysis.imports.length > 0 
  ? `// TODO: 添加必要的导入\n// import { ... } from '${relativePath}';` 
  : `// import { ... } from '${relativePath}';`}

describe('${sourceName}', () => {
${testItems.length > 0 
  ? testItems.map(item => `  describe('${item}', () => {
    it('should work correctly', () => {
      // TODO: 实现测试用例
      expect(true).toBe(true);
    });
  });`).join('\n\n') 
  : `  it('should work correctly', () => {
    // TODO: 实现测试用例
    expect(true).toBe(true);
  });`}
});
`;
    }

    case "python": {
      const functions = codeAnalysis.functions || [];
      const classes = codeAnalysis.classes || [];
      const testItems = [...functions, ...classes];

      return `"""
单元测试: test_${sourceName}.py
源文件: ${relativePath}
生成时间: ${new Date().toISOString()}
"""

import unittest
${codeAnalysis.imports && codeAnalysis.imports.length > 0 
  ? `# TODO: 添加必要的导入\n# from ${relativePath.replace(/\//g, '.').replace(/\.py$/, '')} import ...` 
  : `# from ${relativePath.replace(/\//g, '.').replace(/\.py$/, '')} import ...`}

class Test${sourceName.charAt(0).toUpperCase() + sourceName.slice(1)}(unittest.TestCase):
${testItems.length > 0 
  ? testItems.map(item => `    def test_${item}(self):
        """测试 ${item} 函数/类"""
        # TODO: 实现测试用例
        self.assertTrue(True)`).join('\n\n') 
  : `    def test_basic(self):
        """基本测试"""
        # TODO: 实现测试用例
        self.assertTrue(True)`}

if __name__ == '__main__':
    unittest.main()
`;
    }

    default:
      return `/**
 * 单元测试模板
 * 源文件: ${relativePath}
 * 语言: ${language}
 * 生成时间: ${new Date().toISOString()}
 */

// TODO: 根据 ${language} 语言的测试框架生成测试代码
// 检测到的函数: ${codeAnalysis.functions?.join(", ") || "无"}
// 检测到的类: ${codeAnalysis.classes?.join(", ") || "无"}
`;
  }
}

// 工具1：自动检测语言并运行测试（简化版）
const autoTestRunnerTool = new DynamicStructuredTool({
  name: "auto_run_test",
  description:
    "自动检测项目语言并运行单元测试。支持的语言：JavaScript/TypeScript, Python, Java, Go, Rust, C#, C++, Ruby, PHP。" +
    "\n\n使用场景：当项目有明确的配置文件（如 package.json, requirements.txt）时使用。" +
    "\n如果自动检测失败，请使用 run_test_command 手动指定测试命令。",
  schema: z.object({
    workingDirectory: z
      .string()
      .optional()
      .describe("工作目录，默认为当前目录"),
    timeout: z
      .number()
      .optional()
      .default(60000)
      .describe("超时时间（毫秒），默认60秒"),
  }),
  func: async ({
    workingDirectory,
    timeout = 60000,
  }: {
    workingDirectory?: string;
    timeout?: number;
  }) => {
    const cwd = workingDirectory || process.cwd();

    try {
      // 检测项目语言
      const languages = await detectProjectLanguage(cwd);

      if (languages.length === 0) {
        return (
          "❌ 无法自动检测项目语言\n\n" +
          "💡 建议：\n" +
          "1. 使用 run_test_command 手动指定测试命令\n" +
          "2. 使用 list_supported_test_languages 查看支持的测试命令\n" +
          "3. 确保项目根目录包含配置文件（如 package.json, requirements.txt 等）"
        );
      }

      const results: string[] = [];

      // 只处理第一个检测到的语言（避免运行多个测试套件）
      const primaryLanguage = languages[0];
      const testCommand = await findAvailableTestCommand(
        primaryLanguage,
        cwd
      );

      if (!testCommand) {
        const langConfig = LANGUAGE_CONFIGS[primaryLanguage];
        const suggestedCommands =
          langConfig?.testCommands.slice(0, 3).join(", ") || "未知";

        return (
          `❌ 未找到可用的测试命令\n\n` +
          `🔍 检测到语言: ${langConfig?.language || primaryLanguage}\n` +
          `💡 建议尝试以下命令:\n` +
          `   ${suggestedCommands}\n\n` +
          `使用 run_test_command 工具手动执行这些命令。`
        );
      }

      try {
        results.push(
          `🔍 检测到语言: ${LANGUAGE_CONFIGS[primaryLanguage].language}`
        );
        results.push(`📝 执行命令: ${testCommand}\n`);

        const { stdout, stderr } = await execAsync(testCommand, {
          timeout,
          cwd,
          maxBuffer: 1024 * 1024 * 10,
        });

        results.push(`✅ 测试执行完成`);
        if (stdout) {
          results.push(`\n标准输出:\n${stdout}`);
        }
        if (stderr) {
          results.push(`\n标准错误（可能是警告）:\n${stderr}`);
        }
      } catch (error: unknown) {
        const execError = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          message?: string;
        };
        results.push(`❌ 测试执行失败`);
        if (execError.stdout) {
          results.push(`\n标准输出:\n${execError.stdout}`);
        }
        if (execError.stderr) {
          results.push(`\n错误信息:\n${execError.stderr}`);
        }
        if (execError.code !== undefined) {
          results.push(`\n退出码: ${execError.code}`);
        }
      }

      // 如果有多个语言，提示用户
      if (languages.length > 1) {
        results.push(
          `\n💡 提示: 检测到 ${languages.length} 种语言，仅执行了主要语言的测试。` +
          `如需测试其他语言，请使用 run_test_command 手动指定命令。`
        );
      }

      return results.join("\n");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return (
        `❌ 自动测试失败: ${errorMessage}\n\n` +
        `💡 建议使用 run_test_command 手动指定测试命令。`
      );
    }
  },
});

// 工具2：手动指定命令运行测试（主要工具）
const manualTestRunnerTool = new DynamicStructuredTool({
  name: "run_test_command",
  description:
    "手动指定测试命令来运行单元测试。这是运行测试的主要工具。\n\n" +
    "常用测试命令示例：\n" +
    "- JavaScript/TypeScript: npm test, npm run test, yarn test, npx jest, npx vitest run\n" +
    "- Python: python -m unittest, pytest, python -m pytest, python -m unittest discover\n" +
    "- Java: mvn test, gradle test, ./gradlew test\n" +
    "- Go: go test, go test ./..., go test -v\n" +
    "- Rust: cargo test, cargo test --all\n" +
    "- C#: dotnet test, dotnet test --verbosity normal\n" +
    "\n适用于：自定义测试命令、自动检测失败、或需要特定测试参数的情况。",
  schema: z.object({
    command: z.string().describe("要执行的测试命令（例如: npm test, pytest, mvn test）"),
    language: z
      .enum([
        "javascript",
        "python",
        "java",
        "go",
        "rust",
        "csharp",
        "cpp",
        "ruby",
        "php",
        "other",
      ])
      .optional()
      .describe("编程语言（可选，用于更好的结果展示）"),
    workingDirectory: z
      .string()
      .optional()
      .describe("工作目录（可选，默认为当前目录）"),
    timeout: z
      .number()
      .optional()
      .default(60000)
      .describe("超时时间（毫秒），默认60秒"),
  }),
  func: async ({
    command,
    language,
    workingDirectory,
    timeout = 60000,
  }: {
    command: string;
    language?: string;
    workingDirectory?: string;
    timeout?: number;
  }) => {
    const cwd = workingDirectory || process.cwd();

    // 安全检查：防止危险命令
    const dangerousPatterns = [
      "rm -rf",
      "del /f",
      "format",
      "dd if=",
      "mkfs",
      ":(){:|:&};:",
      "fork bomb",
      "shutdown",
      "reboot",
      "rmdir /s",
    ];

    for (const pattern of dangerousPatterns) {
      if (command.toLowerCase().includes(pattern)) {
        return (
          `⛔ 安全警告：命令包含危险操作 "${pattern}"，已阻止执行。\n\n` +
          `测试命令不应包含文件删除、格式化或其他危险操作。`
        );
      }
    }

    try {
      const langName = language
        ? LANGUAGE_CONFIGS[language]?.language || language
        : "未指定";
      const output: string[] = [
        `🔧 语言: ${langName}`,
        `📝 执行命令: ${command}`,
        `📁 工作目录: ${cwd}\n`,
      ];

      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd,
        maxBuffer: 1024 * 1024 * 10,
      });

      output.push("✅ 命令执行成功");
      if (stdout) {
        output.push(`\n标准输出:\n${stdout}`);
      }
      if (stderr) {
        // stderr 可能包含警告，不一定是错误
        output.push(`\n标准错误（可能是警告）:\n${stderr}`);
      }

      return output.join("\n");
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
        message?: string;
      };
      const output: string[] = [`❌ 命令执行失败: ${command}\n`];

      if (execError.stdout) {
        output.push(`标准输出:\n${execError.stdout}`);
      }
      if (execError.stderr) {
        output.push(`错误信息:\n${execError.stderr}`);
      }
      if (execError.code !== undefined) {
        output.push(`\n退出码: ${execError.code}`);
      }
      if (execError.message) {
        output.push(`\n错误详情: ${execError.message}`);
      }

      return output.join("\n");
    }
  },
});

// 工具3：运行单个测试文件
const singleFileTestRunnerTool = new DynamicStructuredTool({
  name: "run_single_test_file",
  description:
    "运行单个测试文件的单元测试。适用于对生成的特定代码文件进行测试验证。\n\n" +
    "支持自动检测语言类型或手动指定。" +
    "常用场景：验证新生成的测试文件、调试特定测试用例。",
  schema: z.object({
    testFilePath: z
      .string()
      .describe("测试文件的路径（相对或绝对路径，例如: tests/example.test.ts）"),
    language: z
      .enum([
        "javascript",
        "python",
        "java",
        "go",
        "rust",
        "csharp",
        "cpp",
        "ruby",
        "php",
      ])
      .optional()
      .describe("编程语言（可选，未指定时自动检测）"),
    workingDirectory: z
      .string()
      .optional()
      .describe("工作目录，默认为当前目录"),
    timeout: z
      .number()
      .optional()
      .default(60000)
      .describe("超时时间（毫秒），默认60秒"),
  }),
  func: async ({
    testFilePath,
    language,
    workingDirectory,
    timeout = 60000,
  }: {
    testFilePath: string;
    language?: string;
    workingDirectory?: string;
    timeout?: number;
  }) => {
    const cwd = workingDirectory || process.cwd();

    try {
      // 如果没有指定语言，尝试从文件扩展名检测
      let detectedLanguage = language;
      if (!detectedLanguage) {
        const ext = testFilePath.includes(".")
          ? testFilePath.substring(testFilePath.lastIndexOf("."))
          : "";
        detectedLanguage = detectLanguageFromExtension(ext) || undefined;

        if (!detectedLanguage) {
          return (
            `❌ 无法检测文件语言类型: ${testFilePath}\n\n` +
            `💡 请手动指定 language 参数，或使用 run_test_command 手动指定测试命令。`
          );
        }
      }

      // 查找可用的单文件测试命令
      const testCommand = await findAvailableSingleFileTestCommand(
        detectedLanguage,
        cwd,
        testFilePath
      );

      if (!testCommand) {
        const langConfig = LANGUAGE_CONFIGS[detectedLanguage];
        const suggestedCommands =
          langConfig?.singleFileTestCommands?.slice(0, 2).join(", ") || "未知";
        return (
          `❌ 未找到可用的单文件测试命令\n\n` +
          `🔍 检测到语言: ${langConfig?.language || detectedLanguage}\n` +
          `📝 测试文件: ${testFilePath}\n` +
          `💡 建议尝试以下命令:\n` +
          `   ${suggestedCommands.replace(/\{file\}/g, testFilePath)}\n\n` +
          `或使用 run_test_command 手动指定测试命令。`
        );
      }

      const output: string[] = [
        `🔍 检测到语言: ${LANGUAGE_CONFIGS[detectedLanguage]?.language || detectedLanguage}`,
        `📝 测试文件: ${testFilePath}`,
        `🚀 执行命令: ${testCommand}\n`,
      ];

      try {
        const { stdout, stderr } = await execAsync(testCommand, {
          timeout,
          cwd,
          maxBuffer: 1024 * 1024 * 10,
        });

        output.push("✅ 测试执行完成");
        if (stdout) {
          output.push(`\n标准输出:\n${stdout}`);
        }
        if (stderr) {
          output.push(`\n标准错误（可能是警告）:\n${stderr}`);
        }
      } catch (error: unknown) {
        const execError = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          message?: string;
        };
        output.push("❌ 测试执行失败");
        if (execError.stdout) {
          output.push(`\n标准输出:\n${execError.stdout}`);
        }
        if (execError.stderr) {
          output.push(`\n错误信息:\n${execError.stderr}`);
        }
        if (execError.code !== undefined) {
          output.push(`\n退出码: ${execError.code}`);
        }
      }

      return output.join("\n");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `❌ 执行测试失败: ${errorMessage}`;
    }
  },
});

// 工具4：列出支持的语言和命令
const listLanguagesTool = new DynamicStructuredTool({
  name: "list_supported_test_languages",
  description:
    "列出所有支持的编程语言及其推荐的测试命令。" +
    "当不确定使用哪个测试命令时，可以使用此工具查看。",
  schema: z.object({}),
  func: async () => {
    const languages = Object.entries(LANGUAGE_CONFIGS).map(([, config]) => {
      const commands = config.testCommands.slice(0, 3).join(", "); // 只显示前3个常用命令
      const moreCommands =
        config.testCommands.length > 3
          ? ` (+ ${config.testCommands.length - 3} 个其他命令)`
          : "";
      const singleFileCommands = config.singleFileTestCommands
        ?.slice(0, 2)
        .join(", ") || "不支持";
      return [
        `\n📌 ${config.language}`,
        `   文件扩展名: ${config.extensions.join(", ")}`,
        `   推荐命令: ${commands}${moreCommands}`,
        `   单文件测试: ${singleFileCommands}`,
        `   测试文件模式: ${config.testFilePatterns.join(", ")}`,
      ].join("\n");
    });

    return (
      `支持的编程语言和测试框架:\n${languages.join("\n")}\n\n` +
      `💡 提示: 使用 run_test_command 执行这些命令，或使用 auto_run_test 自动检测。`
    );
  },
});

// 工具5：生成单元测试文件
const generateTestTool = new DynamicStructuredTool({
  name: "generate_unit_tests",
  description:
    "为指定的源代码文件生成单元测试文件。自动分析代码结构（函数、类等），" +
    "根据编程语言选择合适的测试框架，并生成测试文件模板。" +
    "\n\n支持的语言：JavaScript/TypeScript, Python, Java, Go, Rust, C#, C++, Ruby, PHP。" +
    "\n生成的测试文件包含基本结构和 TODO 注释，需要进一步完善测试用例。",
  schema: z.object({
    sourceFilePath: z
      .string()
      .describe("源代码文件路径（相对或绝对路径，例如: src/utils/helper.ts）"),
    language: z
      .enum([
        "javascript",
        "python",
        "java",
        "go",
        "rust",
        "csharp",
        "cpp",
        "ruby",
        "php",
      ])
      .optional()
      .describe("编程语言（可选，未指定时自动检测）"),
    testFramework: z
      .enum(["jest", "vitest", "mocha", "pytest", "unittest", "auto"])
      .optional()
      .default("auto")
      .describe("测试框架（可选，默认自动选择）"),
    outputPath: z
      .string()
      .optional()
      .describe("测试文件输出路径（可选，默认在 tests 目录下）"),
  }),
  func: async ({
    sourceFilePath,
    language,
    testFramework = "auto",
    outputPath,
  }: {
    sourceFilePath: string;
    language?: string;
    testFramework?: string;
    outputPath?: string;
  }) => {
    try {
      // 解析源文件路径
      const resolvedSourcePath = resolve(sourceFilePath);

      // 读取源代码
      let sourceContent: string;
      try {
        sourceContent = await readFile(resolvedSourcePath, "utf-8");
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return `❌ 无法读取源文件: ${errorMessage}`;
      }

      // 检测语言
      let detectedLanguage = language;
      if (!detectedLanguage) {
        const ext = extname(sourceFilePath);
        detectedLanguage = detectLanguageFromExtension(ext) || undefined;

        if (!detectedLanguage) {
          return (
            `❌ 无法检测文件语言类型: ${sourceFilePath}\n\n` +
            `💡 请手动指定 language 参数。`
          );
        }
      }

      // 分析代码结构
      let codeAnalysis: {
        functions?: string[];
        classes?: string[];
        exports?: string[];
        imports?: string[];
      } = {};

      if (detectedLanguage === "javascript" || detectedLanguage === "typescript") {
        codeAnalysis = analyzeJavaScriptCode(sourceContent);
      } else if (detectedLanguage === "python") {
        codeAnalysis = analyzePythonCode(sourceContent);
      } else {
        // 其他语言暂时只提取基本信息
        codeAnalysis = {
          functions: [],
          classes: [],
        };
      }

      // 生成测试文件路径
      const testFilePath = outputPath
        ? resolve(outputPath)
        : generateTestFilePath(resolvedSourcePath, detectedLanguage);

      // 确定使用的测试框架
      const framework = testFramework === "auto"
        ? (detectedLanguage === "javascript" || detectedLanguage === "typescript" 
            ? "jest" 
            : detectedLanguage === "python" 
            ? "pytest" 
            : "default")
        : testFramework;

      // 生成测试模板
      const testTemplate = generateTestTemplate(
        resolvedSourcePath,
        detectedLanguage,
        codeAnalysis,
        framework
      );

      // 创建测试文件
      try {
        const testDir = dirname(testFilePath);
        await mkdir(testDir, { recursive: true });
        await writeFile(testFilePath, testTemplate, "utf-8");
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return `❌ 无法创建测试文件: ${errorMessage}`;
      }

      // 生成结果信息
      const result: string[] = [
        `✅ 测试文件生成成功！\n`,
        `📝 源文件: ${sourceFilePath}`,
        `📄 测试文件: ${testFilePath}`,
        `🔧 语言: ${LANGUAGE_CONFIGS[detectedLanguage]?.language || detectedLanguage}`,
        `📊 代码分析:`,
      ];

      if (codeAnalysis.functions && codeAnalysis.functions.length > 0) {
        result.push(`   函数: ${codeAnalysis.functions.join(", ")}`);
      }
      if (codeAnalysis.classes && codeAnalysis.classes.length > 0) {
        result.push(`   类: ${codeAnalysis.classes.join(", ")}`);
      }
      if (codeAnalysis.exports && codeAnalysis.exports.length > 0) {
        result.push(`   导出: ${codeAnalysis.exports.join(", ")}`);
      }

      result.push(
        `\n💡 下一步:`,
        `1. 查看生成的测试文件: ${testFilePath}`,
        `2. 完善测试用例（替换 TODO 注释）`,
        `3. 运行测试: 使用 run_test_command 或 run_single_test_file 工具`
      );

      return result.join("\n");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `❌ 生成测试文件失败: ${errorMessage}`;
    }
  },
});

// 分别导出每个工具（用于测试）
export { manualTestRunnerTool, generateTestTool, singleFileTestRunnerTool, autoTestRunnerTool, listLanguagesTool };

// 导出所有测试工具
// 注意：manualTestRunnerTool 是主要工具，应该优先使用
export const testTools = [
  manualTestRunnerTool, // 主要工具，放在第一位
  generateTestTool, // 测试生成工具
  singleFileTestRunnerTool, // 单文件测试工具
  autoTestRunnerTool, // 辅助工具，用于自动检测
  listLanguagesTool, // 辅助工具，用于查看支持的语言
];


