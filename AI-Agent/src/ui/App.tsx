import { FC, useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph, initializeGraph } from "../agent/graph.ts";
import { Header } from "./components/Header.tsx";
import { MinimalThinking } from "./components/MinimalThinking.tsx";
import {
  IntentOutput,
  ProjectPlanOutput,
  TodosOutput,
} from "./components/StructuredOutput.tsx";
import { parseStreamingStructuredOutput } from "./utils/formatStructuredOutput.ts";
import { ApprovalCard } from "./components/ApprovalCard.tsx";
import { HistoryItem } from "./components/HistoryItem.tsx";
import { InputArea } from "./components/TextInput/InputArea.tsx";
import { useSessionManager } from "./hooks/useSessionManager.ts";
import { useMessageProcessor } from "./hooks/useMessageProcessor.ts";
import { StatusBar } from "./components/StatusBar.tsx";
import { Command } from "@langchain/langgraph";
import { UIMessage } from "./utils/adapter.ts";

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

  const [isGraphReady, setIsGraphReady] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const {
    activeSessionId: threadId,
    currentHistory: history,
    isLoading: isSessionLoading,
    sessionList,
    createNewSession,
    switchSession,
    // 🔥 修改: 不再导出 addMessage，因为由 Agent 自动持久化
    // addMessage,
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

  // 初始化 Graph 的 Effect
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
      if (!isGraphReady || !graph) return;
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
          ? new Command({ resume: "approved" })
          : {
              messages: [new HumanMessage(text!)],
              pendingFilePaths: pendingFiles,
            };

        const stream = await graph.streamEvents(inputs, config);
        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

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
          }
          else if (event.event === "on_chat_model_end") {
            const output = event.data.output;
            if (
              output &&
              typeof output.content === "string" &&
              output.content.length > 0 &&
              !fullContent
            ) {
              fullContent = output.content;
              setCurrentAIContent(fullContent);

              const reasoning =
                output.additional_kwargs?.reasoning_content ||
                (output as any).reasoning_content;
              if (reasoning && !fullReasoning) {
                fullReasoning = reasoning;
                setCurrentReasoning(fullReasoning);
              }
            }
          }
          else if (event.event === "on_tool_start") {
            setCurrentTool({
              name: event.name,
              input: JSON.stringify(event.data.input),
            });
          } else if (event.event === "on_tool_end") {
            setCurrentTool(null);
            // 🔥 无需手动保存工具消息
          }
        }

        // --- AI 回复完成 ---
        if (fullContent || fullReasoning) {
          // 🔥 无需手动保存 AI 消息
          
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);

          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
          });
        }

        const snapshot = await graph.getState(config);
        const currentValues = snapshot.values as any;

        const updatePayload = {
          ...currentValues,
          messages: currentValues.messages,
          currentTask:
            fullContent.slice(0, 50) ||
            currentValues.currentTask ||
            "Processing",
        };

        if (storage.checkpoints) {
          await storage.checkpoints.saveCheckpoint(
            threadId,
            updatePayload,
            undefined,
          );
        } else {
          await (storage.sessions as any).saveCheckpoint(
            threadId,
            updatePayload,
            { description: "Turn completed", stepType: "agent" },
          );
        }

        const pendingToolCalls = snapshot.values.pendingToolCalls || [];
        if (pendingToolCalls.length > 0) {
          const lastMsg =
            snapshot.values.messages[snapshot.values.messages.length - 1];
          let toolData = null;
          if (lastMsg?.tool_calls?.length) {
            toolData = {
              name: lastMsg.tool_calls[0].name,
              args: lastMsg.tool_calls[0].args,
            };
          } else if (pendingToolCalls[0] && pendingToolCalls[0].name) {
            toolData = {
              name: pendingToolCalls[0].name,
              args: pendingToolCalls[0].args || {},
            };
          }
          if (toolData) {
            setPendingTool(toolData);
            setAwaitingApproval(true);
          }
        }
      } catch (e: any) {
        console.error(e);
        // 🔥 系统错误日志如果不需要持久化到历史，可以注释掉；
        // 如果需要显示错误，建议使用临时状态，或者如果你确定 SystemMessage 也要走 Graph 存储，
        // 则通过 Graph 机制处理。这里遵循指令注释掉手动 addMessage。
        // await addMessage("system", `Error: ${e.message}`);
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
        // if (!realId)
        //   await addMessage("system", `❌ Session not found: ${targetId}`);
        return;
      }
      if (input === "/list") {
         // UI List 显示逻辑已在组件内部或通过其他方式处理
         // 这里的 System message 打印列表如果也是“手动addMessage”，则注释掉
        return;
      }
      if (input.startsWith("/delete ")) {
        const targetId = input.replace("/delete ", "").trim();
        const targetSession = sessionList.find(
          (s) =>
            s.metadata?.thread_id === targetId ||
            s.metadata?.thread_id?.includes(targetId),
        );

        if (!targetSession) {
          // await addMessage("system", ...);
          return;
        }

        if (!targetSession.metadata?.thread_id) return;

        const fullSessionId = targetSession.metadata.thread_id;

        try {
          if (fullSessionId === threadId) {
            const otherSessions = sessionList.filter(
              (s) => s.metadata?.thread_id !== threadId,
            );

            if (otherSessions.length > 0) {
              const nextSession = otherSessions[0];
              if (!nextSession.metadata?.thread_id) return;
              await switchSession(nextSession.metadata.thread_id);
              // await addMessage("system", "Deleted and switched...");
              await storage.sessions.deleteSession(fullSessionId);
            } else {
              await createNewSession();
              // await addMessage("system", "Deleted and created new...");
              await storage.sessions.deleteSession(fullSessionId);
            }
          } else {
            await storage.sessions.deleteSession(fullSessionId);
            // await addMessage("system", "Deleted...");
          }
        } catch (error: any) {
          console.error("Delete session error:", error);
          // await addMessage("system", `Error: ${error.message}`);
        }
        return;
      }

      if (input === "/getSessionInfo" || input.startsWith("/getSessionInfo ")) {
        // ... 获取信息逻辑 ...
        // 原本展示信息的 addMessage 调用全部注释
        /*
          await addMessage("system", sessionInfoDisplay);
        */
        return;
      }

      if (!threadId) return;

      try {
        const processedResult = await processInput(input);
        
        // 🔥🔥🔥 核心修改: 注释掉手动添加用户消息
        // await addMessage("user", processedResult.content, undefined, {
        //   ...processedResult.metadata,
        //   pendingFilePaths: processedResult.pendingFilePaths,
        // });

        // 直接发送给 Agent，Agent 会在 Graph 中记录这条消息并持久化
        sendMessage(
          processedResult.content,
          false,
          processedResult.pendingFilePaths,
        );
      } catch (error: any) {
        console.error("User submit error:", error);
        // await addMessage("system", `Error: ${error.message}`);
      }
    },
    { manual: true },
  );

  // --- 处理审批 ---
  const { run: handleApprovalSelect } = useRequest(
    async (value: "approve" | "reject") => {
      if (!pendingTool || !threadId) return;

      try {
        const isApproved = value === "approve";
        // 🔥 注释掉手动记录审批日志
        // const content = isApproved
        //   ? `🛠️ Approved execution of: ${pendingTool.name}`
        //   : `🚫 Rejected execution of: ${pendingTool.name}`;
        // await addMessage("system", content);

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
        // await addMessage("system", "Error processing approval.");
      }
    },
    { manual: true },
  );

  const stableSessionList = useMemo(() => {
    return sessionList;
  }, [JSON.stringify(sessionList.map((s) => s.metadata?.thread_id))]);

  const { items: streamingStructuredItems, tail: streamingTail } = useMemo(
    () => parseStreamingStructuredOutput(currentAIContent || ""),
    [currentAIContent],
  );

  const uniqueStreamingItems = useMemo(() => {
    const latest = new Map<string, (typeof streamingStructuredItems)[number]>();
    streamingStructuredItems.forEach((item) => {
      latest.set(item.type, item);
    });
    const order = ["intent", "project_plan", "todos"];
    return order
      .map((t) => latest.get(t))
      .filter((v): v is (typeof streamingStructuredItems)[number] =>
        Boolean(v),
      );
  }, [streamingStructuredItems]);

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
  const seen = new Set<string>();
