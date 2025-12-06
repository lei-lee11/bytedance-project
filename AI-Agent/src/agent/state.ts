import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  summary: Annotation<string>(),

  // 当前要执行的任务
  currentTask: Annotation<string>(),

  // 相关代码上下文
  codeContext: Annotation<string>(),

  // 重试次数
  retryCount: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),

  // 代码审核结果
  reviewResult: Annotation<string>(),

  // 项目根目录（一般在调用 graph 时初始化，比如 process.cwd()）
  projectRoot: Annotation<string>({
    value: (_prev, next) => next, // 每次显式设置时就覆盖
    default: () => "C:\\projects\\playground", // 🟢 默认根目录（在 TS 里要双反斜杠）
  }),

  // 最近一次获取的项目目录树的消息 ID（用于引用和避免重复注入）
  projectTreeMessageId: Annotation<string>(),

  // 是否已经注入过项目目录树上下文，避免重复扫描
  projectTreeInjected: Annotation<boolean>({
    // 使用覆盖行为：每次设置都以新值为准
    value: (_prev: boolean, next: boolean) => next,
    default: () => false,
  }),

  // 保存最近一次的目录树文本
  projectTreeText: Annotation<string>(),

  // 新增：最近一次生成的测试计划文本
  testPlanText: Annotation<string>(),

  // 项目/用户画像：用于存储自动检测出的语言、首选测试命令等信息
  projectProfile: Annotation<ProjectProfile | undefined>({
    value: (
      _prev: ProjectProfile | undefined,
      next: ProjectProfile | undefined,
    ) => next,
    default: () => undefined,
  }),

  // 最近一次由 project planner 生成的可读计划文本
  projectPlanText: Annotation<string>(),

  // planner 提取出的技术栈摘要（可选）
  techStackSummary: Annotation<string>(),

  // planner 输出的工程级初始化步骤（数组）
  projectInitSteps: Annotation<string[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),

  todos: Annotation<string[]>({
    // 如果没设置过，默认是空数组
    value: (_prev, next) => next,
    default: () => [],
  }),

  currentTodoIndex: Annotation<number>({
    value: (_prev, next) => next, // 覆盖式更新
    default: () => 0,
  }),

  // 待处理的文件路径（临时字段，处理后清空）
  pendingFilePaths: Annotation<string[]>({
    reducer: (_prev: string[], next: string[]) => next,
    default: () => [],
  }),

  // 新增：任务状态（用于重构后的 graph）
  taskStatus: Annotation<"planning" | "executing" | "completed">({
    value: (_prev, next) => next,
    default: () => "planning" as const,
  }),

  // 新增：任务完成标记
  taskCompleted: Annotation<boolean>({
    value: (_prev, next) => next,
    default: () => false,
  }),

  // 新增：迭代计数（循环保护）
  iterationCount: Annotation<number>({
    value: (_prev, next) => next,
    default: () => 0,
  }),

  // 新增：最大迭代次数
  maxIterations: Annotation<number>({
    value: (_prev, next) => next,
    default: () => 50,
  }),

  // 新增：待执行的工具调用
  pendingToolCalls: Annotation<any[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),

  // 新增：错误信息
  error: Annotation<string>({
    value: (_prev, next) => next,
    default: () => "",
  }),

  // 新增：演示模式（跳过人工审批）
  demoMode: Annotation<boolean>({
    value: (_prev, next) => next,
    default: () => false,
  }),

  // 新增：用户意图分类（task: 编程任务, chat: 闲聊）
  userIntent: Annotation<"task" | "chat" | null>({
    value: (_prev, next) => next ?? null,
    default: () => null,
  }),

  // 新增：意图分类置信度
  intentConfidence: Annotation<number>({
    value: (_prev, next) => next ?? 0,
    default: () => 0,
  }),

  // 新增：对话模式（task: 任务模式, chat: 闲聊模式）
  conversationMode: Annotation<"task" | "chat" | null>({
    value: (_prev, next) => next ?? null,
    default: () => null,
  }),
});

export type AgentState = typeof StateAnnotation.State;

// 项目/用户画像类型，用于描述项目内使用的语言和测试命令提示
export type ProjectProfile = {
  detectedLanguages: string[];
  primaryLanguage: "TypeScript" | "JavaScript" | "Python" | "Other";
  testCommand?: string;
  testFrameworkHint?: string;
};

// projectProfile 类型已定义并作为 Annotation 包含在 StateAnnotation 内

export function createAgentState(
  overrides: Partial<AgentState> = {},
): AgentState {
  const base: AgentState = {
    messages: [], //
    summary: "", //
    currentTask: "",
    codeContext: "",
    programmingLanguage: "TypeScript",
    retryCount: 0,
    reviewResult: "",
    projectRoot: overrides.projectRoot ?? "C:\\projects\\playground",
    projectTreeMessageId: "",
    projectTreeInjected: false, //
    projectTreeText: "", //
    testPlanText: "",
    projectProfile: undefined,
    projectPlanText: "", //
    techStackSummary: "", //
    projectInitSteps: [], //
    todos: [], //
    currentTodoIndex: 0, //
    pendingFilePaths: [], //
    // 新增字段
    taskStatus: "planning" as const, //
    taskCompleted: false, //
    iterationCount: 0, //
    maxIterations: 50, //
    pendingToolCalls: [], //
    error: "", //
    demoMode: false, //
    // 意图分类相关字段
    userIntent: null,
    intentConfidence: 0,
    conversationMode: null,
  } as AgentState;

  return {
    ...base,
    ...overrides,
  };
}
