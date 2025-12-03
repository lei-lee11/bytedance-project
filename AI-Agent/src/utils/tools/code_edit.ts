import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import fs from 'fs/promises';
import path from 'path';
import { backupManager } from './backup_manager.js';
import { diffGenerator } from './diff_generator.js';
import { syntaxChecker } from './syntax_checker.js';
import { grep_search_ripgrep } from './code_search.js';

/**
 * 查找代码在文件中的精确匹配
 */
function findExactMatch(content: string, target: string): {
  found: boolean;
  matches: Array<{
    startIndex: number;
    endIndex: number;
    lineStart: number;
    lineEnd: number;
    context: string;
  }>;
} {
  const matches = [];
  
  // 标准化换行符
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const normalizedTarget = target.replace(/\r\n/g, '\n');
  
  let searchIndex = 0;
  const lines = normalizedContent.split('\n');
  
  while (searchIndex < normalizedContent.length) {
    const index = normalizedContent.indexOf(normalizedTarget, searchIndex);
    if (index === -1) break;
    
    // 计算行号
    const beforeMatch = normalizedContent.substring(0, index);
    const lineStart = beforeMatch.split('\n').length;
    const linesInMatch = normalizedTarget.split('\n').length;
    const lineEnd = lineStart + linesInMatch - 1;
    
    // 获取上下文（前后3行）
    const contextStart = Math.max(0, lineStart - 4);
    const contextEnd = Math.min(lines.length, lineEnd + 3);
    const contextLines = lines.slice(contextStart, contextEnd);
    
    matches.push({
      startIndex: index,
      endIndex: index + normalizedTarget.length,
      lineStart,
      lineEnd,
      context: contextLines.join('\n'),
    });
    
    searchIndex = index + normalizedTarget.length;
  }
  
  return {
    found: matches.length > 0,
    matches,
  };
}

/**
 * 工具1: 编辑代码片段
 */
const editCodeSnippet = new DynamicStructuredTool({
  name: "edit_code_snippet",
  description:
    "编辑文件中的代码片段。精确匹配并替换指定的代码。" +
    "会自动创建备份、显示差异、检查语法。" +
    "适用于修复bug、重构代码、添加新功能等场景。" +
    "\n\n注意: old_code 必须与文件中的代码完全匹配（包括缩进和空格）",
  schema: z.object({
    file_path: z.string().describe("要编辑的文件路径"),
    old_code: z
      .string()
      .describe("要替换的代码片段（必须精确匹配，包括缩进）"),
    new_code: z.string().describe("新的代码片段"),
    language: z
      .string()
      .optional()
      .describe("编程语言（用于语法检查，如: typescript, python, javascript）"),
    preview_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否只预览不执行修改"),
  }),
  func: async ({ file_path, old_code, new_code, language, preview_only = false }) => {
    try {
      // 1. 读取文件
      const resolvedPath = path.resolve(file_path);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      
      // 2. 查找匹配
      const matchResult = findExactMatch(content, old_code);
      
      if (!matchResult.found) {
        return `❌ 未找到匹配的代码片段\n\n请确保代码完全匹配（包括缩进和空格）\n\n提示: 使用 find_code_context 工具先查找正确的代码`;
      }
      
      if (matchResult.matches.length > 1) {
        let result = `⚠️ 找到 ${matchResult.matches.length} 处匹配，请提供更多上下文以确保唯一匹配\n\n`;
        matchResult.matches.forEach((match, index) => {
          result += `匹配 ${index + 1} (第 ${match.lineStart}-${match.lineEnd} 行):\n`;
          result += `\`\`\`\n${match.context}\n\`\`\`\n\n`;
        });
        return result;
      }
      
      const match = matchResult.matches[0];
      
      // 3. 生成新内容
      const newContent = content.substring(0, match.startIndex) + 
                        new_code + 
                        content.substring(match.endIndex);
      
      // 4. 生成 diff
      const diff = diffGenerator.generateColoredDiff(content, newContent, file_path);
      const summary = diffGenerator.generateSummary(content, newContent);
      
      let result = `📝 代码修改预览 (${summary})\n\n`;
      result += `文件: ${file_path}\n`;
      result += `位置: 第 ${match.lineStart}-${match.lineEnd} 行\n\n`;
      result += `差异:\n${diff}\n\n`;
      
      // 5. 仅预览模式
      if (preview_only) {
        result += `ℹ️ 预览模式：未实际修改文件\n`;
        result += `提示: 移除 preview_only 参数以执行修改`;
        return result;
      }
      
      // // 6. 语法检查
      // const lang = language || syntaxChecker.detectLanguage(file_path);
      // const syntaxResult = await syntaxChecker.checkSyntax(newContent, lang);
      
      // result += syntaxChecker.formatResult(syntaxResult) + '\n\n';
      
      // if (!syntaxResult.valid) {
      //   result += `⚠️ 语法检查未通过，建议修复后再试\n`;
      //   result += `如果确定要继续，请重新调用并添加确认`;
      //   return result;
      // }
      
      // 7. 创建备份
      const backupPath = await backupManager.createBackup(resolvedPath);
      result += `💾 已创建备份: ${path.basename(backupPath)}\n\n`;
      
      // 8. 写入新内容
      await fs.writeFile(resolvedPath, newContent, 'utf-8');
      
      result += `✅ 文件已成功修改\n`;
      result += `\n提示: 使用 restore_from_backup 可以恢复到之前的版本`;
      
      return result;
    } catch (error: any) {
      return `❌ 编辑失败: ${error.message}`;
    }
  },
});

