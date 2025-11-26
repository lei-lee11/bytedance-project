import { file_operations } from './file_operation.ts'
import { project_tree_tool } from './project_tree.ts'
import { testTools } from './testRunner.ts'

const tools =[
    ...file_operations,
    ...project_tree_tool,
    ...testTools
]
export const SENSITIVE_TOOLS = [
  "manualTestRunnerTool",
  "autoTestRunnerTool",
  "append_to_file",
  "write_file",
];
export { tools }
