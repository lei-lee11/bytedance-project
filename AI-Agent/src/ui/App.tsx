import React, { FC, useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph, initializeGraph } from "../agent/graph.js";
import { Header } from "./components/Header.tsx";
import { MinimalThinking } from "./components/MinimalThinking.tsx";
import { ApprovalCard } from "./components/ApprovalCard.tsx";
import { HistoryItem } from "./components/HistoryItem.tsx";
import { InputArea } from "./components/TextInput/InputArea.tsx";
import { useSessionManager } from "./hooks/useSessionManager.ts";
import { useMessageProcessor } from "./hooks/useMessageProcessor.ts";
import { StatusBar } from "./components/StatusBar.tsx";

// ... marked 配置保持不变 ...
marked.setOptions({
  renderer: new TerminalRenderer({
    code: (code: any) => code,
    blockquote: (quote: string) => `│ ${quote}`,
    firstHeading: (text: string) => `
# ${text}`,
  }) as any,
});

type ToolState = { name: string; input: string };
type PendingToolState = { name: string; args: any };

// ... MarkdownText 和 StatusBadge 组件保持不变 ...
export const MarkdownText = ({ content }: { content: string }) => {
  const formattedText = useMemo(() => {
    try {
      return marked(content) || content;
    } catch {
      return content;
    }
  }, [content]);
  return <Text>{formattedText}</Text>;
};

export const StatusBadge = ({ role }: { role: string }) => {
  switch (role) {
    case "user":
      return <Text color="green">➜ </Text>;
    case "ai":
      return <Text color="cyan">◇ </Text>;
    case "system":
      return <Text color="yellow">│ </Text>;
    default:
      return <Text> </Text>;
  }
};

