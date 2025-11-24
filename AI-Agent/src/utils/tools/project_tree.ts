import * as z from "zod";
import { tool } from "@langchain/core/tools";
import fs from "fs/promises";
import path from "path";

export const project_tree = tool(
  async ({
    root_path = ".",
    max_depth = 3,
    include_hidden = false,
    include_files = true,
    max_entries = 1000,
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
      if (depth > max_depth) return;

      let entries: string[] = [];
      try {
        entries = await fs.readdir(p);
      } catch (err: any) {
        lines.push(`${prefix}❌ [error reading ${p}]: ${err.message}`);
        return;
      }

      entries.sort((a, b) => a.localeCompare(b));

      for (let i = 0; i < entries.length; i++) {
        if (count >= max_entries) break;
        const name = entries[i];
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
          lines.push(`${prefix}${connector} ${name}/`);
          count++;
          await walk(full, depth + 1, prefix + (i === entries.length - 1 ? "   " : "│  "));
        } else if (include_files) {
          lines.push(`${prefix}${connector} ${name} (${formatSize(stats.size)})`);
          count++;
        }

        if (count >= max_entries) {
          lines.push(`${prefix}... output truncated (max_entries=${max_entries})`);
          break;
        }
      }
    };

    try {
      const rootStats = await fs.stat(startPath);
      if (!rootStats.isDirectory()) {
        return `❌ Path is not a directory: ${startPath}`;
      }
      lines.push(`${startPath}/`);
      await walk(startPath, 1, "");
      return lines.join("\n");
    } catch (err: any) {
      if (err.code === "ENOENT") return `Directory not found: ${root_path}`;
      return `Error reading project tree: ${err.message}`;
    }
  },
  {
    name: "project_tree",
    description: "Return a formatted tree of the project directory. Supports depth and filtering options.",
    schema: z.object({
      root_path: z.string().optional().default('.').describe('Root path to start the tree from (default: current working directory).'),
      max_depth: z.number().optional().default(3).describe('Maximum recursion depth.'),
      include_hidden: z.boolean().optional().default(false).describe('Include hidden files and directories.'),
      include_files: z.boolean().optional().default(true).describe('Whether to include files in the output.'),
      max_entries: z.number().optional().default(1000).describe('Maximum number of entries to return to avoid huge outputs.'),
    }),
  }
);

export default project_tree;
