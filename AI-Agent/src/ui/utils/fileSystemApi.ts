import fs from 'fs/promises';
import path from 'path';

export interface FileSystemItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

// 简单缓存实现
interface CacheEntry {
  items: FileSystemItem[];
  timestamp: number;
}

const directoryCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000; // 5秒缓存

/**
 * 获取指定目录下的所有子项（文件和文件夹）
 * @param dirPath - 目录路径（相对于项目根目录）
 * @param projectRoot - 项目根目录
 * @param useCache - 是否使用缓存
 * @returns 文件和文件夹列表
 */
export async function listDirectory(
  dirPath = '',
  projectRoot = process.cwd(),
  useCache = true
): Promise<FileSystemItem[]> {
  const cacheKey = `${projectRoot}:${dirPath}`;
  
  // 检查缓存
  if (useCache) {
    const cached = directoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.items;
    }
  }
  
  try {
    const fullPath = path.join(projectRoot, dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    
    // 过滤掉隐藏文件和常见的忽略目录
    const filtered = entries.filter(entry => {
      const name = entry.name;
      // 忽略隐藏文件（以 . 开头）
      if (name.startsWith('.')) return false;
      // 忽略常见的构建和依赖目录
      if (name === 'node_modules') return false;
      if (name === 'dist') return false;
      if (name === 'build') return false;
      if (name === 'coverage') return false;
      if (name === '__pycache__') return false;
      return true;
    });
    
    // 转换为统一格式
    const items: FileSystemItem[] = filtered.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name).replace(/\\/g, '/'), // 统一使用正斜杠
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
    
    // 排序：目录在前，文件在后，同类按字母排序
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    // 更新缓存
    directoryCache.set(cacheKey, {
      items,
      timestamp: Date.now(),
    });
    
    return items;
  } catch (error) {
    console.error(`Failed to list directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * 检查路径是否为目录
 * @param filePath - 文件路径
 * @param projectRoot - 项目根目录
 * @returns 是否为目录
 */
export async function isDirectory(
  filePath: string,
  projectRoot = process.cwd()
): Promise<boolean> {
  try {
    const fullPath = path.join(projectRoot, filePath);
    const stats = await fs.stat(fullPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 智能搜索文件（支持层级浏览）
 * @param query - 搜索查询（如 "src/agent" 或 "agent"）
 * @param projectRoot - 项目根目录
 * @returns 匹配的文件列表
 */
export async function searchFiles(
  query: string,
  projectRoot = process.cwd()
): Promise<FileSystemItem[]> {
  // 标准化路径（统一使用正斜杠）
  const normalizedQuery = query.replace(/\\/g, '/');
  
  // 解析查询路径
  const lastSlashIndex = normalizedQuery.lastIndexOf('/');
  
  if (lastSlashIndex === -1) {
    // 没有斜杠，在根目录搜索
    const items = await listDirectory('', projectRoot);
    
    if (!normalizedQuery) {
      // 空查询，返回根目录所有内容
      return items;
    }
    
    // 前缀匹配（不区分大小写）
    return items.filter(item => 
      item.name.toLowerCase().startsWith(normalizedQuery.toLowerCase())
    );
  } else {
    // 有斜杠，在指定目录搜索
    const dirPath = normalizedQuery.substring(0, lastSlashIndex);
    const searchTerm = normalizedQuery.substring(lastSlashIndex + 1);
    
    // 先检查目录是否存在
    const isDirExists = await isDirectory(dirPath, projectRoot);
    if (!isDirExists) {
      return [];
    }
    
    const items = await listDirectory(dirPath, projectRoot);
    
    if (!searchTerm) {
      // 如果斜杠后没有内容（如 "src/"），返回该目录的所有内容
      return items;
    }
    
    // 前缀匹配（不区分大小写）
    return items.filter(item =>
      item.name.toLowerCase().startsWith(searchTerm.toLowerCase())
    );
  }
}

/**
 * 清除缓存
 */
export function clearCache(): void {
  directoryCache.clear();
}

