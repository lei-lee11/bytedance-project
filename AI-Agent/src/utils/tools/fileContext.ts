import { readFile, stat } from 'fs/promises';
import { resolve, relative, extname } from 'path';
import { detectLanguageFromExtension } from './languageConfig.js';

// 内部使用的文件信息接口
interface ReferencedFile {
  path: string;
  content: string;
  language?: string;
  size: number;
  lastModified: Date;
}

/**
 * 读取多个文件并返回格式化的文件信息
 * @param filePaths - 文件路径数组（相对或绝对路径）
 * @param projectRoot - 项目根目录，用于解析相对路径
 * @returns 文件信息数组
 */
export async function readReferencedFiles(
  filePaths: string[],
  projectRoot: string = process.cwd()
): Promise<ReferencedFile[]> {
  const results: ReferencedFile[] = [];

  for (const filePath of filePaths) {
    try {
      // 解析绝对路径
      const absolutePath = resolve(projectRoot, filePath);
      
      // 读取文件内容
      const content = await readFile(absolutePath, 'utf-8');
      
      // 获取文件信息
      const stats = await stat(absolutePath);
      
      // 检测语言类型
      const ext = extname(filePath);
      const language = detectLanguageFromExtension(ext) || undefined;
      
      // 获取相对路径（用于显示）
      const relativePath = relative(projectRoot, absolutePath);
      
      results.push({
        path: relativePath,
        content,
        language,
        size: stats.size,
        lastModified: stats.mtime,
      });
    } catch (error) {
      console.error(`Failed to read file ${filePath}:`, error);
      // 添加错误信息，但不中断整个流程
      results.push({
        path: filePath,
        content: `[Error: Cannot read file - ${(error as Error).message}]`,
        language: undefined,
        size: 0,
        lastModified: new Date(),
      });
    }
  }

  return results;
}

/**
 * 将文件列表格式化为适合注入到 prompt 的字符串
 * @param files - 文件信息数组
 * @returns 格式化的字符串
 */
export function formatFilesForContext(files: ReferencedFile[]): string {
  if (files.length === 0) {
    return '';
  }

  const sections = files.map((file, index) => {
    const languageTag = file.language ? ` (${file.language})` : '';
    const sizeKB = (file.size / 1024).toFixed(2);
    
    return `
### Referenced File ${index + 1}: \`${file.path}\`${languageTag}
Size: ${sizeKB} KB | Last Modified: ${file.lastModified.toLocaleString()}

\`\`\`${file.language || 'text'}
${file.content}
\`\`\`
`;
  });

  return `
## Referenced Files Context

The user has attached the following files as context for this conversation:

${sections.join('\n')}

Please consider these files when responding to the user's request.
`;
}

/**
 * 组合函数：读取并格式化文件
 * @param filePaths - 文件路径数组
 * @param projectRoot - 项目根目录
 * @returns 格式化的文件上下文字符串
 */
export async function attachFilesToContext(
  filePaths: string[],
  projectRoot?: string
): Promise<{ formattedContext: string }> {
  const files = await readReferencedFiles(filePaths, projectRoot);
  const formattedContext = formatFilesForContext(files);
  
  return {
    formattedContext,
  };
}

