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

  // 编程语言
  programmingLanguage: Annotation<string>(),

  // 重试次数
  retryCount: Annotation<number>({
    reducer: (prev, next) => prev + next,
    default: () => 0,
  }),

  // 代码审核结果
  reviewResult: Annotation<string>(),

  // 项目根目录（一般在调用 graph 时初始化，比如 process.cwd()）
  projectRoot: Annotation<string>(),

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
    value: (_prev: ProjectProfile | undefined, next: ProjectProfile | undefined) => next,
    default: () => undefined,
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
