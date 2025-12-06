// 项目目录树工具：返回格式化的项目目录结构（可配置深度与过滤）
// 说明：本文件提供一个名为 `project_tree` 的工具，便于智能体或 CLI 查看仓库文件树。
// 注意：为了避免遍历过多无关文件，调用方应适当设置 `root_path`、`max_entries` 等参数。
import * as z from "zod";
import { tool } from "@langchain/core/tools";
import * as fs from "fs/promises";
import * as path from "path";

// 项目目录树工具：返回格式化的项目目录结构（可配置深度与过滤）
 const project_tree = tool(
  async ({
    // 根目录（相对或绝对路径），默认当前工作目录 '.'
    root_path = ".",
    // 最大遍历深度：0 或负数表示不限制深度（即显示完整树）
    max_depth = 0, // 0 or negative => unlimited
    // 是否包含隐藏文件/目录（以 '.' 开头），默认不包含
    include_hidden = false,
    // 是否在输出中包含文件（否则只列目录），默认包含
    include_files = true,
    // 最大条目数（避免一次性返回过多结果），默认 10000
    max_entries = 10000,
  }: {
    root_path?: string;
    max_depth?: number;
    include_hidden?: boolean;
    include_files?: boolean;
    max_entries?: number;
  }) => {
    const startPath = path.resolve(root_path);
    // 将结果行累积到此数组中，最后 join 返回
    const lines: string[] = [];
    // 计数已输出的条目数，用于与 max_entries 做比较
    let count = 0;

    const formatSize = (size: number) => {
      if (size < 1024) return `${size}B`;
      if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
      return `${Math.round(size / (1024 * 1024))}MB`;
    };

    // 递归遍历目录的深度优先算法，参数说明：
    // p: 当前目录路径
    // depth: 当前深度（从 1 开始计数）
    // prefix: 用于格式化树状结构的前缀字符串
    const walk = async (p: string, depth: number, prefix = "") => {
      // 超过最大条目限制则停止遍历，防止 OOM 或过大输出
      if (count >= max_entries) return;
      // 当 max_depth > 0 时才应用深度限制；max_depth <= 0 表示无限制
      if (max_depth > 0 && depth > max_depth) return;

      let entries: string[] = [];
      try {
        entries = await fs.readdir(p);
      } catch (err: any) {
        lines.push(`${prefix}❌ [error reading ${p}]: ${err.message}`);
        return;
      }

      // 按字母顺序排序以获得确定性输出
      entries.sort((a, b) => a.localeCompare(b));

      for (let i = 0; i < entries.length; i++) {
        if (count >= max_entries) break;
        const name = entries[i];
        // 跳过隐藏文件/目录（以 '.' 开头），除非用户要求包含
        if (!include_hidden && name.startsWith(".")) continue;

        const full = path.join(p, name);
        let stats;
        try {
          stats = await fs.stat(full);
        } catch (err: any) {
          lines.push(`${prefix}└─ ${name} [error: ${err.message}]`);
          count++;
          continue;
        }

        const isDir = stats.isDirectory();
        const connector = i === entries.length - 1 ? "└─" : "├─";
        if (isDir) {
          // 目录行（在名称后添加 '/' 以示区分）
          lines.push(`${prefix}${connector} ${name}/`);
          count++;
          // 递归遍历子目录
          await walk(full, depth + 1, prefix + (i === entries.length - 1 ? "   " : "│  "));
        } else if (include_files) {
          // 文件行，显示大小以便快速评估
          lines.push(`${prefix}${connector} ${name} (${formatSize(stats.size)})`);
          count++;
        }

          if (count >= max_entries) {
            // 当达到最大条目数时，输出截断提示并停止进一步遍历
            lines.push(`${prefix}... output truncated (max_entries=${max_entries})`);
            break;
          }
      }
    };

    try {
      // 确认起始路径存在且为目录
      const rootStats = await fs.stat(startPath);
      if (!rootStats.isDirectory()) {
        return `❌ Path is not a directory: ${startPath}`;
      }
      // 添加根目录行并开始遍历（初始深度 1）
      lines.push(`${startPath}/`);
      await walk(startPath, 1, "");
      return lines.join("\n");
    } catch (err: any) {
      // 更友好的错误信息：如果路径不存在则提示，否则返回通用错误
      if (err.code === "ENOENT") return `Directory not found: ${root_path}`;
      return `Error reading project tree: ${err.message}`;
    }
  },
  {
    name: "project_tree",
    description: "Return a formatted tree of the project directory. Supports depth and filtering options.",
    schema: z.object({
      root_path: z.string().optional().default('.').describe('Root path to start the tree from (default: current working directory).'),
      max_depth: z.number().optional().default(0).describe('Maximum recursion depth. Set to 0 (default) for unlimited.'),
      include_hidden: z.boolean().optional().default(false).describe('Include hidden files and directories.'),
      include_files: z.boolean().optional().default(true).describe('Whether to include files in the output.'),
      max_entries: z.number().optional().default(10000).describe('Maximum number of entries to return to avoid huge outputs.'),
    }),
  }
);

export const project_tree_tool = [project_tree];

// Also export the function directly for compatibility
export { project_tree };
