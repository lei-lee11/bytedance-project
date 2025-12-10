import { useState, useEffect, useCallback } from "react";
import { storage, initPromise } from "../../storage/instance.js";
import { SessionInfo, QueryOptions } from "../../storage/types.js";
import {
  UIMessage,
  toUIMessage,
  toBackendEventType,
} from "../utils/adapter.ts";

export const useSessionManager = () => {
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [currentHistory, setCurrentHistory] = useState<UIMessage[]>([]);
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 加载特定会话
  const loadSession = useCallback(async (threadId: string) => {
    setIsLoading(true);
    try {
      const query: QueryOptions = {
        limit: 100,
        priority: "high",
      };

      const records = await storage.history.getHistory(threadId, query);

      const messages = records
        // 确保按时间正序排列 (旧 -> 新) 用于 UI 显示
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .map(toUIMessage);

      setCurrentHistory(messages);
      setActiveSessionId(threadId);
      // console.log(`[Session] Loaded: ${threadId}`);
    } catch (err) {
      console.error(`Failed to load session ${threadId}:`, err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 创建新会话
  const createNewSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const { threadId } = await storage.sessions.createSession({
        title: "CLI Session",
        initialMessage: "Session Started",
      });

      // 刷新列表
      const result = await storage.sessions.listSessions({ limit: 20 });
      // 🔥 修正：根据你的存储系统设计，这里通常返回 { items: [...] }
      const sessions = result.sessions || [];
      setSessionList(sessions);

      setActiveSessionId(threadId);
      setCurrentHistory([]);
      return threadId;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 切换会话
  const switchSession = useCallback(
    async (partialId: string) => {
      const target = sessionList.find(
        (s) => s.metadata.thread_id.includes(partialId), // 🔥 注意：SessionInfo 里的字段通常是 thread_id 而不是 metadata.thread_id，请检查你的类型定义
      );

      if (target) {
        await loadSession(target.metadata.thread_id);
        return target.metadata.thread_id;
      }
      return null;
    },
    [sessionList, loadSession],
  );

  // 添加消息
  const appendLocalMessage = useCallback(
    (
      // 注意：这里可以去掉 async，因为它现在是同步操作了
      role: "user" | "ai" | "system" | "tool",
      content: string,
      reasoning?: string,
      extraMetadata?: Record<string, any>,
    ) => {
      if (!activeSessionId) return;

      // 1. 构造 UI 需要的消息对象
      const uiMsg: UIMessage = {
        id: Date.now().toString(), // 生成一个临时的唯一 ID
        role,
        content,
        reasoning,
        // 如果是工具调用，保留 UI 需要的元数据
        ...(role === "tool"
          ? { toolName: extraMetadata?.tool_name, isSuccess: true }
          : {}),
      };

      // 2. 🔥 核心：只更新 React 本地状态
      // 这会触发界面重渲染，让用户立刻看到消息
      setCurrentHistory((prev) => [...prev, uiMsg]);

      // 3. ❌ 已删除：写入 storage 的逻辑
      // const eventType = toBackendEventType(role);
      // await storage.history.addHistoryRecord(...);
      // 这部分现在由你的 Graph Agent 在后台自动完成
    },
    [activeSessionId],
  );

  // 初始化
  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        // 等待单例初始化完成
        await initPromise;

        const result = await storage.sessions.listSessions({ limit: 20 });
        // 🔥 修正：确保取到数组
        const sessions = result.sessions || [];
        setSessionList(sessions);

        if (sessions.length > 0) {
          // 默认加载第一个 (通常是最近更新的)
          await loadSession(sessions[0].metadata.thread_id);
        } else {
          await createNewSession();
        }
      } catch (err) {
        console.error("Failed to init storage:", err);
      } finally {
        setIsLoading(false);
      }
    };
    void init();
  }, [loadSession, createNewSession]);

  return {
    activeSessionId,
    currentHistory,
    sessionList,
    isLoading,
    createNewSession,
    switchSession,
    appendLocalMessage,
    storage,
  };
};
