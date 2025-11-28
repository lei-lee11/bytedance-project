import { file_operations } from './file_operation.ts'
import { project_tree_tool } from './project_tree.ts'
import { testTools } from './testRunner.ts'
import { backgroundProcessTools } from './backgroundProcess.ts'

const tools =[
    ...file_operations,
    ...project_tree_tool,
    ...testTools,
    ...backgroundProcessTools
]
export const SENSITIVE_TOOLS = [
  "manualTestRunnerTool",
  "autoTestRunnerTool",
  "append_to_file",
  "write_file",
  "start_background_process",
  "stop_background_process",
];
export { tools }
