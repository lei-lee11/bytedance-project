import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

export const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[], BaseMessageLike[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  summary: Annotation<string>(),

  // 项目根目录（一般在调用 graph 时初始化，比如 process.cwd()）
  projectRoot: Annotation<string>({
    value: (_prev, next) => next, // 每次显式设置时就覆盖
    default: () => process.cwd(), // 🟢 默认根目录（在 TS 里要双反斜杠）
  }),

  // 是否已经注入过项目目录树上下文，避免重复扫描
  projectTreeInjected: Annotation<boolean>({
    // 使用覆盖行为：每次设置都以新值为准
    value: (_prev: boolean, next: boolean) => next,
    default: () => false,
  }),

  // 保存最近一次的目录树文本
  projectTreeText: Annotation<string>(),

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
});

export type AgentState = typeof StateAnnotation.State;

// 项目/用户画像类型，用于描述项目内使用的语言和测试命令提示
export type ProjectProfile = {
  detectedLanguages: string[];
  testCommand?: string;
  testFrameworkHint?: string;
};

export function createAgentState(
  overrides: Partial<AgentState> = {},
): AgentState {
  const base: AgentState = {
    messages: [],
    summary: "",
    projectRoot: overrides.projectRoot ?? "C:\\projects\\playground",
    projectTreeInjected: false,
    projectTreeText: "",
    projectPlanText: "",
    techStackSummary: "",
    projectInitSteps: [],
    todos: [],
    currentTodoIndex: 0,
    pendingFilePaths: [],
    // 新增字段
    taskStatus: "planning" as const,
    taskCompleted: false,
    iterationCount: 0,
    maxIterations: 50,
    pendingToolCalls: [],
    error: "",
    demoMode: false,
  } as AgentState;

  return {
    ...base,
    ...overrides,
  };
}
