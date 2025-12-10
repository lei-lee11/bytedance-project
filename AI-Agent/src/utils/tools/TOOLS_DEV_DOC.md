# AI-Agent 工具开发文档

本文档详细描述了 AI-Agent 项目中所有工具的实现和使用方法。

## 1. 文件操作工具 (file_operation.ts)

### 1.1 工具概述

提供文件系统的基本操作能力，包括文件读取、写入、追加、存在性检查和目录列表等功能。

### 1.2 核心API

#### read_files

```typescript
export const read_files: DynamicStructuredTool;
```

**功能**：读取一个或多个文件的内容

**参数**：

- `file_paths`: `string[]` - 文件路径数组
- `encoding`: `string` - 字符编码（默认：utf-8）
- `max_size_bytes`: `number` - 最大文件大小（默认：10MB）

**返回值**：包含文件路径和内容的格式化字符串

#### file_exists

```typescript
export const file_exists: DynamicStructuredTool;
```

**功能**：检查文件或目录是否存在

**参数**：

- `path`: `string` - 文件或目录路径

**返回值**：存在则返回路径，不存在返回错误信息

#### list_directory

```typescript
export const list_directory: DynamicStructuredTool;
```

**功能**：列出目录中的文件和子目录

**参数**：

- `path`: `string` - 目录路径
- `show_hidden`: `boolean` - 是否显示隐藏文件（默认：false）
- `show_sizes`: `boolean` - 是否显示文件大小（默认：false）

**返回值**：目录内容的格式化列表

#### write_file

```typescript
export const write_file: DynamicStructuredTool;
```

**功能**：写入文件内容

**参数**：

- `file_path`: `string` - 文件路径
- `content`: `string` - 文件内容
- `encoding`: `string` - 字符编码（默认：utf-8）
- `overwrite`: `boolean` - 是否覆盖现有文件（默认：false）

**返回值**：写入结果信息

#### append_to_file

```typescript
export const append_to_file: DynamicStructuredTool;
```

**功能**：向文件追加内容

**参数**：

- `file_path`: `string` - 文件路径
- `content`: `string` - 追加内容
- `encoding`: `string` - 字符编码（默认：utf-8）

**返回值**：追加结果信息

## 2. 项目树工具 (project_tree.ts)

### 2.1 工具概述

生成项目目录结构的树状视图，支持深度控制和文件过滤。

### 2.2 核心API

#### project_tree

```typescript
export const project_tree: DynamicStructuredTool;
```

**功能**：生成项目目录树结构

**参数**：

- `root_dir`: `string` - 根目录路径（默认：当前目录）
- `max_depth`: `number` - 最大递归深度（默认：2）
- `show_hidden`: `boolean` - 是否显示隐藏文件（默认：false）
- `include_files`: `string[]` - 包含的文件扩展名列表（可选）
- `max_entries`: `number` - 最大条目数（默认：500）

**返回值**：格式化的树状结构字符串

## 3. 测试运行工具 (testRunner.ts)

### 3.1 工具概述

自动检测项目语言并运行相应的测试命令，支持多种编程语言和测试框架。

### 3.2 核心API

#### auto_run_test

```typescript
export const auto_run_test: DynamicStructuredTool;
```

**功能**：自动检测项目语言并运行测试

**参数**：

- `language`: `string` - 项目语言（可选，自动检测）
- `working_directory`: `string` - 工作目录（可选，默认：当前目录）
- `custom_command`: `string` - 自定义测试命令（可选）

**返回值**：测试结果信息

#### manualTestRunnerTool

```typescript
export const manualTestRunnerTool: DynamicStructuredTool;
```

**功能**：手动运行指定的测试命令

**参数**：

- `command`: `string` - 完整的测试命令
- `working_directory`: `string` - 工作目录（可选，默认：当前目录）

**返回值**：测试结果信息

#### list_supported_test_languages

```typescript
export const list_supported_test_languages: DynamicStructuredTool;
```

**功能**：列出支持的编程语言及其测试命令配置

**参数**：无

**返回值**：支持的语言和测试命令列表

## 4. 后台进程工具 (backgroundProcess.ts)

### 4.1 工具概述

