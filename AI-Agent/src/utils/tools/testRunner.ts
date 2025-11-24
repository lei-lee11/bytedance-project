import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import { readdir, access } from "fs/promises";
import { join } from "path";
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
      'requirements.txt': 'python',
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
        const ext = file.substring(file.lastIndexOf('.'));
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
      
      // 对于本地脚本（如 npm），检查 package.json
      if (commandBase === 'npm' || commandBase === 'yarn' || commandBase === 'pnpm') {
        const packageJsonPath = join(cwd, 'package.json');
        try {
          await access(packageJsonPath);
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

// 工具1：自动检测语言并运行测试
export const autoTestRunnerTool = new DynamicStructuredTool({
  name: "auto_run_test",
  description: `自动检测项目语言并运行相应的单元测试。支持的语言包括：${Object.keys(LANGUAGE_CONFIGS).join(', ')}。会自动选择合适的测试命令。`,
  schema: z.object({
    workingDirectory: z.string().optional().describe("工作目录，默认为当前目录"),
    timeout: z.number().optional().default(60000).describe("超时时间（毫秒），默认60秒"),
  }),
  func: async ({ workingDirectory, timeout = 60000 }) => {
    const cwd = workingDirectory || process.cwd();
    
    try {
      // 检测项目语言
      const languages = await detectProjectLanguage(cwd);
      
      if (languages.length === 0) {
        return "无法检测到项目语言。请使用 run_test_command 手动指定测试命令。";
      }
      
      const results = [];
      
      // 对每种检测到的语言尝试运行测试
      for (const language of languages) {
        const testCommand = await findAvailableTestCommand(language, cwd);
        
        if (!testCommand) {
          results.push(`❌ ${LANGUAGE_CONFIGS[language].language}: 未找到可用的测试命令`);
          continue;
        }
        
        try {
          results.push(`\n🔍 检测到语言: ${LANGUAGE_CONFIGS[language].language}`);
          results.push(`📝 执行命令: ${testCommand}\n`);
          
          const { stdout, stderr } = await execAsync(testCommand, {
            timeout,
            cwd,
            maxBuffer: 1024 * 1024 * 10,
          });
          
          results.push(`✅ 测试通过`);
          if (stdout) results.push(`输出:\n${stdout}`);
          if (stderr) results.push(`警告:\n${stderr}`);
          
        } catch (error) {
          const execError = error as { stdout?: string; stderr?: string; code?: number; message?: string };
          results.push(`❌ 测试失败`);
          if (execError.stdout) results.push(`输出:\n${execError.stdout}`);
          if (execError.stderr) results.push(`错误:\n${execError.stderr}`);
          if (execError.code) results.push(`退出码: ${execError.code}`);
        }
      }
      
      return results.join("\n");
      
    } catch (error) {
      const execError = error as { message?: string };
      return `自动测试失败: ${execError.message || String(error)}`;
    }
  },
});

// 工具2：手动指定命令运行测试
export const manualTestRunnerTool = new DynamicStructuredTool({
  name: "run_test_command",
  description: "手动指定测试命令来运行单元测试。适用于自定义测试命令或自动检测失败的情况。",
  schema: z.object({
    command: z.string().describe("要执行的测试命令"),
    language: z.enum([
      "javascript", "python", "java", "go", "rust", 
      "csharp", "cpp", "ruby", "php", "other"
    ]).optional().describe("编程语言，用于更好的结果展示"),
    workingDirectory: z.string().optional().describe("工作目录"),
    timeout: z.number().optional().default(60000).describe("超时时间（毫秒）"),
  }),
  func: async ({ command, language, workingDirectory, timeout = 60000 }) => {
    const cwd = workingDirectory || process.cwd();
    
    // 安全检查：防止危险命令
    const dangerousPatterns = [
      'rm -rf', 'del /f', 'format', 'dd if=', 
      'mkfs', ':(){:|:&};:', 'fork bomb'
    ];
    
    for (const pattern of dangerousPatterns) {
      if (command.toLowerCase().includes(pattern)) {
        return `⛔ 安全警告：命令包含危险操作 "${pattern}"，已阻止执行。`;
      }
    }
    
    try {
      const langName = language ? LANGUAGE_CONFIGS[language]?.language || language : "未指定";
      const output = [`🔧 语言: ${langName}`, `📝 执行命令: ${command}\n`];
      
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd,
        maxBuffer: 1024 * 1024 * 10,
      });
      
      output.push("✅ 命令执行成功");
      if (stdout) output.push(`\n标准输出:\n${stdout}`);
      if (stderr) output.push(`\n标准错误:\n${stderr}`);
      
      return output.join("\n");
      
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number };
      const output = [`❌ 命令执行失败: ${command}\n`];
      
      if (execError.stdout) output.push(`标准输出:\n${execError.stdout}`);
      if (execError.stderr) output.push(`标准错误:\n${execError.stderr}`);
      if (execError.code !== undefined) output.push(`\n退出码: ${execError.code}`);
      
      return output.join("\n");
    }
  },
});

// 工具3：列出支持的语言和命令
export const listLanguagesTool = new DynamicStructuredTool({
  name: "list_supported_test_languages",
  description: "列出所有支持的编程语言及其测试命令。",
  schema: z.object({}),
  func: async () => {
    const languages = Object.entries(LANGUAGE_CONFIGS).map(([, config]) => {
      return [
        `\n📌 ${config.language}`,
        `   扩展名: ${config.extensions.join(', ')}`,
        `   测试命令: ${config.testCommands.join(' | ')}`,
        `   测试文件: ${config.testFilePatterns.join(', ')}`
      ].join('\n');
    });
    
    return `支持的编程语言和测试框架:\n${languages.join('\n')}`;
  },
});

// 导出所有测试工具
export const testTools = [
  autoTestRunnerTool,
  manualTestRunnerTool,
  listLanguagesTool
];

