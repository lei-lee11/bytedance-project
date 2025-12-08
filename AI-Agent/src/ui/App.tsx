import { FC, useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
// 🔥 修改 1: 引入 initializeGraph 和 graph
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
      // ... 前面的检查代码保持不变 ...
      if (!isGraphReady || !graph) {
        /* ... */ return;
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
          // 1. 处理流式输出 (Streaming)
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
          // 🔥 新增: 处理非流式输出 (Non-streaming Invoke)
          // 闲聊节点(chatNode)通常直接调用 invoke，不会触发 stream 事件，
          // 但会触发 end 事件。我们需要在这里捕获最终回复。
          else if (event.event === "on_chat_model_end") {
            const output = event.data.output;
            // 只有当 output 是消息对象(有content)且之前没有收集到流内容时才使用
            // 这样可以避免意图分类节点(返回JSON对象)干扰，只捕获 chatNode 的文本回复
            if (
              output &&
              typeof output.content === "string" &&
              output.content.length > 0 &&
              !fullContent
            ) {
              fullContent = output.content;
              setCurrentAIContent(fullContent);

              // 如果有推理内容也一并捕获 (兼容部分非流式推理模型)
              const reasoning =
                output.additional_kwargs?.reasoning_content ||
                (output as any).reasoning_content;
              if (reasoning && !fullReasoning) {
                fullReasoning = reasoning;
                setCurrentReasoning(fullReasoning);
              }
            }
          }
          // ... 处理工具事件 (保持不变) ...
          else if (event.event === "on_tool_start") {
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
          // 这里的 fullContent 现在包含了来自 stream 或 end 事件的内容
          await addMessage("ai", fullContent, fullReasoning);

          // ... 后续清理逻辑保持不变 ...
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);

          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
          });
        }

        // ... Checkpoint 保存逻辑保持不变 ...
        // ... 中断处理逻辑保持不变 ...
        const snapshot = await graph.getState(config);
        // ... (原代码保持不变) ...
        const currentValues = snapshot.values as any;

        const updatePayload = {
          ...currentValues,
          messages: currentValues.messages,
          // 确保 currentTask 不会因为闲聊为空而报错
          currentTask:
            fullContent.slice(0, 50) ||
            currentValues.currentTask ||
            "Processing",
        };

        // ... (原代码保持不变直到函数结束) ...
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

        // 处理 Approval (原代码保持不变)
        const pendingToolCalls = snapshot.values.pendingToolCalls || [];
        // ... (Approval 逻辑) ...
        if (pendingToolCalls.length > 0) {
          // ...
          // 这里省略了重复代码，请保留原有的 Approval 处理逻辑
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
          } else {
            // ...
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
    //  修改 4: 增加 !isGraphReady 的判断
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
Use /switch <id> to change, /delete <id> to delete.
Use /getSessionInfo <id> to view detailed session information.`,
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

      // 处理 /getSessionInfo 命令
      if (input === "/getSessionInfo" || input.startsWith("/getSessionInfo ")) {
        const targetId = input.startsWith("/getSessionInfo ")
          ? input.replace("/getSessionInfo ", "").trim()
          : threadId; // 默认显示当前会话信息

        if (!targetId) {
          await addMessage(
            "system",
            "❌ No active session. Use /getSessionInfo <session_id> to specify a session.",
          );
          return;
        }

        try {
          // 获取会话详细信息
          const sessionInfo = await storage.sessions.getSessionInfo(targetId);

          if (!sessionInfo) {
            await addMessage(
              "system",
              `❌ Session not found: ${targetId}\nUse /list to see available sessions.`,
            );
            return;
          }

          // 格式化会话信息为美观的展示
          const {
            metadata,
            hasActiveCheckpoint,
            checkpointCount,
            historyCount,
          } = sessionInfo;

          // 计算会话持续时间
          const createdDate = new Date(metadata.created_at);
          const updatedDate = new Date(metadata.updated_at);
          const duration = updatedDate.getTime() - createdDate.getTime();
          const durationMinutes = Math.floor(duration / (1000 * 60));
          const durationHours = Math.floor(durationMinutes / 60);
          const durationDays = Math.floor(durationHours / 24);

          let durationStr = "";
          if (durationDays > 0) {
            durationStr = `${durationDays}天 ${durationHours % 24}小时`;
          } else if (durationHours > 0) {
            durationStr = `${durationHours}小时 ${durationMinutes % 60}分钟`;
          } else if (durationMinutes > 0) {
            durationStr = `${durationMinutes}分钟`;
          } else {
            durationStr = "刚刚创建";
          }

          // 获取会话统计信息
          const sessionStats = await storage.sessions.getSessionStats(targetId);

          const sessionInfoDisplay = `
🔍 会话详细信息
═══════════════════════════════════════════════════════════════

📋 基本信息
  🆔 会话ID: ${metadata.thread_id}
  📝 标题: ${metadata.title}
  📊 状态: ${metadata.status === "active" ? "🟢 活跃" : "📦 归档"}
  💬 消息数量: ${metadata.message_count}

📅 时间信息
  🕐 创建时间: ${createdDate.toLocaleString("zh-CN")}
  🔄 最后更新: ${updatedDate.toLocaleString("zh-CN")}
  ⏱️ 会话持续时间: ${durationStr}

💾 存储信息
  📦 检查点数量: ${checkpointCount}
  📜 历史记录数量: ${historyCount}
  ${hasActiveCheckpoint ? "✅ 有活跃检查点" : "❌ 无活跃检查点"}

📊 存储统计
  📁 存储大小: ${(sessionStats.size / 1024).toFixed(2)} KB

═══════════════════════════════════════════════════════════════
${targetId === threadId ? "✨ 这是当前活跃的会话" : ""}
`.trim();

          await addMessage("system", sessionInfoDisplay);
        } catch (error: any) {
          console.error("Get session info error:", error);
          await addMessage(
            "system",
            `❌ Failed to get session info: ${error.message}`,
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
      .filter((v): v is (typeof streamingStructuredItems)[number] =>
        Boolean(v),
      );
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
              {((isThinking && currentReasoning) || currentTool) && (
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