管理后台进程的启动、停止和监控，支持长时间运行的任务。

### 4.2 核心API

#### start_background_process

```typescript
export const startBackgroundProcess: DynamicStructuredTool;
```

**功能**：在系统终端启动一个后台进程

**参数**：

- `command`: `string` - 要执行的命令
- `args`: `string[]` - 命令参数（默认：[]）
- `workingDirectory`: `string` - 工作目录（可选）
- `description`: `string` - 进程描述（可选）

**返回值**：包含进程ID和状态的信息

#### stop_background_process

```typescript
export const stopBackgroundProcess: DynamicStructuredTool;
```

**功能**：停止后台进程

**参数**：

- `processId`: `string` - 进程ID

**返回值**：停止结果信息

#### list_background_processes

```typescript
export const listBackgroundProcesses: DynamicStructuredTool;
```

**功能**：列出所有后台进程

**参数**：无

**返回值**：所有后台进程的列表

#### get_process_logs

```typescript
export const getProcessLogs: DynamicStructuredTool;
```

**功能**：获取进程日志

**参数**：

- `processId`: `string` - 进程ID
- `tailLines`: `number` - 日志行数（默认：50）

**返回值**：进程日志内容

## 5. 备份管理工具 (backup_manager.ts)

### 5.1 工具概述

提供文件备份和恢复功能，支持自动清理旧备份。

### 5.2 核心API

#### createBackup

```typescript
export class BackupManager {
  createBackup(filePath: string): Promise<string>;
}
```

**功能**：创建文件备份

**参数**：

- `filePath`: `string` - 文件路径

**返回值**：备份文件路径

#### listBackups

```typescript
export class BackupManager {
  listBackups(filePath: string): Promise<string[]>;
}
```

**功能**：列出文件的所有备份

**参数**：

- `filePath`: `string` - 文件路径

**返回值**：备份文件路径数组

#### restore

```typescript
export class BackupManager {
  restore(filePath: string, backupPath?: string): Promise<void>;
}
```

**功能**：从备份恢复文件

**参数**：

- `filePath`: `string` - 文件路径
- `backupPath`: `string` - 备份文件路径（可选，默认使用最新备份）

**返回值**：无

#### deleteAllBackups

```typescript
export class BackupManager {
  deleteAllBackups(filePath: string): Promise<number>;
}
```

**功能**：删除文件的所有备份

**参数**：

- `filePath`: `string` - 文件路径

**返回值**：删除的备份数量

## 6. 代码编辑工具 (code_edit.ts)

### 6.1 工具概述

提供代码编辑功能，包括精确的代码片段替换、变更预览和备份恢复。

### 6.2 核心API

#### edit_code_snippet

```typescript
export const editCodeSnippet: DynamicStructuredTool;
```

**功能**：编辑文件中的代码片段

**参数**：

- `file_path`: `string` - 要编辑的文件路径
- `old_code`: `string` - 要替换的代码片段（必须精确匹配）
- `new_code`: `string` - 新的代码片段
- `language`: `string` - 编程语言（用于语法检查，可选）
- `preview_only`: `boolean` - 是否只预览不执行修改（默认：false）

**返回值**：编辑结果信息

#### preview_code_change

```typescript
export const previewCodeChange: DynamicStructuredTool;
```

**功能**：预览代码修改的差异

**参数**：

- `file_path`: `string` - 文件路径
- `old_code`: `string` - 要替换的代码片段
- `new_code`: `string` - 新的代码片段

**返回值**：格式化的差异信息

#### find_code_context

```typescript
export const findCodeContext: DynamicStructuredTool;
```

**功能**：在文件中查找代码模式并显示上下文

**参数**：

- `file_path`: `string` - 文件路径
- `search_pattern`: `string` - 要查找的代码模式
- `context_lines`: `number` - 显示的上下文行数（默认：5）
- `use_regex`: `boolean` - 是否使用正则表达式（默认：false）
- `case_sensitive`: `boolean` - 是否区分大小写（默认：false）

**返回值**：匹配的代码及其上下文

#### restore_from_backup

```typescript
export const restoreFromBackup: DynamicStructuredTool;
```

**功能**：从备份恢复文件

**参数**：

