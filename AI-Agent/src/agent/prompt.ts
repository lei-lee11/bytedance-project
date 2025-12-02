// src/agent/prompts.ts

// 用途说明：
// - 节点：`parseUserInput`（位于 `src/agent/nodes.ts`）
// - 功能：从对话历史中提取用户当前的编程意图，输出为严格的 JSON 结构，包含 `currentTask`、`programmingLanguage`、`codeContext`。
// - 简要说明：该提示用于把自然语言对话转换为规范化的任务描述，便于后续节点生成代码或测试计划时使用。
export const buildParseUserInputPrompt = (historyText: string) => `
你是一个任务解析器。请根据完整的对话上下文，提取当前用户的编程意图。当前对话历史：
${historyText}

请输出以下字段（即使与之前相同也需显式写出）：
- currentTask: 当前要实现的功能（必须明确，不可省略）
- programmingLanguage: 目标编程语言
- codeContext: 相关代码片段（若无则为空字符串）
输出严格 JSON，不要任何其他内容。
`;

// 用途说明：
// - 节点：`generateCode`（位于 `src/agent/nodes.ts`）
// - 功能：在明确的 `currentTask` 和上下文下，生成实现代码并先行设计测试计划（TDD 流程）。
// - 简要说明：该提示引导模型先产出测试计划，然后产出实现代码和对应的单元测试，适用于需要代码 + 测试的一体化生成场景。
export const buildCodeWithTestPlanPrompt = (args: {
  currentTask: string;
  programmingLanguage: string;
  codeContext: string;
}) => `
你是一个专业的编程助手，专注于生成高质量的 ${args.programmingLanguage} 代码，并坚持测试驱动开发（TDD）。

当前任务：
${args.currentTask}

相关代码上下文（可能为空）：
${args.codeContext || "（无显式上下文）"}

### Step 1: 理解任务
- 用 2~5 句话复述你理解的需求
- 列出你的关键假设（Assumptions）

### Step 2: 测试计划（Test Plan，写代码前必须先写）
- 列出要测试的行为/函数/组件列表
- 对每个行为列出测试用例（正常路径 + 边界情况 + 错误/异常）

### Step 3: 代码与单测实现
- 先给出实现代码，再给出单元测试代码
- 代码必须是完整可运行的片段，可以直接复制到项目中使用
`;

// 用途说明：
// - 节点：`generateTests` 或者在 `generateCode` 之后单独被调用的测试生成节点（视实现而定，位于 `src/agent/nodes.ts`）。
// - 功能：仅生成针对给定代码片段的单元测试，而不改变或生成实现代码。
// - 简要说明：用于在已有实现代码基础上补充或替换单元测试的场景，输出应为可直接运行的测试文件内容。
export const buildUnitTestOnlyPrompt = (args: {
  currentTask: string;
  programmingLanguage: string;
  codeUnderTest: string;
  existingTestPlan?: string;
}) => `
你是一个专业的测试工程师。你的任务是为已有的 ${args.programmingLanguage} 代码编写高质量的单元测试。

当前任务：
${args.currentTask}

待测试代码：
${args.codeUnderTest}

${args.existingTestPlan ? `已有测试计划：
${args.existingTestPlan}
` : ""}

### Step 1: 测试目标理解
- 复述代码的主要行为和关键分支

### Step 2: 测试计划
- 列出需要覆盖的测试用例（正常路径 + 边界情况 + 错误分支）

### Step 3: 单元测试代码
- 使用项目中已有的测试框架
- 输出完整可运行的测试代码
`;

// 用途说明：
// - 节点：`summarizeConversation`（位于 `src/agent/nodes.ts`）
// - 功能：生成或扩展对话摘要，重点关注编程任务、使用语言、关键代码和决策点。
// - 简要说明：用于在长会话中保持上下文概要，便于后续节点快速获取任务概览和重要信息。
export const buildSummarizePrompt = (existingSummary?: string) => {
  const basePrompt =
    `你是一名负责代码协作记录的助理，需要为「以上对话」生成简洁但信息完整的结构化摘要。\n\n` +
    `请使用**简体中文**，按照以下固定结构输出（如果某一条在对话中没有相关信息，可以省略该条目，而不要编造）：\n` +
    `1. 主要编程任务和目标\n` +
    `   - 包含涉及的文件路径、模块名称\n` +
    `2. 已执行的文件操作\n` +
    `   - 创建/修改/删除了哪些文件及大致内容\n` +
    `3. 使用的编程语言和技术栈\n` +
    `   - 如：TypeScript、React、Node.js、LangGraph 等\n` +
    `4. 关键代码片段或核心解决方案\n` +
    `   - 用自然语言概括核心逻辑，不必贴完整代码\n` +
    `5. 重要决策和结论\n` +
    `   - 包含后续计划、已确定的设计方案等\n\n` +
    `额外要求：\n` +
    `- 重点保留与代码实现和文件操作相关的细节\n` +
    `- 不要编造对话中未出现的信息\n` +
    `- 输出时只给出摘要本身，不要多余解释。`;

  if (existingSummary) {
    return (
      `下面是当前对话的已有摘要：\n` +
      `---\n` +
      `${existingSummary}\n` +
      `---\n\n` +
      `请根据「最新的对话消息」，在**保持上述固定结构**的前提下，更新这个摘要。\n\n` +
      `更新时请特别关注：\n` +
      `- 新增或变更的文件操作（新增文件、修改文件、删除文件）\n` +
      `- 任务目标或需求是否有调整\n` +
      `- 新增的代码实现、关键逻辑或测试\n` +
      `- 与实现相关的重要上下文变化\n\n` +
      `请直接输出更新后的完整摘要（覆盖旧摘要），仍然使用简体中文，不要添加额外说明。`
    );
  }

  return basePrompt;
};


// 用途说明：
// - 节点：`reviewCode`（位于 `src/agent/nodes.ts`）
// - 功能：对生成的实现代码进行严格审查，评估功能完整性、语言正确性、语法正确性，并要求仅输出 JSON 结果或纯代码以便自动化解析。
// - 简要说明：该提示包含两部分：system（审查标准和输出格式约束）和 human（待审查代码），便于按 LangChain/消息模型发送不同角色的消息。
export const buildReviewPrompt = (args: {
  currentTask: string;
  programmingLanguage: string;
  generatedCode: string;
}) => {
  const system = `你是一个严格的代码审查专家。\n请根据以下要求评估用户提供的代码：\n- 编程任务：${args.currentTask}\n- 目标语言：${args.programmingLanguage}\n审查标准：\n1. 代码是否完整实现了任务？\n2. 是否使用了正确的编程语言？\n3. 语法是否正确（能否编译/运行）？\n4. 是否只包含纯代码？禁止包含任何解释性文字、注释（除非必要）、Markdown 围栏（如 \`\`\`cpp）等非代码内容。\n请严格按照指定 JSON 格式输出，不要包含任何额外文本、说明或 Markdown.`;

  const human = `代码如下：\n\n${args.generatedCode}`;
  return { system, human };
};
