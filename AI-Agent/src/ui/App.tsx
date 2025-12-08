import { FC, useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
// 🔥 修改 1: 引入 initializeGraph 和 graph
import { graph, initializeGraph } from "../agent/graph.js";
import { Header } from "./components/Header.tsx";
import { MinimalThinking } from "./components/MinimalThinking.tsx";
import {
  IntentOutput,
  ProjectPlanOutput,
  TodosOutput,
} from "./components/StructuredOutput.tsx";
import {
  parseStreamingStructuredOutput,
} from "./utils/formatStructuredOutput.ts";
import { ApprovalCard } from "./components/ApprovalCard.tsx";
import { HistoryItem } from "./components/HistoryItem.tsx";
import { InputArea } from "./components/TextInput/InputArea.tsx";
import { useSessionManager } from "./hooks/useSessionManager.ts";
import { useMessageProcessor } from "./hooks/useMessageProcessor.ts";
import { StatusBar } from "./components/StatusBar.tsx";
import { Command } from "@langchain/langgraph";
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
        await addMessage(
          "system",
          "Error: Agent graph is not initialized yet.",
        );
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
          ? new Command({ resume: "approved" }) // 使用 Command 明确指示恢复执行
          : {
              messages: [new HumanMessage(text!)],
              pendingFilePaths: pendingFiles,
            };

        const stream = await graph.streamEvents(inputs, config);

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

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
            await addMessage(
              "tool",
              event.data.output || "Executed",
              undefined,
              { tool_name: event.name },
            );
          }
        }

        // --- AI 回复完成 ---
        if (fullContent || fullReasoning) {
          await addMessage("ai", fullContent, fullReasoning);
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);

          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
          });
        }

        // --- 保存 Checkpoint (🔥 修复的部分) ---
        const snapshot = await graph.getState(config);
        const currentValues = snapshot.values as any; // 强制转换以便解构

        const updatePayload = {
          ...currentValues, // 继承 retryCount, projectTreeInjected 等所有字段
          messages: currentValues.messages,
          currentTask:
            fullContent.slice(0, 50) ||
            currentValues.currentTask ||
            "Processing",
          // ❌ 已彻底移除 programmingLanguage
        };

        if (storage.checkpoints) {
          await storage.checkpoints.saveCheckpoint(
            threadId,
            updatePayload,
            undefined, // 第三个参数是 checkpointId，传 undefined
          );
        } else {
          // 兼容旧接口逻辑
          await (storage.sessions as any).saveCheckpoint(
            threadId,
            updatePayload,
            {
              description: "Turn completed",
              stepType: "agent",
            },
          );
        }

        // --- 处理中断 (Approval) ---
        // 检查是否有需要审批的工具调用
        const pendingToolCalls = snapshot.values.pendingToolCalls || [];

        if (pendingToolCalls.length > 0) {
          const lastMsg =
            snapshot.values.messages[snapshot.values.messages.length - 1];

          // 1. 尝试从最后一条消息获取
          let toolData = null;

          if (lastMsg?.tool_calls?.length) {
            toolData = {
              name: lastMsg.tool_calls[0].name,
              args: lastMsg.tool_calls[0].args,
            };
          }
          // 2. 兜底策略：如果消息里没找到，尝试直接从 state 的 pendingToolCalls 数组中获取
          // (假设你的 Graph state 中 pendingToolCalls 存储了工具对象)
          else if (pendingToolCalls[0] && pendingToolCalls[0].name) {
            toolData = {
              name: pendingToolCalls[0].name,
              args: pendingToolCalls[0].args || {},
            };
          }

          // 🔥 关键修复：只有当成功获取到 toolData 时，才设置审批状态
          if (toolData) {
            setPendingTool(toolData);
            setAwaitingApproval(true);
          } else {
            console.warn(
              "Detected pending tool calls but could not extract tool data:",
              pendingToolCalls,
            );
            // 可选：添加一条系统消息提示错误，避免界面卡死
            await addMessage(
              "system",
              "⚠️ System paused for approval, but tool data is missing.",
            );
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
      // ... 这里的逻辑基本保持不变 ...
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

        // 验证目标会话ID
        if (!targetId) {
          await addMessage(
            "system",
            "❌ Please specify a session ID to delete. Usage: /delete <session_id>",
          );
          return;
        }

        // 检查会话是否存在
        const targetSession = sessionList.find(
          (s) =>
            s.metadata?.thread_id === targetId ||
            s.metadata?.thread_id?.includes(targetId),
        );

        if (!targetSession) {
          await addMessage(
            "system",
            `❌ Session not found: ${targetId}\nUse /list to see available sessions.`,
          );
          return;
        }

        // 确保会话有有效的metadata和thread_id
        if (!targetSession.metadata?.thread_id) {
          await addMessage(
            "system",
            `❌ Invalid session data: Missing thread_id for session`,
          );
          return;
        }

        const fullSessionId = targetSession.metadata.thread_id;
        const sessionTitle = targetSession.metadata?.title || "Untitled";

        try {
          // 处理删除当前活跃会话的情况
          if (fullSessionId === threadId) {
            // 检查是否有其他会话可以切换
            const otherSessions = sessionList.filter(
              (s) => s.metadata?.thread_id !== threadId,
            );

            if (otherSessions.length > 0) {
              // 有其他会话，先切换到最近的会话，再删除当前会话
              const nextSession = otherSessions[0];

              // 确保下一个会话有有效的metadata和thread_id
              if (!nextSession.metadata?.thread_id) {
                await addMessage(
                  "system",
                  `❌ Invalid session data: Missing thread_id for next session`,
                );
                return;
              }

              const nextSessionId = nextSession.metadata.thread_id;

              // 先切换到新会话
              await switchSession(nextSessionId);

              // 然后记录系统消息到新会话
              await addMessage(
                "system",
                `✅ Deleted current session: ${fullSessionId} (${sessionTitle})\n🔄 Automatically switched to: ${nextSessionId}`,
              );

              // 最后删除原会话
              await storage.sessions.deleteSession(fullSessionId);
            } else {
              // 没有其他会话，先创建新会话
              const newSessionId = await createNewSession();

              // 记录系统消息到新会话
              await addMessage(
                "system",
                `✅ Deleted current session: ${fullSessionId} (${sessionTitle})\n🆕 Created new session: ${newSessionId}`,
              );

              // 最后删除原会话
              await storage.sessions.deleteSession(fullSessionId);
            }
          } else {
            // 删除非当前会话
            await storage.sessions.deleteSession(fullSessionId);
            await addMessage(
              "system",
              `✅ Successfully deleted session: ${fullSessionId} (${sessionTitle})`,
            );
          }
        } catch (error: any) {
          console.error("Delete session error:", error);
          await addMessage(
            "system",
            `❌ Failed to delete session: ${error.message}`,
          );
        }
        return;
      }

      if (!threadId) return;

      try {
        const processedResult = await processInput(input);
        await addMessage("user", processedResult.content, undefined, {
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
        await addMessage("system", `Error: ${error.message}`);
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

        await addMessage("system", content);

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
        await addMessage("system", "Error processing approval.");
      }
    },
    { manual: true },
  );

  const stableSessionList = useMemo(() => {
    return sessionList;
  }, [JSON.stringify(sessionList.map((s) => s.metadata?.thread_id))]);

  // 流式内容的结构化解析：提取已闭合的 JSON，并保留未闭合尾巴
  const { items: streamingStructuredItems, tail: streamingTail } = useMemo(
    () => parseStreamingStructuredOutput(currentAIContent || ""),
    [currentAIContent],
  );

  // 仅保留每种类型的最新一份（避免同类重复渲染）
  const uniqueStreamingItems = useMemo(() => {
    const latest = new Map<string, (typeof streamingStructuredItems)[number]>();
    streamingStructuredItems.forEach((item) => {
      latest.set(item.type, item);
    });
    const order = ["intent", "project_plan", "todos"];
    return order
      .map((t) => latest.get(t))
      .filter((v): v is (typeof streamingStructuredItems)[number] => Boolean(v));
  }, [streamingStructuredItems]);

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
              {/* 流式结构化展示 */}
              {uniqueStreamingItems.length > 0 &&
                uniqueStreamingItems.map((item, idx) => {
                  if (item.type === "intent") {
                    return <IntentOutput key={`intent-${idx}`} data={item.data} />;
                  }
                  if (item.type === "project_plan") {
                    return (
                      <ProjectPlanOutput
                        key={`plan-${idx}`}
                        data={item.data}
                      />
                    );
                  }
                  if (item.type === "todos") {
                    return <TodosOutput key={`todo-${idx}`} data={item.data} />;
                  }
                  return null;
                })}
              {/* 未闭合的尾巴用提示替代，避免原样输出 JSON 片段 */}
              {streamingTail && streamingTail.trim().length > 0 && (
                <Text color="cyan">Processing structured output...</Text>
              )}
              {/* 如果没有结构化结果且有普通文本，仍然用 Markdown 显示 */}
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
