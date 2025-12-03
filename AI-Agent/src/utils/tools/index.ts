import { file_operations } from './file_operation.js'
import { project_tree_tool } from './project_tree.js'
import { testTools } from './testRunner.js'
import { backgroundProcessTools } from './backgroundProcess.js'
import { codeEditTools } from './code_edit.js'
import { codeSearchTools } from './code_search.js'

const tools = [
  // 文件读写类工具（敏感）
  ...file_operations,
  // 项目目录树工具
  ...project_tree_tool,
  // 测试相关工具
  ...testTools,
  // 后台进程 / 执行命令工具
  ...backgroundProcessTools,
  // 代码编辑类工具（包含 edit_code_snippet）
  ...codeEditTools,
  // 代码搜索工具
  ...codeSearchTools
];

export const SENSITIVE_TOOLS = [
  "manualTestRunnerTool",
  "autoTestRunnerTool",
  "append_to_file",
  "write_file",
  "start_background_process",
  "stop_background_process",
  "edit_code_snippet",
  "restore_from_backup",
];
export { tools };
