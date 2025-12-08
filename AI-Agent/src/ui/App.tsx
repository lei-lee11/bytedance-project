import { FC, useState, useEffect, useMemo, useRef } from "react";
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
import { Command } from "@langchain/langgraph";

// ... marked 配置 ...
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

  const [isGraphReady, setIsGraphReady] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const {
    activeSessionId: threadId,
    currentHistory: history,
    isLoading: isSessionLoading,
    sessionList,
    createNewSession,
    switchSession,
    addMessage,
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

  // 初始化 Graph
  useEffect(() => {
    const init = async () => {
      try {
        await initializeGraph();
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
        await addMessage(
          "system",
          "Error: Agent graph is not initialized yet.",
        );
        return;
      }
      if (!threadId || !storage) return;

      // 重置实时状态
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
        // 构造输入：如果是恢复，使用 resume Command；否则发送 HumanMessage
        const inputs = isResume
          ? new Command({ resume: "approved" })
          : {
              messages: [new HumanMessage(text!)],
              pendingFilePaths: pendingFiles,
            };

        const stream = await graph.streamEvents(inputs, config);

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

        // 处理流式输出
        for await (const event of stream) {
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;
            const reasoningChunk =
              chunk.additional_kwargs?.reasoning_content ||
              (chunk as any).reasoning_content ||
              "";

            if (reasoningChunk) {
              fullReasoning += reasoningChunk;
              setCurrentReasoning(fullReasoning);
            }

            if (chunk.content && typeof chunk.content === "string") {
              fullContent += chunk.content;
              setCurrentAIContent(fullContent);
            }
          } else if (event.event === "on_tool_start") {
            setCurrentTool({
              name: event.name,
              input: JSON.stringify(event.data.input),
            });
          } else if (event.event === "on_tool_end") {
            setCurrentTool(null);
            // 记录工具执行结果到 UI 历史
            await addMessage(
              "tool",
              event.data.output || "Executed",
              undefined,
              { tool_name: event.name },
            );
          }
        }

        // --- 回合结束处理 ---
        if (fullContent || fullReasoning) {
          // 将 AI 最终回复添加到 UI 历史
          await addMessage("ai", fullContent, fullReasoning);
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);

          // ✅ 仅更新会话元数据（用于列表展示），绝不触碰 checkpoints
          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
            // 可以在这里更新摘要，以便在列表中显示最新动态
            // description: fullContent.slice(0, 50) + "..."
          });
        }

        // ❌ [已删除] 手动保存 Checkpoint 的代码块
        // 之前这里的 storage.checkpoints.saveCheckpoint(...) 导致了元数据损坏

        // --- 处理中断 (Approval) ---
        // 获取当前最新状态（由 LangGraph 自动保存）
        const snapshot = await graph.getState(config);
        const pendingToolCalls = snapshot.values.pendingToolCalls || [];

        // 检查是否有挂起的工具调用
        if (pendingToolCalls.length > 0) {
          // 优先从 state.pendingToolCalls 获取，这比解析 message 更准确
          const toolCall = pendingToolCalls[0];

          if (toolCall && toolCall.name) {
            const toolData = {
              name: toolCall.name,
              args: toolCall.args || {},
            };
            setPendingTool(toolData);
            setAwaitingApproval(true);
          } else {
            // 兜底逻辑：尝试从最后一条消息解析
            const lastMsg =
              snapshot.values.messages[snapshot.values.messages.length - 1];
            if (lastMsg?.tool_calls?.length) {
              setPendingTool({
                name: lastMsg.tool_calls[0].name,
                args: lastMsg.tool_calls[0].args,
              });
              setAwaitingApproval(true);
            } else {
              console.warn(
                "System paused for approval but no tool data found.",
              );
            }
          }
        }
      } catch (e: any) {
        console.error(e);
        const errMsg = `Error: ${e.message}`;
        await addMessage("system", errMsg);
      }
    },
    { manual: true },
  );

  // --- 初始化 Effect ---
  useEffect(() => {
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

      // --- 命令处理 ---
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
          await addMessage("system", `❌ Session not found: ${targetId}`);
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
        await addMessage(
          "system",
          `=== Session List ===
${report}
Use /switch <id> to change, /delete <id> to delete.`,
        );
        return;
      }
      if (input.startsWith("/delete ")) {
        const targetId = input.replace("/delete ", "").trim();
        if (!targetId) {
          await addMessage("system", "❌ Usage: /delete <session_id>");
          return;
        }

        const targetSession = sessionList.find(
          (s) =>
            s.metadata?.thread_id === targetId ||
            s.metadata?.thread_id?.includes(targetId),
        );

        if (!targetSession || !targetSession.metadata?.thread_id) {
          await addMessage("system", `❌ Session not found: ${targetId}`);
          return;
        }

        const fullSessionId = targetSession.metadata.thread_id;
        try {
          if (fullSessionId === threadId) {
            // 如果删除的是当前会话，尝试切换到其他会话或新建
            const otherSessions = sessionList.filter(
              (s) => s.metadata?.thread_id !== threadId,
            );
            if (otherSessions.length > 0) {
              await switchSession(otherSessions[0].metadata.thread_id);
              await storage.sessions.deleteSession(fullSessionId);
              await addMessage(
                "system",
                `✅ Deleted active session and switched.`,
              );
            } else {
              const newId = await createNewSession();
              await storage.sessions.deleteSession(fullSessionId);
              await addMessage(
                "system",
                `✅ Deleted active session and created new one: ${newId}`,
              );
            }
          } else {
            await storage.sessions.deleteSession(fullSessionId);
            await addMessage("system", `✅ Deleted session: ${fullSessionId}`);
          }
        } catch (error: any) {
          await addMessage("system", `❌ Failed to delete: ${error.message}`);
        }
        return;
      }

      if (!threadId) return;

      // --- 正常对话处理 ---
      try {
        const processedResult = await processInput(input);

        // 1. UI 立即显示用户消息
        await addMessage("user", processedResult.content, undefined, {
          ...processedResult.metadata,
          pendingFilePaths: processedResult.pendingFilePaths,
        });

        // 2. 发送给 Agent
        sendMessage(
          processedResult.content,
          false,
          processedResult.pendingFilePaths,
        );
      } catch (error: any) {
        console.error("User submit error:", error);
        await addMessage("system", `Error: ${error.message}`);
      }
    },
    { manual: true },
  );

  // --- 处理审批选择 ---
  const { run: handleApprovalSelect } = useRequest(
    async (value: "approve" | "reject") => {
      if (!pendingTool || !threadId) return;

      try {
        const isApproved = value === "approve";
        const content = isApproved
          ? `🛠️ Approved execution of: ${pendingTool.name}`
          : `🚫 Rejected execution of: ${pendingTool.name}`;

        await addMessage("system", content);

        if (isApproved) {
          // 批准：带着 resume 指令继续
          sendMessage(null, true);
        } else {
          // 拒绝：更新状态插入拒绝消息，然后带着 resume 指令继续
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
            // 这里 updateState 是安全的，因为它通过 LangGraph API 操作
            await graph.updateState(config, { messages: rejectionMessages });
          }
          // 拒绝后也需要 resume，让 LLM 看到 ToolMessage(rejected)
          sendMessage(null, true);
        }
      } catch (error) {
        console.error("Approval error", error);
        await addMessage("system", "Error processing approval.");
      }
    },
    { manual: true },
  );

  const stableSessionList = useMemo(() => {
    return sessionList;
  }, [JSON.stringify(sessionList.map((s) => s.metadata?.thread_id))]);

  // --- 渲染部分 ---

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
