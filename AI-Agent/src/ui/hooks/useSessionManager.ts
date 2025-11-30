import { useState, useEffect, useCallback } from "react";
import { storage } from "../test.ts";
import { SessionInfo, QueryOptions } from "../../storage/types.ts";
import { UIMessage, toUIMessage, toBackendEventType } from "../utils/adapter.ts";

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
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .map(toUIMessage);

      setCurrentHistory(messages);
      setActiveSessionId(threadId);
      console.log(`[Session] Loaded session: ${threadId} (${messages.length} msgs)`);
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
      const result = await storage.sessions.listSessions({ limit: 20 }); // 增加 limit 以防找不到
      setSessionList(result.sessions || result);

      // 切换过去
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
      console.log(`[Switch] Searching for: "${partialId}" in ${sessionList.length} sessions`);
      
      const target = sessionList.find((s) =>
        s.metadata.thread_id.includes(partialId)
      );

      if (target) {
        console.log(`[Switch] Found match: ${target.metadata.thread_id}`);
        await loadSession(target.metadata.thread_id);
        return target.metadata.thread_id;
      }
      
      console.log(`[Switch] No match found.`);
      return null;
    },
    [sessionList, loadSession], // 👈 加上 loadSession 依赖
  );

  //  核心功能
  const addMessage = useCallback(
    async (
      role: "user" | "ai" | "system" | "tool",
      content: string,
      reasoning?: string,
      extraMetadata?: Record<string, any>
    ) => {
      if (!activeSessionId) return;

      const optimisticMsg: UIMessage = {
        id: Date.now().toString(),
        role,
        content,
        reasoning,
      };
      setCurrentHistory((prev) => [...prev, optimisticMsg]);

      const eventType = toBackendEventType(role);
      const metadata = {
        ...(reasoning ? { reasoning } : {}),
        ...(extraMetadata || {}),
      };

      try {
        await storage.history.addHistoryRecord(activeSessionId, {
          event_type: eventType,
          content: content,
          display_priority: role === 'system' ? 'medium' : 'high',
          metadata: metadata,
        });
      } catch (e) {
        console.error("Failed to save message:", e);
      }
    },
    [activeSessionId],
  );

  useEffect(() => {
    const init = async () => {
      try {
        setIsLoading(true);
        await storage.initialize();
        const result = await storage.sessions.listSessions({ limit: 20 }); // 增加 limit
        const sessions = result.sessions || result;
        setSessionList(sessions);

        if (sessions.length > 0) {
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
  }, [loadSession, createNewSession]); // 补全依赖

  return {
    activeSessionId,
    currentHistory,
    sessionList,
    isLoading,
    createNewSession,
    switchSession,
    addMessage,
  };
};