export const App: FC<{ initialMessage?: string }> = ({ initialMessage }) => {
  const { exit } = useApp();
  const [showLogo, setShowLogo] = useState(true);

  // 🔥 修改 2: 添加 Graph 初始化状态
  const [isGraphReady, setIsGraphReady] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const {
    activeSessionId: threadId,
    currentHistory: history,
    isLoading: isSessionLoading, // 重命名一下以免混淆
    sessionList,
    createNewSession,
    switchSession,
    appendLocalMessage,
    storage,
  } = useSessionManager();

  const { processInput } = useMessageProcessor();

  // 实时状态
  const [currentAIContent, setCurrentAIContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [currentTool, setCurrentTool] = useState<ToolState | null>(null);
  const [pendingTool, setPendingTool] = useState<PendingToolState | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  const hasProcessedInitial = useRef(false);

  // 🔥 修改 3: 初始化 Graph 的 Effect
  useEffect(() => {
    const init = async () => {
      try {
        await initializeGraph(); // 等待图编译并赋值给全局 graph 变量
        setIsGraphReady(true);
      } catch (err: any) {
        console.error("Graph initialization failed:", err);
        setGraphError(err.message || "Unknown graph error");
      }
    };
    void init();
  }, []);

  // --- 发送消息逻辑 ---
  const { run: sendMessage, loading: isThinking } = useRequest(
    async (
      text: string | null,
      isResume = false,
      pendingFiles: string[] = [],
    ) => {
      // 检查 Graph 是否就绪
      if (!isGraphReady || !graph) {
        return;
      }
      if (!threadId || !storage) return;

      setCurrentAIContent("");
      setCurrentReasoning("");
      setCurrentTool(null);
      setPendingTool(null);
      setAwaitingApproval(false);

      const config = {
        configurable: { thread_id: threadId },
        version: "v2" as const,
      };

      try {
        const inputs = isResume
          ? null
          : {
              messages: [new HumanMessage(text!)],
              pendingFilePaths: pendingFiles,
            };

        const stream = await graph.streamEvents(inputs, config);

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";
        // ⚡️ 新增：定义上一次更新的时间戳
        let lastUpdateTime = 0;
        // ⚡️ 新增：定义刷新间隔 (例如 100ms，即每秒最多刷新 10 次，足够流畅且不闪)
        const UPDATE_INTERVAL = 100;
        for await (const event of stream) {
          // ... stream 处理逻辑保持不变 ...
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;
            const reasoningChunk =
              chunk.additional_kwargs?.reasoning_content ||
              (chunk as any).reasoning_content ||
              "";

            if (reasoningChunk) {
              fullReasoning += reasoningChunk;
            }
            if (chunk.content && typeof chunk.content === "string") {
              fullContent += chunk.content;
            }

            // 🔥 核心修改：节流控制
            const now = Date.now();
            if (now - lastUpdateTime > UPDATE_INTERVAL) {
              // 只有间隔超过 100ms 才触发 React 渲染
              // 为了防止两次 setState 导致的闪烁，建议合并状态或使用 unstable_batchedUpdates
              // 但在 Ink 中，只要频率降下来，分别调用也没问题：
              if (fullReasoning) setCurrentReasoning(fullReasoning);
              if (fullContent) setCurrentAIContent(fullContent);

              lastUpdateTime = now;
            }
          } else if (event.event === "on_tool_start") {
            setCurrentTool({
              name: event.name,
              input: JSON.stringify(event.data.input),
            });
          } else if (event.event === "on_tool_end") {
            setCurrentTool(null);
            appendLocalMessage(
              "tool",
              event.data.output || "Executed",
              undefined,
              { tool_name: event.name },
            );
          }
        }

        // --- AI 回复完成 ---
        if (fullContent || fullReasoning) {
          appendLocalMessage("ai", fullContent, fullReasoning);
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);

          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
          });
        }

        // --- 保存 Checkpoint (🔥 修复的部分) ---
        const snapshot = await graph.getState(config);
        // --- 处理中断 (Approval) ---
        if (snapshot.next.length > 0) {
          setAwaitingApproval(true);
          const lastMsg =
            snapshot.values.messages[snapshot.values.messages.length - 1];
          if (lastMsg?.tool_calls?.length) {
            setPendingTool({
              name: lastMsg.tool_calls[0].name,
              args: lastMsg.tool_calls[0].args,
            });
          }
        }
      } catch (e: any) {
        console.error(e);
        const errMsg = `Error: ${e.message}`;
        appendLocalMessage("system", errMsg);
      }
    },
    { manual: true },
  );

  // --- 初始化 Effect ---
  useEffect(() => {
    // 🔥 修改 4: 增加 !isGraphReady 的判断
    if (
      isSessionLoading ||
      !isGraphReady ||
      !initialMessage ||
      hasProcessedInitial.current
    ) {
      return;
    }

    const handleInitialFlow = async () => {
      hasProcessedInitial.current = true;
      try {
        await createNewSession();
        setTimeout(() => {
          sendMessage(initialMessage);
        }, 100);
      } catch (e) {
        console.error("Initial flow error:", e);
      }
    };

    void handleInitialFlow();
  }, [
    isSessionLoading,
    isGraphReady,
    initialMessage,
    createNewSession,
    sendMessage,
  ]);

  // --- 处理用户提交 ---
  const { run: handleUserSubmit } = useRequest(
    async (val: string) => {
      const input = val.trim();
      if (!input) return;
      if (showLogo) setShowLogo(false);

      if (input === "/new") {
        await createNewSession();
        return;
      }
      if (input === "/exit") {
        exit();
        return;
      }
      if (input.startsWith("/switch ")) {
        const targetId = input.replace("/switch ", "").trim();
        const realId = await switchSession(targetId);
        if (!realId)
          appendLocalMessage("system", `❌ Session not found: ${targetId}`);
        return;
      }
      if (input === "/list") {
        const report = sessionList
          .map((s) => {
            const id = s.metadata?.thread_id || "unknown";
            const title = s.metadata?.title || "Untitled";
            const count = s.metadata?.message_count || 0;
            return `ID: ${id} | 📝 ${title} | 💬 ${count}`;
          })
          .join("\n");
        appendLocalMessage(
          "system",
          `=== Session List ===
${report}
Use /switch <id> to change.`,
        );
        return;
      }

      if (!threadId) return;

      try {
        const processedResult = await processInput(input);

        // 🔥 新增：检查当前会话是否有 todos
        // 如果有 todos，说明正在执行任务，用户输入新消息时应该创建新会话
        const config = { configurable: { thread_id: threadId } };
        const snapshot = await graph.getState(config);
        const currentTodos = (snapshot.values as any)?.todos || [];

        // 如果当前会话有 todos（正在执行任务），自动创建新会话
        if (currentTodos.length > 0) {
          console.log(
            `[Auto-New-Session] 检测到当前会话有 ${currentTodos.length} 个 todos，自动创建新会话`,
          );
          appendLocalMessage("system", "🔄 检测到新任务，自动创建新会话...");
          await createNewSession();
          // 等待新会话创建完成
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        appendLocalMessage("user", processedResult.content, undefined, {
          ...processedResult.metadata,
          pendingFilePaths: processedResult.pendingFilePaths,
        });
        sendMessage(
          processedResult.content,
          false,
          processedResult.pendingFilePaths,
        );
      } catch (error: any) {
        console.error("User submit error:", error);
        appendLocalMessage("system", `Error: ${error.message}`);
      }
    },
    { manual: true },
  );

  // --- 处理审批 ---
  const { run: handleApprovalSelect } = useRequest(
    // ... 这里的逻辑保持不变 ...
    async (value: "approve" | "reject") => {
      if (!pendingTool || !threadId) return;

      try {
        const isApproved = value === "approve";
        const content = isApproved
          ? `🛠️ Approved execution of: ${pendingTool.name}`
          : `🚫 Rejected execution of: ${pendingTool.name}`;

        appendLocalMessage("system", content);

        if (isApproved) {
          sendMessage(null, true);
        } else {
          const config = { configurable: { thread_id: threadId } };
          const snapshot = await graph.getState(config);
          const lastMsg =
            snapshot.values.messages[snapshot.values.messages.length - 1];

          if (lastMsg?.tool_calls?.length) {
            const rejectionMessages = lastMsg.tool_calls.map(
              (tc: any) =>
                new ToolMessage({
                  tool_call_id: tc.id,
                  name: tc.name,
                  content: "User rejected the tool execution.",
                }),
            );
            await graph.updateState(config, { messages: rejectionMessages });
          }
          sendMessage(null, true);
        }
      } catch (error) {
        console.error("Approval error", error);
        appendLocalMessage("system", "Error processing approval.");
      }
    },
    { manual: true },
  );

  const stableSessionList = useMemo(() => {
    return sessionList;
  }, [JSON.stringify(sessionList.map((s) => s.metadata?.thread_id))]);

  // 🔥 修改 5: 更新 Loading 界面
  // 如果 Session 在加载，或者 Graph 还没初始化完成
  if (isSessionLoading || !isGraphReady) {
    return (
      <Box padding={1}>
        <Text color="green">
          {isSessionLoading
            ? "⟳ Loading Session..."
            : "⟳ Initializing Agent Graph..."}
        </Text>
      </Box>
    );
  }

  // 如果 Graph 初始化失败
  if (graphError) {
    return (
      <Box padding={1}>
        <Text color="red">❌ Failed to start Agent: {graphError}</Text>
      </Box>
    );
  }

  if (!threadId) {
    return (
      <Box padding={1}>
        <Text color="red">Failed to initialize session.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {showLogo && <Header />}

      {/* 消息列表区域 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Static items={history}>
          {(item) => <HistoryItem key={item.id} item={item} />}
        </Static>

        {(isThinking ||
          currentAIContent ||
          currentReasoning ||
          currentTool) && (
          <Box flexDirection="row" marginBottom={0} marginTop={1}>
            <Box width={2} marginRight={1}>
              <StatusBadge role="ai" />
            </Box>
            <Box flexDirection="column" flexGrow={1}>
              {(currentReasoning || currentTool) && (
                <Box marginBottom={currentAIContent ? 1 : 0}>
                  <MinimalThinking
                    content={currentReasoning}
                    toolName={currentTool?.name}
                  />
                </Box>
              )}
              {currentAIContent && <MarkdownText content={currentAIContent} />}
            </Box>
          </Box>
        )}
      </Box>

      {/* 底部输入框区域 */}
      <Box flexDirection="column" marginTop={1}>
        <StatusBar threadId={threadId} />

        <Box paddingX={1} paddingBottom={1}>
          {awaitingApproval ? (
            <ApprovalCard tool={pendingTool!} onSelect={handleApprovalSelect} />
          ) : (
            <InputArea
              onSubmit={handleUserSubmit}
              isLoading={isThinking}
              sessions={stableSessionList}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
};
