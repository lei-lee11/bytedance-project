import React, { FC, useState, useEffect, useMemo } from "react";
import { Box, Text, Static, useApp } from "ink";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph } from "../agent/graph.js";
import { Header } from "./components/Header.tsx";
import { MinimalThinking } from "./components/MinimalThinking.tsx";
import { ApprovalCard } from "./components/ApprovalCard.tsx";
import { HistoryItem } from "./components/HistoryItem.tsx";
import { InputArea } from "./components/TextInput/InputArea.tsx";
import { storage } from "./test.js"; //测试用
import { useSessionManager } from "./hooks/useSessionManager.ts";
import { useMessageProcessor } from "./hooks/useMessageProcessor.ts";
import { StatusBar } from "./components/StatusBar.tsx";

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

// Markdown 组件
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

// 状态徽章组件
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
  const {
    activeSessionId: threadId,
    currentHistory: history,
    isLoading,
    sessionList,
    createNewSession,
    switchSession,
    addMessage, // 统一的消息添加入口（自动处理 UI + 持久化）
  } = useSessionManager();
  const { processInput, isProcessing: isContextProcessing } =
    useMessageProcessor();
  // 实时状态
  const [currentAIContent, setCurrentAIContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [currentTool, setCurrentTool] = useState<ToolState | null>(null);
  const [pendingTool, setPendingTool] = useState<PendingToolState | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // 如果传入了 initialMessage，我们强制开启一个新会话，而不是加载旧的
  // 使用 ref 确保初始消息只处理一次，防止重复创建会话
  const hasProcessedInitial = React.useRef(false);

  // --- 发送消息逻辑 ---
  const { run: sendMessage, loading: isThinking } = useRequest(
    async (
      text: string | null,
      isResume = false,
      pendingFiles: string[] = [],
    ) => {
      if (!threadId) return;

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

        for await (const event of stream) {
          // --- Chat Model Stream 处理 ---
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;
            let reasoningChunk = "";
            if (chunk.additional_kwargs?.reasoning_content) {
              reasoningChunk = chunk.additional_kwargs.reasoning_content;
            } else if ((chunk as any).reasoning_content) {
              reasoningChunk = (chunk as any).reasoning_content;
            }

            if (reasoningChunk) {
              fullReasoning += reasoningChunk;
              setCurrentReasoning(fullReasoning);
            }

            if (chunk.content && typeof chunk.content === "string") {
              fullContent += chunk.content;
              setCurrentAIContent(fullContent);
            }
          }
          // --- 工具状态处理 ---
          else if (event.event === "on_tool_start") {
            setCurrentTool({
              name: event.name,
              input: JSON.stringify(event.data.input),
            });
          }
          // --- 工具结束处理 ---
          else if (event.event === "on_tool_end") {
            setCurrentTool(null);
            await addMessage("tool", `Executed ${event.name}`, undefined);
          }
        }

        // --- AI 回复完成处理 ---
        if (fullContent || fullReasoning) {
          // [核心修改] 使用 Hook 添加 AI 消息
          await addMessage("ai", fullContent, fullReasoning);
          setCurrentAIContent("");
          setCurrentReasoning("");
          setCurrentTool(null);
          // 更新会话元数据
          await storage.sessions.updateSessionMetadata(threadId, {
            status: "active",
          });
        }

        // --- 保存 Checkpoint  ---
        // Checkpoint 是 Agent 运行状态，不属于简单的“聊天记录”，所以直接调 storage
        const snapshot = await graph.getState(config);
        await storage.checkpoints.createCheckpoint(
          threadId,
          {
            messages: snapshot.values.messages,
            currentTask: fullContent.slice(0, 50),
            programmingLanguage:
              snapshot.values.programmingLanguage || "unknown",
          },
          {
            description: "Turn completed",
            stepType: "agent",
          },
        );

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
        const errMsg = `Error: ${e.message}`;
        await addMessage("system", errMsg);
      }
    },
    { manual: true },
  );
  useEffect(() => {
    // 如果还在加载 storage，或者没有初始消息，或者已经处理过了，直接返回
    if (isLoading || !initialMessage || hasProcessedInitial.current) {
      return;
    }

    const handleInitialFlow = async () => {
      // 标记为已处理
      hasProcessedInitial.current = true;

      try {
        // 强制创建一个新会话 (不管 Hook 默认加载了什么旧会话)
        await createNewSession();

        // 稍微延迟一点点以确保状态更新，然后发送消息
        setTimeout(() => {
          sendMessage(initialMessage);
        }, 100);
      } catch (e) {
        console.error("Failed to handle initial message:", e);
      }
    };

    void handleInitialFlow();

    // 依赖项：只要 isLoading 变化（变为 false）或者 initialMessage 变化，就检查是否需要执行
  }, [isLoading, initialMessage, createNewSession, sendMessage]);

  // --- 处理用户输入 (集成指令系统) ---
  const { run: handleUserSubmit } = useRequest(
    async (val: string) => {
      const input = val.trim();
      if (!input) return;
      if (showLogo) setShowLogo(false);

      const processedResult = await processInput(input);
      // 第三步：存入数据库 & 更新 UI
      await addMessage(
        "user",
        processedResult.content, // 这里是包含了文件内容的完整 Prompt
        undefined,
        {
          ...processedResult.metadata,
          pendingFilePaths: processedResult.pendingFilePaths, // 添加 pendingFilePaths 到 metadata
        },
      );
      // ---  指令处理逻辑 ---

      // 1. 新建会话
      if (input === "/new") {
        await createNewSession();
        // 可以在 UI 上显示一条临时的系统提示（不存库）
        return;
      }

      // 2. 列出会话
      if (input === "/list") {
        const report = sessionList
          .map((s) => {
            // 或者直接显示 s.metadata.thread_id (最安全)
            const displayId = s.metadata.thread_id;

            return `ID: ${displayId} | 📝 ${s.metadata.title || "Untitled"} | 💬 ${s.metadata.message_count}`;
          })
          .join("\n");
        await addMessage(
          "system",
          `
=== Session List ===
${report}
Use /switch <id> to change session.`,
        );
        return;
      }

      // 3. 切换会话
      if (input.startsWith("/switch ")) {
        const targetId = input.replace("/switch ", "").trim();
        const realId = await switchSession(targetId);
        if (realId) {
          // 切换成功，history 会自动更新，这里可以加个提示
        } else {
          await addMessage("system", `❌ Session not found: ${targetId}`);
        }
        return;
      }

      // 4. 退出
      if (input === "/exit") {
        exit();
        return;
      }

      // --- 正常对话逻辑 ---

      if (!threadId) return;

      try {
        //  使用 Hook 添加用户消息
        await addMessage("user", input);

        // 触发 AI
        sendMessage(
          processedResult.content,
          false, // isResume
          processedResult.pendingFilePaths,
        );
      } catch (error) {
        console.error("Failed to process user message:", error);
        await addMessage("system", "Error: Failed to process message.");
      }
    },
    { manual: true },
  );

  // --- 处理工具审批 ---
  const { run: handleApprovalSelect } = useRequest(
    async (value: "approve" | "reject") => {
      if (!pendingTool || !threadId) return;

      try {
        const isApproved = value === "approve";
        const content = isApproved
          ? `🛠️ Approved execution of: ${pendingTool.name}`
          : `🚫 Rejected execution of: ${pendingTool.name}`;

        //  使用 Hook 记录审批结果
        await addMessage("system", content);

        if (isApproved) {
          sendMessage(null, true);
        } else {
          // LangGraph 状态更新逻辑 (保持不变)
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
  }, [JSON.stringify(sessionList.map((s) => s.metadata.thread_id))]);
  // 加载中状态
  if (isLoading) {
    return (
      <Box padding={1}>
        <Text color="green">⟳ Loading persistent session...</Text>
      </Box>
    );
  }

  // 如果没有 threadId (极少数情况，比如列表为空且创建失败)，显示错误
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

      {/*  聊天主区域 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {/* 历史记录 */}
        <Static items={history}>
          {(item) => <HistoryItem key={item.id} item={item} />}
        </Static>

        {/* 实时流式输出区域 */}
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

      {/*   底部固定区域 */}
      <Box flexDirection="column" marginTop={1}>
        <StatusBar threadId={threadId} />

        <Box paddingX={1} paddingBottom={1}>
          {/* 这里的 InputArea 现在包含了 SuggestionBox */}
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
