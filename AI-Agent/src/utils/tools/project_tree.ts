// 项目目录树工具：返回格式化的项目目录结构（可配置深度与过滤）
// 说明：本文件提供一个名为 `project_tree` 的工具，便于智能体或 CLI 查看仓库文件树。
// 注意：为了避免遍历过多无关文件，调用方应适当设置 `root_path`、`max_entries` 等参数。
import * as z from "zod";
import { tool } from "@langchain/core/tools";
import * as fs from "fs/promises";
import * as path from "path";

// 默认忽略的目录列表，防止 token 爆炸
const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "coverage",
  "langgraph-storage",
  "__pycache__",
];

// 项目目录树工具：返回格式化的项目目录结构（可配置深度与过滤）
const project_tree = tool(
  async ({
    root_path = ".",
    max_depth = 0, // 0 or negative => unlimited
    include_hidden = false,
    include_files = true,
    max_entries = 10000,
  }: {
    root_path?: string;
    max_depth?: number;
    include_hidden?: boolean;
    include_files?: boolean;
    max_entries?: number;
  }) => {
    const startPath = path.resolve(root_path);
    const lines: string[] = [];
    let count = 0;

    const formatSize = (size: number) => {
      if (size < 1024) return `${size}B`;
      if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
      return `${Math.round(size / (1024 * 1024))}MB`;
    };

    const walk = async (p: string, depth: number, prefix = "") => {
      if (count >= max_entries) return;
      if (max_depth > 0 && depth > max_depth) return;

      let entries: string[] = [];
      try {
        entries = await fs.readdir(p);
      } catch (err: any) {
        lines.push(`${prefix}❌ [error reading ${path.basename(p)}]: ${err.message}`);
        return;
      }

      // 🔥 1. 先过滤，再排序，确保画线逻辑正确
      const filteredEntries = [];
      for (const name of entries) {
        // 过滤隐藏文件
        if (!include_hidden && name.startsWith(".")) continue;
        // 过滤常见的巨大文件夹（无论是否隐藏）
        if (DEFAULT_IGNORE.includes(name)) continue;
        
        filteredEntries.push(name);
      }

      // 按字母顺序排序：文件夹优先，然后是文件（可选优化，这里保持简单字母序）
      filteredEntries.sort((a, b) => a.localeCompare(b));

      for (let i = 0; i < filteredEntries.length; i++) {
        if (count >= max_entries) break;
        
        const name = filteredEntries[i];
        const full = path.join(p, name);
        let stats;
        try {
          stats = await fs.stat(full);
        } catch (err: any) {
          // 即使出错也占一个位，保持树形结构完整
          const connector = i === filteredEntries.length - 1 ? "└─" : "├─";
          lines.push(`${prefix}${connector} ${name} [error: ${err.message}]`);
          count++;
          continue;
        }

        const isDir = stats.isDirectory();
        // 🔥 2. 使用 filteredEntries 的长度来判断连接符
        const isLast = i === filteredEntries.length - 1;
        const connector = isLast ? "└─" : "├─";

        if (isDir) {
          lines.push(`${prefix}${connector} ${name}/`);
          count++;
          // 递归
          await walk(full, depth + 1, prefix + (isLast ? "   " : "│  "));
        } else if (include_files) {
          lines.push(`${prefix}${connector} ${name} (${formatSize(stats.size)})`);
          count++;
        }
        
        if (count >= max_entries) {
            lines.push(`${prefix}... (truncated max_entries)`);
            break;
        }
      }
    };

    try {
      const rootStats = await fs.stat(startPath);
      if (!rootStats.isDirectory()) {
        return `❌ Path is not a directory: ${startPath}`;
      }
      
      // 显示根目录名称而不是绝对路径，更简洁
      lines.push(`${path.basename(startPath)}/`);
      
      await walk(startPath, 1, "");
      
      if (count >= max_entries) {
        lines.push(`
⚠️ Output truncated: exceeded ${max_entries} entries.`);
      }
      
      return lines.join("\n");
    } catch (err: any) {
      if (err.code === "ENOENT") return `Directory not found: ${root_path}`;
      return `Error reading project tree: ${err.message}`;
    }
  },
  {
    name: "project_tree",
    description: "Return a formatted tree of the project directory. Automatically ignores node_modules, .git, and other large directories.",
    schema: z.object({
      root_path: z.string().optional().default('.').describe('Root path to start the tree from (default: current working directory).'),
      max_depth: z.number().optional().default(0).describe('Maximum recursion depth. Set to 0 (default) for unlimited.'),
      include_hidden: z.boolean().optional().default(false).describe('Include hidden files and directories (starts with .).'),
      include_files: z.boolean().optional().default(true).describe('Whether to include files in the output.'),
      max_entries: z.number().optional().default(10000).describe('Maximum number of entries to return.'),
    }),
  }
);

export const project_tree_tool = [project_tree];
export { project_tree };