- `file_path`: `string` - 文件路径
- `backup_timestamp`: `string` - 备份时间戳（可选）
- `list_only`: `boolean` - 是否只列出备份（默认：false）

**返回值**：恢复结果信息

## 7. 代码搜索工具 (code_search.ts)

### 7.1 工具概述

提供高性能的代码搜索功能，支持正则表达式和多种搜索策略。

### 7.2 核心API

#### grep_search_ripgrep

```typescript
export const grep_search_ripgrep: Tool;
```

**功能**：使用 ripgrep 进行高性能代码搜索

**参数**：

- `pattern`: `string` - 正则表达式模式
- `dir_path`: `string` - 搜索目录（默认：当前目录）
- `include`: `string` - 文件过滤模式（可选）
- `case_sensitive`: `boolean` - 是否区分大小写（默认：false）
- `fixed_strings`: `boolean` - 是否将模式视为字面字符串（默认：false）
- `context`: `number` - 上下文行数（可选）
- `max_results`: `number` - 最大结果数（默认：200）

**返回值**：格式化的搜索结果

#### grep_search_fallback

```typescript
export const grep_search_fallback: Tool;
```

**功能**：使用多种策略进行代码搜索（git grep → system grep → Node.js）

**参数**：

- `pattern`: `string` - 搜索模式
- `dir_path`: `string` - 搜索目录（默认：当前目录）
- `include`: `string` - 文件过滤模式（可选）
- `max_results`: `number` - 最大结果数（默认：200）

**返回值**：格式化的搜索结果

## 8. 差异生成工具 (diff_generator.ts)

### 8.1 工具概述

生成两个文本之间的差异，支持智能比较和格式化输出。

### 8.2 核心API

```typescript
export class DiffGenerator {
  generateDiff(
    oldContent: string,
    newContent: string,
    fileName: string,
    contextLines?: number,
  ): string;
  generateColoredDiff(
    oldContent: string,
    newContent: string,
    fileName: string,
  ): string;
  generateSummary(oldContent: string, newContent: string): string;
}
```

#### generateDiff

**功能**：生成文本差异

**参数**：

- `oldContent`: `string` - 旧内容
- `newContent`: `string` - 新内容
- `fileName`: `string` - 文件名
- `contextLines`: `number` - 上下文行数（默认：3）

**返回值**：格式化的差异字符串

#### generateColoredDiff

**功能**：生成带颜色的差异输出（用于终端）

**参数**：同 `generateDiff`

**返回值**：带ANSI颜色代码的差异字符串

#### generateSummary

**功能**：生成差异摘要

**参数**：

- `oldContent`: `string` - 旧内容
- `newContent`: `string` - 新内容

**返回值**：变更统计信息（如：+10 -5 行变更）

## 9. 文件上下文工具 (fileContext.ts)

### 9.1 工具概述

读取并格式化文件内容，用于在对话中注入文件上下文。

### 9.2 核心API

#### readReferencedFiles

```typescript
export async function readReferencedFiles(
  filePaths: string[],
  projectRoot: string = process.cwd(),
): Promise<ReferencedFile[]>;
```

**功能**：读取多个文件并返回文件信息数组

**参数**：

- `filePaths`: `string[]` - 文件路径数组
- `projectRoot`: `string` - 项目根目录（默认：当前目录）

**返回值**：文件信息数组

#### formatFilesForContext

```typescript
export function formatFilesForContext(files: ReferencedFile[]): string;
```

**功能**：将文件列表格式化为适合注入到 prompt 的字符串

**参数**：

- `files`: `ReferencedFile[]` - 文件信息数组

**返回值**：格式化的字符串

#### attachFilesToContext

```typescript
export async function attachFilesToContext(
  filePaths: string[],
  projectRoot?: string,
): Promise<{ formattedContext: string }>;
```

**功能**：组合函数，读取并格式化文件

**参数**：

- `filePaths`: `string[]` - 文件路径数组
- `projectRoot`: `string` - 项目根目录（可选）

**返回值**：包含格式化上下文的对象

## 10. 语法检查工具 (syntax_checker.ts)

### 10.1 工具概述

检查代码的语法正确性，支持多种编程语言。

### 10.2 核心API