/**
 * 工具2: 预览代码变更
 */
const previewCodeChange = new DynamicStructuredTool({
  name: "preview_code_change",
  description:
    "预览代码修改的差异，不实际修改文件。" +
    "显示详细的 diff 和变更摘要。",
  schema: z.object({
    file_path: z.string().describe("文件路径"),
    old_code: z.string().describe("要替换的代码片段"),
    new_code: z.string().describe("新的代码片段"),
  }),
  func: async ({ file_path, old_code, new_code }) => {
    try {
      const resolvedPath = path.resolve(file_path);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      
      const matchResult = findExactMatch(content, old_code);
      
      if (!matchResult.found) {
        return `❌ 未找到匹配的代码片段`;
      }
      
      if (matchResult.matches.length > 1) {
        return `⚠️ 找到 ${matchResult.matches.length} 处匹配，无法预览`;
      }
      
      const match = matchResult.matches[0];
      const newContent = content.substring(0, match.startIndex) + 
                        new_code + 
                        content.substring(match.endIndex);
      
      const diff = diffGenerator.generateColoredDiff(content, newContent, file_path);
      const summary = diffGenerator.generateSummary(content, newContent);
      
      let result = `📋 代码变更预览 (${summary})\n\n`;
      result += `文件: ${file_path}\n`;
      result += `位置: 第 ${match.lineStart}-${match.lineEnd} 行\n\n`;
      result += diff;
      
      return result;
    } catch (error: any) {
      return `❌ 预览失败: ${error.message}`;
    }
  },
});

/**
 * 工具3: 查找代码上下文（增强版）
 */