const uniqueHistory: UIMessage[] = history
  .filter(item => item.content !== "")
  .filter(item => {
    if (seen.has(item.content)) {
      return false;
    }
    seen.add(item.content);
    return true;
  });
  return (
    <Box flexDirection="column" height="100%">
      {showLogo && <Header />}

      {/* 消息列表区域 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {/* 
          HistoryItem 会根据 sessionManager 中的 history 自动渲染。
          由于 Agent 自动保存消息到数据库，useSessionManager 会自动拉取最新的 history，
          所以这里不需要手动 update 就可以看到新消息。
        */}
        <Static items={uniqueHistory}>
          {(item) => item.content !== "" && <HistoryItem key={item.id} item={item} />}
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
              {((isThinking && currentReasoning) || currentTool) && (
                <Box marginBottom={currentAIContent ? 1 : 0}>
                  <MinimalThinking
                    content={currentReasoning}
                    toolName={currentTool?.name}
                  />
                </Box>
              )}
              {uniqueStreamingItems.length > 0 &&
                uniqueStreamingItems.map((item, idx) => {
                  if (item.type === "intent") {
                    return (
                      <IntentOutput key={`intent-${idx}`} data={item.data} />
                    );
                  }
                  if (item.type === "project_plan") {
                    return (
                      <ProjectPlanOutput key={`plan-${idx}`} data={item.data} />
                    );
                  }
                  if (item.type === "todos") {
                    return <TodosOutput key={`todo-${idx}`} data={item.data} />;
                  }
                  return null;
                })}
              {streamingTail && streamingTail.trim().length > 0 && (
                <Text color="cyan">Processing structured output...</Text>
              )}
              {uniqueStreamingItems.length === 0 &&
                currentAIContent &&
                (!streamingTail || streamingTail.trim().length === 0) && (
                  <MarkdownText content={currentAIContent} />
                )}
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