```typescript
export class SyntaxChecker {
  detectLanguage(filePath: string): string;
  async checkSyntax(code: string, language: string): Promise<SyntaxCheckResult>;
  formatResult(result: SyntaxCheckResult): string;
}
```

#### detectLanguage

**功能**：根据文件扩展名检测语言类型

**参数**：

- `filePath`: `string` - 文件路径

**返回值**：语言名称

#### checkSyntax

**功能**：检查代码语法

**参数**：

- `code`: `string` - 代码内容
- `language`: `string` - 编程语言

**返回值**：语法检查结果对象

#### formatResult

**功能**：格式化语法检查结果

**参数**：

- `result`: `SyntaxCheckResult` - 语法检查结果

**返回值**：可读的结果字符串

## 11. 语言配置工具 (languageConfig.ts)

### 11.1 工具概述

定义支持的编程语言及其测试命令配置。

### 11.2 核心API

#### LANGUAGE_CONFIGS

```typescript
export const LANGUAGE_CONFIGS: Record<string, LanguageTestConfig>;
```

**功能**：存储各编程语言的测试配置

**结构**：

```typescript
interface LanguageTestConfig {
  language: string;
  extensions: string[];
  testCommands: string[];
  testFilePatterns: string[];
  buildCommands?: string[];
  description: string;
}
```

#### detectLanguageFromExtension

```typescript
export function detectLanguageFromExtension(extension: string): string | null;
```

**功能**：根据文件扩展名检测语言类型

**参数**：

- `extension`: `string` - 文件扩展名

**返回值**：语言名称或 null

#### getSupportedLanguages

```typescript
export function getSupportedLanguages(): string[];
```

**功能**：获取所有支持的语言列表

**参数**：无

**返回值**：语言名称数组

## 12. 项目配置工具 (projectProfile.ts)

### 12.1 工具概述

构建项目的配置文件，包括语言检测和测试命令识别。

### 12.2 核心API

#### buildProjectProfile

```typescript
export async function buildProjectProfile(cwd: string): Promise<ProjectProfile>;
```

**功能**：构建项目配置文件

**参数**：

- `cwd`: `string` - 项目根目录

**返回值**：项目配置对象

**结构**：

```typescript
interface ProjectProfile {
  detectedLanguages: string[];
  primaryLanguage: string;
  testCommand?: string;
  testFrameworkHint?: string;
}
```

## 13. 工具索引 (index.ts)

### 13.1 工具概述

汇总所有工具并提供统一的导出。

### 13.2 核心API

#### tools

```typescript
export const tools: DynamicStructuredTool[];
```

**功能**：包含所有工具的数组

#### SENSITIVE_TOOLS

```typescript
export const SENSITIVE_TOOLS: string[];
```

**功能**：敏感工具名称列表（需要额外权限）

---

## 使用示例

### 示例1：读取文件内容

```typescript
const result = await read_files.invoke({
  file_paths: ["src/utils/tools/index.ts"],
});
console.log(result);
```

### 示例2：编辑代码片段

```typescript
const result = await editCodeSnippet.invoke({
  file_path: "src/utils/tools/index.ts",
  old_code: "export const tools: DynamicStructuredTool[];",
  new_code:
    "export const tools = [...file_operations, ...project_tree_tool, ...testTools, ...backgroundProcessTools];",
});
console.log(result);
```

### 示例3：搜索代码

```typescript
const result = await grep_search_ripgrep.invoke({
  pattern: "DynamicStructuredTool",
  dir_path: "src/utils/tools",
  include: "*.ts",
});
console.log(result);
```

### 示例4：运行测试

```typescript
const result = await auto_run_test.invoke({
  working_directory: "src/utils/tools",
});
console.log(result);
```

---

## 开发规范

1. **工具命名**：使用下划线分隔的小写字母（snake_case）
2. **功能单一**：每个工具应专注于单一功能
3. **参数验证**：使用 Zod 进行严格的参数验证
4. **错误处理**：完善的错误处理和友好的错误消息
5. **安全性**：避免路径遍历等安全风险
6. **文档**：每个工具必须包含详细的文档注释

---

**文档更新时间**：${new Date().toLocaleString()}