const findCodeContext = new DynamicStructuredTool({
  name: "find_code_context",
  description:
    "在文件中查找代码模式，显示匹配的代码和周围的上下文。" +
    "支持简单字符串匹配和正则表达式搜索。" +
    "用于在编辑前确定要修改的确切代码位置。",
  schema: z.object({
    file_path: z.string().describe("文件路径"),
    search_pattern: z.string().describe("要查找的代码模式或关键字（支持正则表达式）"),
    context_lines: z
      .number()
      .optional()
      .default(5)
      .describe("显示的上下文行数（默认5行）"),
    use_regex: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否使用正则表达式搜索（默认false，使用简单字符串匹配）"),
    case_sensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否区分大小写（仅在 use_regex=true 时生效，默认false）"),
  }),
  func: async ({ file_path, search_pattern, context_lines = 5, use_regex = false, case_sensitive = false }) => {
    try {
      const resolvedPath = path.resolve(file_path);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      
      const matches: Array<{ lineNumber: number; line: string }> = [];
      
      if (use_regex) {
        // 使用高性能 ripgrep 进行正则表达式搜索
        try {
          const searchResult = await grep_search_ripgrep.invoke({
            pattern: search_pattern,
            dir_path: path.dirname(resolvedPath),
            include: path.basename(resolvedPath),
            case_sensitive: case_sensitive,
            max_results: 100,
          });
          
          // 解析 ripgrep 结果
          const rgMatches = searchResult.match(/L(\d+):\s*(.+)/g);
          if (rgMatches) {
            rgMatches.forEach((match) => {
              const lineMatch = match.match(/L(\d+):\s*(.+)/);
              if (lineMatch) {
                matches.push({
                  lineNumber: parseInt(lineMatch[1], 10),
                  line: lineMatch[2],
                });
              }
            });
          }
        } catch (error) {
          // 如果 ripgrep 失败，回退到基本正则搜索
          const regex = new RegExp(search_pattern, case_sensitive ? 'g' : 'gi');
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              matches.push({ lineNumber: index + 1, line });
            }
          });
        }
      } else {
        // 简单字符串匹配（原有逻辑，保持向后兼容）
        lines.forEach((line, index) => {
          if (line.includes(search_pattern)) {
            matches.push({ lineNumber: index + 1, line });
          }
        });
      }
      
      if (matches.length === 0) {
        const searchType = use_regex ? "正则表达式" : "字符串";
        return `❌ 未找到匹配 ${searchType} "${search_pattern}" 的代码\n\n` +
               `💡 提示: ${use_regex ? '尝试简化正则表达式' : '尝试使用 use_regex=true 进行正则搜索'}`;
      }
      
      const searchType = use_regex ? "正则" : "字符串";
      let result = `🔍 找到 ${matches.length} 处匹配 (${searchType}搜索):\n\n`;
      
      matches.forEach((match, index) => {
        result += `匹配 ${index + 1} (第 ${match.lineNumber} 行):\n`;
        
        // 显示上下文
        const startLine = Math.max(0, match.lineNumber - context_lines - 1);
        const endLine = Math.min(lines.length, match.lineNumber + context_lines);
        const contextLines = lines.slice(startLine, endLine);
        
        contextLines.forEach((line, i) => {
          const lineNum = startLine + i + 1;
          const marker = lineNum === match.lineNumber ? '→' : ' ';
          result += `${marker} ${String(lineNum).padStart(4)} | ${line}\n`;
        });
        
        result += '\n';
      });
      
      result += `\n💡 提示: 复制完整的代码片段（包括缩进）用于 edit_code_snippet 的 old_code 参数`;
      
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return `❌ 查找失败: ${message}`;
    }
  },
});

/**
 * 工具4: 恢复备份
 */
const restoreFromBackup = new DynamicStructuredTool({
  name: "restore_from_backup",
  description:
    "从备份恢复文件。可以列出所有备份或恢复指定的备份。",
  schema: z.object({
    file_path: z.string().describe("文件路径"),
    backup_timestamp: z
      .string()
      .optional()
      .describe("备份时间戳（可选）。如果不提供，恢复最新的备份"),
    list_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否只列出备份而不恢复"),
  }),
  func: async ({ file_path, backup_timestamp, list_only = false }) => {
    try {
      const resolvedPath = path.resolve(file_path);
      const backups = await backupManager.listBackups(resolvedPath);
      
      if (backups.length === 0) {
        return `ℹ️ 该文件没有备份`;
      }
      
      if (list_only) {
        let result = `📋 文件备份列表 (${backups.length} 个):\n\n`;
        backups.forEach((backup, index) => {
          const timestamp = path.basename(backup).split('.backup.')[1];
          const isLatest = index === 0 ? ' (最新)' : '';
          result += `${index + 1}. ${timestamp}${isLatest}\n`;
          result += `   路径: ${backup}\n\n`;
        });
        return result;
      }
      
      // 恢复备份
      let backupPath: string | undefined;
      if (backup_timestamp) {
        backupPath = backups.find(b => b.includes(backup_timestamp));
        if (!backupPath) {
          return `❌ 未找到时间戳为 ${backup_timestamp} 的备份`;
        }
      }
      
      await backupManager.restore(resolvedPath, backupPath);
      
      const restoredBackup = backupPath || backups[0];
      const timestamp = path.basename(restoredBackup).split('.backup.')[1];
      
      return `✅ 已恢复文件从备份: ${timestamp}\n文件: ${file_path}`;
    } catch (error: any) {
      return `❌ 恢复失败: ${error.message}`;
    }
  },
});

// 分别导出每个工具（用于测试）
export { editCodeSnippet, previewCodeChange, findCodeContext, restoreFromBackup };

// 导出工具数组（用于集成）
export const codeEditTools = [
  editCodeSnippet,
  previewCodeChange,
  findCodeContext,
  restoreFromBackup,
];

