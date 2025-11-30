import React, { FC,useState, useEffect, useMemo } from "react";
import { Box, Text, Static } from "ink"; // 移除了不必要的 Newline
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph } from "../agent/graph.js";
import { Header } from "./Header.js";
import { MinimalThinking } from "./MinimalThinking.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { InputArea } from "./InputArea.js";

// --- 配置 Markdown ---
marked.setOptions({
  renderer: new TerminalRenderer({
    code: (code: any) => code,
    blockquote: (quote: string) => `│ ${quote}`,
    firstHeading: (text: string) => `
# ${text}`, // 优化标题间距
  }) as any,
});

// --- 类型定义 ---
type UIMessage = {
  id: string;
  role: "user" | "ai" | "system";
  content: string;
  reasoning?: string;
};

type ToolState = { name: string; input: string };
type PendingToolState = { name: string; args: any };

const THREAD_ID = "cli-session-v1";
const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Markdown 渲染组件
const MarkdownText = ({ content }: { content: string }) => {
  const formattedText = useMemo(() => {
    try {
      return (marked(content) || content);
    } catch {
      return content;
    }
  }, [content]);
  return <Text>{formattedText}</Text>;
};

// 状态图标组件
const StatusBadge = ({ role }: { role: string }) => {
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

export const App : FC<{ initialMessage?: string }> = ({ initialMessage }: { initialMessage?: string }) => {
  const [showLogo, setShowLogo] = useState(true);
  const [history, setHistory] = useState<UIMessage[]>([]);

  // 状态管理
  const [currentAIContent, setCurrentAIContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [currentTool, setCurrentTool] = useState<ToolState | null>(null);
  const [pendingTool, setPendingTool] = useState<PendingToolState | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // --- 发送消息逻辑 ---
  const { run: sendMessage, loading: isThinking } = useRequest(
    async (text: string | null, isResume = false) => {
      // 重置当前流状态
      setCurrentAIContent("");
      setCurrentReasoning("");
      setCurrentTool(null);
      setPendingTool(null);
      setAwaitingApproval(false);

      const config = {
        configurable: { thread_id: THREAD_ID },
        version: "v2" as const,
      };

      try {
        const inputs = isResume
          ? null
          : { messages: [new HumanMessage(text!)] };
        const stream = await graph.streamEvents(inputs, config);

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

        for await (const event of stream) {
          // 1. 处理流式输出
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;

            // 提取思考内容
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
          // 2. 工具开始
          else if (event.event === "on_tool_start") {
            setCurrentTool({
              name: event.name,
              input: JSON.stringify(event.data.input),
            });
          }
          // 3. 工具结束
          else if (event.event === "on_tool_end") {
            setCurrentTool(null);
          }
        }

        // 流束后，将内容存入历史
        if (fullContent || fullReasoning) {
          setHistory((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "ai",
              content: fullContent,
              reasoning: fullReasoning,
            },
          ]);
          // 清空实时显示
          setCurrentAIContent("");
          setCurrentReasoning("");
        }

        // 检查中断
        const snapshot = await graph.getState(config);
        if (snapshot.next.length > 0) {
          setAwaitingApproval(true);
          const lastMsg =
            snapshot.values.messages[snapshot.values.messages.length - 1];
          if (lastMsg?.tool_calls?.length) {
            const call = lastMsg.tool_calls[0];
            setPendingTool({ name: call.name, args: call.args });
          }
        }
      } catch (e: any) {
        setHistory((prev) => [
          ...prev,
          { id: generateId(), role: "system", content: `Error: ${e.message}` },
        ]);
      }
    },
    { manual: true },
  );

  // --- 拒绝逻辑 ---
  const { run: rejectExecution } = useRequest(
    async () => {
      const config = { configurable: { thread_id: THREAD_ID } };
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
        // 注意：这里不需要再 setHistory，因为 handleApprovalSelect 里已经添加了记录
      }
      sendMessage(null, true);
    },
    { manual: true },
  );

  // --- 初始化 ---
  useEffect(() => {
    if (initialMessage) {
      setHistory((prev) => [
        ...prev,
        { id: generateId(), role: "user", content: initialMessage },
      ]);
      sendMessage(initialMessage);
    }
  }, []);

  const handleUserSubmit = (val: string) => {
    if (!val.trim()) return;
    if (showLogo) setShowLogo(false);
    setHistory((prev) => [
      ...prev,
      { id: generateId(), role: "user", content: val },
    ]);
    sendMessage(val, false);
  };

  const handleApprovalSelect = (value: "approve" | "reject") => {
    if (!pendingTool) return;

    if (value === "approve") {
      setHistory((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          content: `🛠️ 调用工具: ${pendingTool.name} (✅ 已批准)`,
        },
      ]);
      sendMessage(null, true);
    } else {
      setHistory((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          content: `🚫 拒绝调用: ${pendingTool.name}`,
        },
      ]);
      rejectExecution();
    }
  };

  const isLoading = isThinking;

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {showLogo && <Header />}

      {/* 1. 顶部内容区：历史记录 + 实时流 */}
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <Text color="green" bold>
            从小就志杰 Intelligent CLI Tool v0.1
          </Text>
        </Box>

        {/* 历史记录 */}
        <Static items={history}>
          {(item) => (
            <Box key={item.id} flexDirection="row" marginBottom={1}>
              <Box width={2} marginRight={1}>
                <StatusBadge role={item.role} />
              </Box>

              <Box flexDirection="column" flexGrow={1}>
                {item.role === "system" ? (
                  <Text color="yellow" dimColor>
                    {item.content}
                  </Text>
                ) : (
                  <Box flexDirection="column">
                    {item.role === "ai" && item.reasoning && (
                      <Text color="gray" dimColor>
                        ↳ 🧠 {item.reasoning.slice(0, 50)}...
                      </Text>
                    )}
                    {item.role === "ai" ? (
                      <MarkdownText content={item.content} />
                    ) : (
                      <Text bold>{item.content}</Text>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Static>

        {/* 2. 实时活动区 (紧接历史记录下方) */}
        {(isLoading || currentAIContent || currentReasoning || currentTool) && (
          <Box flexDirection="row" marginBottom={1}>
            {/* 保持和历史记录一样的左侧图标占位 */}
            <Box width={2} marginRight={1}>
              <StatusBadge role="ai" />
            </Box>

            <Box flexDirection="column" flexGrow={1}>
              {/* 实时思考/工具状态 */}
              {(currentReasoning || currentTool) && (
                <MinimalThinking
                  content={currentReasoning}
                  toolName={currentTool?.name}
                />
              )}

              {/* 实时正文 - 看起来就像还没写完的历史记录 */}
              {currentAIContent && <MarkdownText content={currentAIContent} />}
            </Box>
          </Box>
        )}
      </Box>

      {/* 3. 底部交互区 (固定到底部) */}
      <Box marginTop={1}>
        {awaitingApproval ? (
          <ApprovalCard tool={pendingTool!} onSelect={handleApprovalSelect} />
        ) : (
          <InputArea onSubmit={handleUserSubmit} isLoading={isLoading} />
        )}
      </Box>
    </Box>
  );
};
