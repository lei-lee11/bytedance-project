import { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";

// 任务模式类型
export type AgentMode = "new_project" | "bug_fix" | "feature" | "refactor";

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

  // 编程语言
  programmingLanguage: Annotation<string>(),

  // 重试次数
  retryCount: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),

  // 代码审核结果
  reviewResult: Annotation<string>(),

  // 任务模式：判断本次任务类型
  mode: Annotation<AgentMode | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),

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

  // 最近几步的操作记录
  recentActions: Annotation<string>({
    value: (_prev, next) => next,
    default: () => "",
  }),

  // 最近的工具调用记录（用于更新recentActions）
  lastToolCalls: Annotation<Array<{name: string, detail: string}>> ({
    reducer: (_prev, next) => next,
    default: () => [],
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
    messages: [],
    summary: "",
    currentTask: "",
    codeContext: "",
    programmingLanguage: "TypeScript",
    retryCount: 0,
    reviewResult: "",
    mode: undefined,
    projectRoot: overrides.projectRoot ?? "C:\\projects\\playground",
    projectTreeMessageId: "",
    projectTreeInjected: false,
    projectTreeText: "",
    testPlanText: "",
    projectProfile: undefined,
    projectPlanText: "",
    techStackSummary: "",
    projectInitSteps: [],
    todos: [],
    currentTodoIndex: 0,
    pendingFilePaths: [],
    recentActions: "",
    lastToolCalls: [],
  } as AgentState;

  return {
    ...base,
    ...overrides,
  };
}
