import * as z from "zod"
import { tool } from "@langchain/core/tools"
import fs from 'fs/promises'
import path from 'path'

interface FileReadResult {
    success: boolean;
    content?: string;
    error?: string;
    filePath: string;
}

export const read_files = tool(
    async ({ file_paths }: { file_paths: string[] }) => {
        const results: FileReadResult[] = [];

        for (const filePath of file_paths) {
            try {
                // 解析文件路径
                const resolvedPath = path.resolve(filePath);

                // 检查文件是否存在
                await fs.access(resolvedPath);

                // 获取文件统计信息
                const stats = await fs.stat(resolvedPath);

                // 检查是否为文件而非目录
                if (!stats.isFile()) {
                    results.push({
                        success: false,
                        error: `Path is not a file: ${resolvedPath}`,
                        filePath
                    });
                    continue;
                }

                // 检查文件大小（限制读取大文件）
                const maxFileSize = 10 * 1024 * 1024; // 10MB
                if (stats.size > maxFileSize) {
                    results.push({
                        success: false,
                        error: `File too large (${stats.size} bytes > ${maxFileSize} bytes): ${resolvedPath}`,
                        filePath
                    });
                    continue;
                }

                // 读取文件内容
                const content = await fs.readFile(resolvedPath, 'utf-8');

                results.push({
                    success: true,
                    content,
                    filePath: resolvedPath
                });

            } catch (error: any) {
                let errorMessage = `Error reading file: ${filePath}`;

                if (error.code === 'ENOENT') {
                    errorMessage = `File not found: ${filePath}`;
                } else if (error.code === 'EACCES') {
                    errorMessage = `Permission denied: ${filePath}`;
                } else if (error.code === 'EISDIR') {
                    errorMessage = `Path is a directory, not a file: ${filePath}`;
                } else {
                    errorMessage = `${errorMessage} - ${error.message}`;
                }

                results.push({
                    success: false,
                    error: errorMessage,
                    filePath
                });
            }
        }

        // 返回格式化的结果
        const successfulReads = results.filter(r => r.success);
        const failedReads = results.filter(r => !r.success);

        let responseText = '';

        if (successfulReads.length > 0) {
            responseText += `Successfully read ${successfulReads.length} file(s):\n\n`;
            for (const result of successfulReads) {
                responseText += `File: ${result.filePath}\n`;
                responseText += `Content:\n${result.content}\n\n`;
                responseText += '=' .repeat(50) + '\n\n';
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
        description: "Reads the contents of multiple files from the specified file paths. Returns detailed information about which files were read successfully and any errors encountered. Supports common programming files and handles various error conditions.",
        schema: z.object({
            file_paths: z.array(z.string())
                .min(1, "At least one file path must be provided")
                .max(20, "Cannot read more than 20 files at once")
                .describe("An array of file paths to read. Can be absolute paths or relative paths. Example: [\"src/app.ts\", \"/etc/config.json\", \"./docs/readme.md\"]")
        }),
    }
);

// 额外的文件操作工具
export const file_exists = tool(
    async ({ file_path }: { file_path: string }) => {
        try {
            const resolvedPath = path.resolve(file_path);
            await fs.access(resolvedPath);
            const stats = await fs.stat(resolvedPath);

            return {
                exists: true,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                size: stats.size,
                lastModified: stats.mtime.toISOString(),
                path: resolvedPath
            };
        } catch (error) {
            return {
                exists: false,
                path: path.resolve(file_path)
            };
        }
    },
    {
        name: "file_exists",
        description: "Check if a file or directory exists and get its basic information.",
        schema: z.object({
            file_path: z.string().describe("Path to the file or directory to check")
        })
    }
);

export const list_directory = tool(
    async ({ directory_path, include_hidden = false }: { directory_path: string; include_hidden?: boolean }) => {
        try {
            const resolvedPath = path.resolve(directory_path);
            const stats = await fs.stat(resolvedPath);

            if (!stats.isDirectory()) {
                return `❌ Error: Path is not a directory: ${resolvedPath}`;
            }

            const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

            let result = `Directory listing for: ${resolvedPath}\n\n`;

            const files: { name: string; size: number; isDir: boolean }[] = [];
            const dirs: { name: string; size: number; isDir: boolean }[] = [];

            for (const entry of entries) {
                const isHidden = entry.name.startsWith('.');
                if (!include_hidden && isHidden) continue;

                const entryPath = path.join(resolvedPath, entry.name);
                const entryStats = await fs.stat(entryPath);

                const fileInfo = {
                    name: entry.name,
                    size: entryStats.size,
                    isDir: entry.isDirectory()
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
                    const sizeStr = file.size < 1024 ? `${file.size}B` :
                                   file.size < 1024 * 1024 ? `${Math.round(file.size/1024)}KB` :
                                   `${Math.round(file.size/(1024*1024))}MB`;
                    result += `  📄 ${file.name} (${sizeStr})\n`;
                }
            }

            if (dirs.length === 0 && files.length === 0) {
                result += "Directory is empty";
            }

            return result;

        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return `Directory not found: ${directory_path}`;
            } else if (error.code === 'EACCES') {
                return `Permission denied: ${directory_path}`;
            }
            return `Error listing directory: ${error.message}`;
        }
    },
    {
        name: "list_directory",
        description: "List contents of a directory, showing files and subdirectories with their sizes.",
        schema: z.object({
            directory_path: z.string().describe("Path to the directory to list"),
            include_hidden: z.boolean().optional().default(false).describe("Whether to include hidden files and directories (starting with .)")
        })
    }
);

export const write_file = tool(
    async ({ file_path, content, create_directories = true }: { file_path: string; content: string; create_directories?: boolean }) => {
        try {
            // 解析文件路径
            const resolvedPath = path.resolve(file_path);

            // 检查内容大小（防止写入过大的文件）
            const contentSize = Buffer.byteLength(content, 'utf8');
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
                    if (error.code === 'ENOENT') {
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
                    if (error.code === 'ENOENT') {
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
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }

            // 备份现有文件（如果存在）
            let backupPath = '';
            try {
                await fs.access(resolvedPath);
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const ext = path.extname(resolvedPath);
                const nameWithoutExt = resolvedPath.slice(0, -ext.length) || resolvedPath;
                backupPath = `${nameWithoutExt}.backup.${timestamp}${ext}`;
                await fs.copyFile(resolvedPath, backupPath);
            } catch (error: any) {
                // 文件不存在，不需要备份
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }

            // 写入文件
            await fs.writeFile(resolvedPath, content, 'utf-8');

            // 验证文件是否成功写入
            const verifyStats = await fs.stat(resolvedPath);
            const verifyContent = await fs.readFile(resolvedPath, 'utf-8');

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

            if (error.code === 'EACCES') {
                errorMessage = `Permission denied: ${file_path}`;
            } else if (error.code === 'EISDIR') {
                errorMessage = `Path is a directory, not a file: ${file_path}`;
            } else if (error.code === 'ENOSPC') {
                errorMessage = `No space left on device: ${file_path}`;
            } else if (error.code === 'EROFS') {
                errorMessage = `Read-only file system: ${file_path}`;
            } else {
                errorMessage = `${errorMessage} - ${error.message}`;
            }

            return `❌ ${errorMessage}`;
        }
    },
    {
        name: "write_file",
        description:
            "Writes content to a specified file. Overwrites the file if it already exists. " +
            "Automatically creates parent directories if needed. " +
            "Creates backups of existing files with timestamp. " +
            "Includes content verification after writing. " +
            "Caution: This operation will replace all existing content in the file.",
        schema: z.object({
            file_path: z.string()
                .min(1, "File path cannot be empty")
                .describe(
                    "The path to the file (absolute or relative) where content will be written. " +
                    "Example: '/home/user/docs/report.txt' or './data/config.json'"
                ),
            content: z.string()
                .max(10 * 1024 * 1024, "Content too large (max 10MB)")
                .describe(
                    "The content to write to the file (can be text, JSON string, code, etc.). " +
                    "Example: 'Hello World!' or '{\"key\": \"value\"}'"
                ),
            create_directories: z.boolean()
                .optional()
                .default(true)
                .describe(
                    "Whether to create parent directories if they don't exist. " +
                    "Default: true. Set to false to require directories to exist."
                ),
        }),
    }
);

export const append_to_file = tool(
    async ({ file_path, content, create_directories = true }: { file_path: string; content: string; create_directories?: boolean }) => {
        try {
            // 解析文件路径
            const resolvedPath = path.resolve(file_path);

            // 检查内容大小
            const contentSize = Buffer.byteLength(content, 'utf8');
            const maxFileSize = 10 * 1024 * 1024; // 10MB per append operation

            if (contentSize > maxFileSize) {
                return `❌ Error: Content too large (${contentSize} bytes > ${maxFileSize} bytes). Append operation aborted for: ${resolvedPath}`;
            }

            // 获取目录路径
            const dirPath = path.dirname(resolvedPath);

            // 如果需要且目录不存在，创建目录
            if (create_directories) {
                try {
                    await fs.access(dirPath);
                } catch (error: any) {
                    if (error.code === 'ENOENT') {
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
                    if (error.code === 'ENOENT') {
                        return `❌ Error: Directory does not exist and create_directories is false: ${dirPath}`;
                    }
                    throw error;
                }
            }

            // 检查文件是否为目录
            try {
                const stats = await fs.stat(resolvedPath);
                if (stats.isDirectory()) {
                    return `❌ Error: Path points to a directory, not a file: ${resolvedPath}`;
                }

                // 检查文件追加后的大小
                if (stats.size + contentSize > maxFileSize * 2) { // Allow 20MB total
                    return `❌ Error: File would become too large after append (${stats.size + contentSize} bytes > ${maxFileSize * 2} bytes): ${resolvedPath}`;
                }
            } catch (error: any) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }

            // 追加内容到文件
            await fs.appendFile(resolvedPath, content, 'utf-8');

            // 获取更新后的文件信息
            const stats = await fs.stat(resolvedPath);

            let responseMessage = `✅ Content appended successfully: ${resolvedPath}\n`;
            responseMessage += `📊 New file size: ${stats.size} bytes\n`;
            responseMessage += `📅 Modified: ${stats.mtime.toISOString()}\n`;
            responseMessage += `📝 Appended content length: ${contentSize} bytes`;

            return responseMessage;

        } catch (error: any) {
            let errorMessage = `Error appending to file: ${file_path}`;

            if (error.code === 'EACCES') {
                errorMessage = `Permission denied: ${file_path}`;
            } else if (error.code === 'EISDIR') {
                errorMessage = `Path is a directory, not a file: ${file_path}`;
            } else if (error.code === 'ENOSPC') {
                errorMessage = `No space left on device: ${file_path}`;
            } else {
                errorMessage = `${errorMessage} - ${error.message}`;
            }

            return `❌ ${errorMessage}`;
        }
    },
    {
        name: "append_to_file",
        description:
            "Appends content to the end of a specified file. Creates the file if it doesn't exist. " +
            "Automatically creates parent directories if needed. " +
            "Includes file size validation to prevent overly large files.",
        schema: z.object({
            file_path: z.string()
                .min(1, "File path cannot be empty")
                .describe(
                    "The path to the file (absolute or relative) where content will be appended. " +
                    "Example: '/home/user/docs/report.txt' or './data/logs/app.log'"
                ),
            content: z.string()
                .max(10 * 1024 * 1024, "Content too large (max 10MB per append)")
                .describe(
                    "The content to append to the file. " +
                    "Example: 'Log entry: User logged in at ' + new Date().toISOString()"
                ),
            create_directories: z.boolean()
                .optional()
                .default(true)
                .describe(
                    "Whether to create parent directories if they don't exist. " +
                    "Default: true. Set to false to require directories to exist."
                ),
        }),
    }
);

