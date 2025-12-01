import * as z from "zod";
import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import fs from "fs/promises";
import path from "path";

interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
  filePath: string;
}

/**
 * 从 tool 调用的 config 中获取 projectRoot。
 * 要求由上层（graph/state）通过 config.configurable.projectRoot 传入。
 */
function getProjectRoot(config?: RunnableConfig): string {
  const projectRoot = (config?.configurable as any)?.projectRoot as
    | string
    | undefined;

  // 强制使用默认项目根目录（用户要求）
  if (!projectRoot || typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    const forced = 'C:\\projects\\playground';
    console.warn(`projectRoot 未设置，强制使用默认根目录：${forced}`);
    return path.resolve(forced);
  }

  return path.resolve(projectRoot);
}

/**
 * 在 projectRoot 下解析一个安全的绝对路径，并防止路径逃逸（如 ../）
 */
function resolveProjectPath(inputPath: string, config?: RunnableConfig): string {
  const base = getProjectRoot(config);
  const raw = inputPath.trim();

  // 绝对路径就直接 normalize，相对路径则基于 projectRoot
  const candidate = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.normalize(path.join(base, raw));

  // 防止逃逸：如果相对 base 的相对路径以 .. 开头，说明跳出去了
  const rel = path.relative(base, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Illegal path outside projectRoot: "${raw}". ` +
        `Resolved to "${candidate}" (base: "${base}")`
    );
  }

  return candidate;
}

/**
 * 读取多个文件内容，支持路径验证、错误处理和内容格式化
 */
const read_files = tool(
  async (
    { file_paths }: { file_paths: string[] },
    config?: RunnableConfig
  ) => {
    const results: FileReadResult[] = [];

    for (const filePath of file_paths) {
      try {
        const resolvedPath = resolveProjectPath(filePath, config);

        // 检查文件是否存在
        await fs.access(resolvedPath);

        // 获取文件统计信息
        const stats = await fs.stat(resolvedPath);

        // 检查是否为文件而非目录
        if (!stats.isFile()) {
          results.push({
            success: false,
            error: `Path is not a file: ${resolvedPath}`,
            filePath,
          });
          continue;
        }

        // 检查文件大小（限制读取大文件）
        const maxFileSize = 10 * 1024 * 1024; // 10MB
        if (stats.size > maxFileSize) {
          results.push({
            success: false,
            error: `File too large (${stats.size} bytes > ${maxFileSize} bytes): ${resolvedPath}`,
            filePath,
          });
          continue;
        }

        // 读取文件内容
        const content = await fs.readFile(resolvedPath, "utf-8");

        results.push({
          success: true,
          content,
          filePath: resolvedPath,
        });
      } catch (error: any) {
        let errorMessage = `Error reading file: ${filePath}`;

        if (error?.code === "ENOENT") {
          errorMessage = `File not found: ${filePath}`;
        } else if (error?.code === "EACCES") {
          errorMessage = `Permission denied: ${filePath}`;
        } else if (error?.code === "EISDIR") {
          errorMessage = `Path is a directory, not a file: ${filePath}`;
        } else if (error?.message?.includes("projectRoot is not set")) {
          errorMessage = error.message;
        } else {
          errorMessage = `${errorMessage} - ${error?.message ?? String(error)}`;
        }

        results.push({
          success: false,
          error: errorMessage,
          filePath,
        });
      }
    }

    // 返回格式化的结果
    const successfulReads = results.filter((r) => r.success);
    const failedReads = results.filter((r) => !r.success);

    let responseText = "";

    if (successfulReads.length > 0) {
      responseText += `Successfully read ${successfulReads.length} file(s):\n\n`;
      for (const result of successfulReads) {
        responseText += `File: ${result.filePath}\n`;
        responseText += `Content:\n${result.content}\n\n`;
        responseText += "=".repeat(50) + "\n\n";
      }
    }

    if (failedReads.length > 0) {
      responseText += `Failed to read ${failedReads.length} file(s):\n\n`;
      for (const result of failedReads) {
        responseText += `File: ${result.filePath}\n`;
        responseText += `Error: ${result.error}\n\n`;
      }
    }

    return responseText.trim();
  },
  {
    name: "read_files",
    description:
      "Reads the contents of multiple files from the specified file paths under the project root. " +
      "Returns detailed information about which files were read successfully and any errors encountered.",
    schema: z.object({
      file_paths: z
        .array(z.string())
        .min(1, "At least one file path must be provided")
        .max(20, "Cannot read more than 20 files at once")
        .describe(
          "An array of file paths to read. Paths must be inside the project root. " +
            'Use relative paths like "src/app.ts" or "tests/app.test.ts".'
        ),
    }),
  }
);

/**
 * 检查文件或目录是否存在，并返回基本信息（类型、大小、修改时间等）
 */
const file_exists = tool(
  async (
    { file_path }: { file_path: string },
    config?: RunnableConfig
  ) => {
    try {
      const resolvedPath = resolveProjectPath(file_path, config);
      await fs.access(resolvedPath);
      const stats = await fs.stat(resolvedPath);

      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        lastModified: stats.mtime.toISOString(),
        path: resolvedPath,
      };
    } catch (error: any) {
      // 如果是 projectRoot 未设置的错误，也直接抛出去信息
      if (error?.message?.includes("projectRoot is not set")) {
        return {
          exists: false,
          error: error.message,
          path: file_path,
        };
      }

      return {
        exists: false,
        path: file_path,
      };
    }
  },
  {
    name: "file_exists",
    description:
      "Check if a file or directory exists under the project root and get its basic information.",
    schema: z.object({
      file_path: z
        .string()
        .describe(
          "Path to the file or directory to check (relative to the project root)."
        ),
    }),
  }
);

/**
 * 列出目录内容，显示文件和子目录，支持隐藏文件过滤
 */
const list_directory = tool(
  async (
    {
      directory_path,
      include_hidden = false,
    }: { directory_path: string; include_hidden?: boolean },
    config?: RunnableConfig
  ) => {
    try {
      const resolvedPath = resolveProjectPath(directory_path, config);
      const stats = await fs.stat(resolvedPath);

      if (!stats.isDirectory()) {
        return `❌ Error: Path is not a directory: ${resolvedPath}`;
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

      let result = `Directory listing for: ${resolvedPath}\n\n`;

      const files: { name: string; size: number; isDir: boolean }[] = [];
      const dirs: { name: string; size: number; isDir: boolean }[] = [];

      for (const entry of entries) {
        const isHidden = entry.name.startsWith(".");
        if (!include_hidden && isHidden) continue;

        const entryPath = path.join(resolvedPath, entry.name);
        const entryStats = await fs.stat(entryPath);

        const fileInfo = {
          name: entry.name,
          size: entryStats.size,
          isDir: entry.isDirectory(),
        };

        if (entry.isDirectory()) {
          dirs.push(fileInfo);
        } else {
          files.push(fileInfo);
        }
      }

      // 按字母顺序排序
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      // 显示目录
      if (dirs.length > 0) {
        result += "Directories:\n";
        for (const dir of dirs) {
          result += `  📁 ${dir.name}/\n`;
        }
        result += "\n";
      }

      // 显示文件
      if (files.length > 0) {
        result += "Files:\n";
        for (const file of files) {
          const sizeStr =
            file.size < 1024
              ? `${file.size}B`
              : file.size < 1024 * 1024
              ? `${Math.round(file.size / 1024)}KB`
              : `${Math.round(file.size / (1024 * 1024))}MB`;
          result += `  📄 ${file.name} (${sizeStr})\n`;
        }
      }

      if (dirs.length === 0 && files.length === 0) {
        result += "Directory is empty";
      }

      return result;
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return `Directory not found: ${directory_path}`;
      } else if (error?.code === "EACCES") {
        return `Permission denied: ${directory_path}`;
      } else if (error?.message?.includes("projectRoot is not set")) {
        return `Error: ${error.message}`;
      }
      return `Error listing directory: ${error.message}`;
    }
  },
  {
    name: "list_directory",
    description:
      "List contents of a directory under the project root, showing files and subdirectories with their sizes.",
    schema: z.object({
      directory_path: z
        .string()
        .describe(
          "Path to the directory to list (relative to the project root)."
        ),
      include_hidden: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to include hidden files and directories (starting with .)."
        ),
    }),
  }
);

/**
 * write_file : 写入文件内容，支持自动创建目录、备份现有文件和内容验证
 */
const write_file = tool(
  async (
    {
      file_path,
      content,
      create_directories = true,
    }: { file_path: string; content: string; create_directories?: boolean },
    config?: RunnableConfig
  ) => {
    try {
      const resolvedPath = resolveProjectPath(file_path, config);

      // 检查内容大小（防止写入过大的文件）
      const contentSize = Buffer.byteLength(content, "utf8");
      const maxFileSize = 10 * 1024 * 1024; // 10MB

      if (contentSize > maxFileSize) {
        return `❌ Error: Content too large (${contentSize} bytes > ${maxFileSize} bytes). File writing aborted for: ${resolvedPath}`;
      }

      // 获取目录路径
      const dirPath = path.dirname(resolvedPath);

      // 如果需要且目录不存在，创建目录
      if (create_directories) {
        try {
          await fs.access(dirPath);
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            await fs.mkdir(dirPath, { recursive: true });
          } else {
            throw error;
          }
        }
      } else {
        // 如果不创建目录，检查目录是否存在
        try {
          await fs.access(dirPath);
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            return `❌ Error: Directory does not exist and create_directories is false: ${dirPath}`;
          }
          throw error;
        }
      }

      // 检查路径是否指向目录（不应该覆盖目录）
      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          return `❌ Error: Path points to a directory, not a file: ${resolvedPath}`;
        }
      } catch (error: any) {
        // 文件不存在是正常的，继续执行
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      // 备份现有文件（如果存在）
      let backupPath = "";
      try {
        await fs.access(resolvedPath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const ext = path.extname(resolvedPath);
        const nameWithoutExt =
          ext.length > 0
            ? resolvedPath.slice(0, -ext.length)
            : resolvedPath;
        backupPath = `${nameWithoutExt}.backup.${timestamp}${ext}`;
        await fs.copyFile(resolvedPath, backupPath);
      } catch (error: any) {
        // 文件不存在，不需要备份
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      // 写入文件
      await fs.writeFile(resolvedPath, content, "utf-8");

      // 验证文件是否成功写入
      const verifyStats = await fs.stat(resolvedPath);
      const verifyContent = await fs.readFile(resolvedPath, "utf-8");

      if (verifyContent !== content) {
        return `❌ Error: File content verification failed for: ${resolvedPath}`;
      }

      let responseMessage = `✅ File written successfully: ${resolvedPath}\n`;
      responseMessage += `📊 Size: ${verifyStats.size} bytes\n`;
      responseMessage += `📅 Modified: ${verifyStats.mtime.toISOString()}`;

      if (backupPath) {
        responseMessage += `\n💾 Backup created: ${backupPath}`;
      }

      return responseMessage;
    } catch (error: any) {
      let errorMessage = `Error writing file: ${file_path}`;

      if (error?.code === "EACCES") {
        errorMessage = `Permission denied: ${file_path}`;
      } else if (error?.code === "EISDIR") {
        errorMessage = `Path is a directory, not a file: ${file_path}`;
      } else if (error?.code === "ENOSPC") {
        errorMessage = `No space left on device: ${file_path}`;
      } else if (error?.code === "EROFS") {
        errorMessage = `Read-only file system: ${file_path}`;
      } else if (error?.message?.includes("projectRoot is not set")) {
        errorMessage = error.message;
      } else {
        errorMessage = `${errorMessage} - ${error?.message ?? String(error)}`;
      }

      return `❌ ${errorMessage}`;
    }
  },
  {
    name: "write_file",
    description:
      "Writes content to a specified file under the project root. Overwrites the file if it already exists. " +
      "Automatically creates parent directories if needed. " +
      "Creates backups of existing files with timestamp. " +
      "Includes content verification after writing. " +
      "Caution: This operation will replace all existing content in the file.",
    schema: z.object({
      file_path: z
        .string()
        .min(1, "File path cannot be empty")
        .describe(
          "The path to the file (relative to the project root) where content will be written. " +
            'Example: "src/app.ts" or "tests/app.test.ts".'
        ),
      content: z
        .string()
        .max(10 * 1024 * 1024, "Content too large (max 10MB)")
        .describe(
          "The content to write to the file (can be text, JSON string, code, etc.)."
        ),
      create_directories: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether to create parent directories if they don't exist. " +
            "Default: true. Set to false to require directories to exist."
        ),
    }),
  }
);

/**
 * 向文件追加内容，提供与 write_file 类似的安全检查
 */
const append_to_file = tool(
  async (
    {
      file_path,
      content,
      create_directories = true,
    }: { file_path: string; content: string; create_directories?: boolean },
    config?: RunnableConfig
  ) => {
    try {
      const resolvedPath = resolveProjectPath(file_path, config);

      // 检查内容大小
      const contentSize = Buffer.byteLength(content, "utf8");
      const maxFileSize = 10 * 1024 * 1024; // 10MB per append operation

      if (contentSize > maxFileSize) {
        return `❌ Error: Content too large (${contentSize} bytes > ${maxFileSize} bytes). Append operation aborted for: ${resolvedPath}`;
      }

      const dirPath = path.dirname(resolvedPath);

      // 如果需要且目录不存在，创建目录
      if (create_directories) {
        try {
          await fs.access(dirPath);
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            await fs.mkdir(dirPath, { recursive: true });
          } else {
            throw error;
          }
        }
      } else {
        // 如果不创建目录，检查目录是否存在
        try {
          await fs.access(dirPath);
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            return `❌ Error: Directory does not exist and create_directories is false: ${dirPath}`;
          }
          throw error;
        }
      }

      // 检查文件是否为目录 & 尺寸
      try {
        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
          return `❌ Error: Path points to a directory, not a file: ${resolvedPath}`;
        }

        if (stats.size + contentSize > maxFileSize * 2) {
          return `❌ Error: File would become too large after append (${stats.size + contentSize} bytes > ${
            maxFileSize * 2
          } bytes): ${resolvedPath}`;
        }
      } catch (error: any) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
        // 文件不存在时，直接创建即可
      }

      // 追加内容到文件
      await fs.appendFile(resolvedPath, content, "utf-8");

      // 获取更新后的文件信息
      const stats = await fs.stat(resolvedPath);

      let responseMessage = `✅ Content appended successfully: ${resolvedPath}\n`;
      responseMessage += `📊 New file size: ${stats.size} bytes\n`;
      responseMessage += `📅 Modified: ${stats.mtime.toISOString()}\n`;
      responseMessage += `📝 Appended content length: ${contentSize} bytes`;

      return responseMessage;
    } catch (error: any) {
      let errorMessage = `Error appending to file: ${file_path}`;

      if (error?.code === "EACCES") {
        errorMessage = `Permission denied: ${file_path}`;
      } else if (error?.code === "EISDIR") {
        errorMessage = `Path is a directory, not a file: ${file_path}`;
      } else if (error?.code === "ENOSPC") {
        errorMessage = `No space left on device: ${file_path}`;
      } else if (error?.message?.includes("projectRoot is not set")) {
        errorMessage = error.message;
      } else {
        errorMessage = `${errorMessage} - ${error?.message ?? String(error)}`;
      }

      return `❌ ${errorMessage}`;
    }
  },
  {
    name: "append_to_file",
    description:
      "Appends content to the end of a specified file under the project root. " +
      "Creates the file if it doesn't exist. Automatically creates parent directories if needed. " +
      "Includes file size validation to prevent overly large files.",
    schema: z.object({
      file_path: z
        .string()
        .min(1, "File path cannot be empty")
        .describe(
          "The path to the file (relative to the project root) where content will be appended. " +
            'Example: "logs/app.log" or "src/debug.log".'
        ),
      content: z
        .string()
        .max(10 * 1024 * 1024, "Content too large (max 10MB per append)")
        .describe("The content to append to the file."),
      create_directories: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether to create parent directories if they don't exist. " +
            "Default: true. Set to false to require directories to exist."
        ),
    }),
  }
);

export const file_operations = [
  read_files,
  file_exists,
  list_directory,
  append_to_file,
  write_file,
];

export { read_files, file_exists, list_directory, write_file, append_to_file };
