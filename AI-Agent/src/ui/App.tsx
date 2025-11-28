import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, Static,useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph } from "../agent/graph.js";

marked.setOptions({
  renderer: new TerminalRenderer({
    code: (code: any) => code,
    // 让引用块稍微明显一点，模拟思考块
    blockquote: (quote: string) => `
  │ ${quote}
`,
  }) as any,
});

type UIMessage = {
  id: string;
  role: "user" | "ai" | "system";
  content: string;
  reasoning?: string;
};

const THREAD_ID = "cli-session-1";

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const ThinkingPanel = ({ content, isFinished = false }: { content: string, isFinished?: boolean }) => {
  // 默认是否折叠：如果内容超过 150 字符，且不在 finished 状态，默认折叠
  const [isExpanded, setIsExpanded] = useState(true);
  const shouldCollapse = content.length > 150;

  // 监听键盘事件 (仅在组件挂载且未结束时有效)
  useInput((input, key) => {
    if (!isFinished && key.tab) {
      setIsExpanded((prev) => !prev);
    }
  }, { isActive: !isFinished }); // 只有在思考时才激活监听

  // 渲染逻辑
  if (!content) return null;

  // 历史记录(Finished)状态：用灰色引用块显示，不需要交互
  if (isFinished) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text color="gray" dimColor>🤔 Thought Process:</Text>
        <Box marginLeft={0}>
          <Text color="gray" dimColor>{content}</Text>
        </Box>
      </Box>
    );
  }

  // 实时(Running)状态：支持交互
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text color="yellow" bold>
           <Spinner type="dots" /> 🤔 Thinking... 
        </Text>
        {shouldCollapse && (
          <Text color="gray" dimColor>
             [{isExpanded ? "TAB to Collapse" : "TAB to Expand"}]
          </Text>
        )}
      </Box>

      {/* 根据折叠状态显示内容 */}
      {(isExpanded || !shouldCollapse) ? (
        <Box marginTop={1}>
          <Text color="yellow">{content}</Text>
        </Box>
      ) : (
        <Box marginTop={0}>
          <Text color="yellow" dimColor>
             ... {content.slice(-80).replace(/n/g, ' ')} (Click TAB to view full)
          </Text>
        </Box>
      )}
    </Box>
  );
};
export const App = ({ initialMessage }: { initialMessage?: string }) => {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [statusText, setStatusText] = useState("");
  const [currentAIContent, setCurrentAIContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [awaitingApproval, setAwaitingApproval] = useState(false);


  // 1. 纯粹的发送逻辑 (不处理 User History)
  const { run: sendMessage, loading: isThinking } = useRequest(
    async (text: string | null, isResume = false) => {
      setInput("");
      setCurrentAIContent("");
      setCurrentReasoning(""); // 重置思考
      setAwaitingApproval(false);
      setStatusText(isResume ? "处理反馈中..." : "AI 思考中...");

      const config = {
        configurable: { thread_id: THREAD_ID },
        version: "v2" as const,
      };

      let stream;
      try {
        if (isResume) {
          stream = await graph.streamEvents(null, config);
        } else if (text) {
          stream = await graph.streamEvents({ messages: [new HumanMessage(text)] }, config);
        }

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

        for await (const event of stream) {
          // 处理模型流式输出
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;
            
            // 1. 获取 Reasoning (DeepSeek/OpenAI-o1 适配)
            const reasoningChunk = chunk.additional_kwargs?.reasoning_content || ""; 
            if (reasoningChunk) {
               fullReasoning += reasoningChunk;
               setCurrentReasoning(fullReasoning);
            }

            // 2. 获取正文 Content
            if (chunk.content && typeof chunk.content === "string") {
              // 有些模型（如 Ollama 部署的 R1）可能把 <think> 混在 content 里
              const cleanContent = chunk.content; 
              fullContent += cleanContent;
              setCurrentAIContent(fullContent);
            }
          } 
          // 处理工具状态
          else if (event.event === "on_tool_start") {
            setStatusText(`正在调用工具: ${event.name}...`);
          } else if (event.event === "on_tool_end") {
            setStatusText("工具执行完毕");
          }
        }

        // 结束后，保存到历史记录
        if (fullContent || fullReasoning) {
          setHistory((prev) => [
            ...prev,
            { 
              id: generateId(), 
              role: "ai", 
              content: fullContent,
              reasoning: fullReasoning // ✨ 保存思考过程
            },
          ]);
          setCurrentAIContent("");
          setCurrentReasoning("");
        }

        // 检查中断
        const snapshot = await graph.getState(config);
        if (snapshot.next.length > 0) {
          setAwaitingApproval(true);
          setStatusText(`⚠️ 请求审批。输入 'y' 批准，'n' 拒绝。`);
        } else {
          setStatusText("");
        }
      } catch (e: any) {
        setHistory((prev) => [...prev, { id: generateId(), role: "system", content: `Error: ${e.message}` }]);
      }
    },
    { manual: true }
  );


  // 2. 拒绝逻辑
  const { run: rejectExecution, loading: isRejecting } = useRequest(
    async () => {
      setStatusText("正在取消操作...");
      const config = { configurable: { thread_id: THREAD_ID } };

      const snapshot = await graph.getState(config);
      const lastMsg =
        snapshot.values.messages[snapshot.values.messages.length - 1];

      if (lastMsg?.tool_calls?.length) {
        const rejectionMessages = lastMsg.tool_calls.map((tc: any) => {
          return new ToolMessage({
            tool_call_id: tc.id,
            name: tc.name,
            content: "User rejected the tool execution.", // 注入拒绝信息
          });
        });

        await graph.updateState(config, { messages: rejectionMessages });

        setHistory((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "system",
            content: "🚫 操作已取消 (User Rejected)",
          },
        ]);
      } else {
        // Fallback
        await graph.updateState(config, {
          messages: [new HumanMessage("Cancel operation")],
        });
      }

      // 唤醒 AI，silent 模式 
      sendMessage(null, true);
    },
    { manual: true },
  );

  // 初始化
  useEffect(() => {
    if (initialMessage) {
      // 初始消息，手动加历史
      setHistory((prev) => [
        ...prev,
        { id: generateId(), role: "user", content: initialMessage },
      ]);
      sendMessage(initialMessage);
    }
  }, []);


  // 3. 统一入口处理
  const handleSubmit = (val: string) => {
    if (!val.trim()) return;

    if (awaitingApproval) {
      const lowerVal = val.trim().toLowerCase();

      if (["y", "yes"].includes(lowerVal)) {
        // 同意 -> 手动添加“批准”历史 -> 恢复
        setHistory((prev) => [
          ...prev,
          { id: generateId(), role: "user", content: "✅ 批准执行" },
        ]);
        sendMessage(null, true);
      } else if (["n", "no"].includes(lowerVal)) {
        // 拒绝 -> 进入拒绝流程 (历史记录在 rejectExecution 里加)
        rejectExecution();
      } else {
        // 打岔 -> 手动添加用户消息 -> 发送新消息
        setHistory((prev) => [
          ...prev,
          { id: generateId(), role: "user", content: val },
        ]);
        sendMessage(val, false);
      }
    } else {
      // 正常 -> 手动添加用户消息 -> 发送新消息
      setHistory((prev) => [
        ...prev,
        { id: generateId(), role: "user", content: val },
      ]);
      sendMessage(val, false);
    }
  };

  const isLoading = isThinking || isRejecting;

  const MarkdownText = ({ content }: { content: string }) => {
    const formattedText = useMemo(() => {
      try {
        return marked(content) || content;
      } catch {
        return content;
      }
    }, [content]);
    return <Text>{formattedText}</Text>;
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* 1. 历史记录渲染 */}
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={item.role === "user" ? "green" : item.role === "ai" ? "cyan" : "red"} bold>
                {item.role === "user" ? "👤 Human" : item.role === "ai" ? "🤖 AI" : "⚠️ System"}:
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              {/* 如果历史消息中有 reasoning，以静态灰盒显示 */}
              {item.role === "ai" && item.reasoning && (
                 <ThinkingPanel content={item.reasoning} isFinished={true} />
              )}
              
              {/* 正文内容 */}
              {item.role === "ai" ? <MarkdownText content={item.content} /> : <Text>{item.content}</Text>}
            </Box>
          </Box>
        )}
      </Static>

      {/* 2. 实时生成区域 */}
      {(isLoading || currentAIContent || currentReasoning) && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box><Text color="cyan" bold>🤖 AI (Processing...):</Text></Box>
          <Box marginLeft={2} flexDirection="column">
            
            {/* 实时思考过程 - 支持 TAB 交互 */}
            {currentReasoning && (
               <ThinkingPanel content={currentReasoning} isFinished={false} />
            )}

            {/* 实时正文 */}
            <MarkdownText content={currentAIContent} />
          </Box>
        </Box>
      )}

      {/* 3. 输入框区域 */}
      <Box borderStyle="round" borderColor={awaitingApproval ? "red" : isLoading ? "yellow" : "blue"} flexDirection="column">
        {isLoading ? (
          <Box>
             {/* 提示用户可以使用 TAB */}
             {currentReasoning ? (
                <Text color="yellow"><Spinner type="dots" /> Thinking... (Press TAB to toggle view)</Text>
             ) : (
                <Text color="yellow"><Spinner type="dots" /> {statusText}</Text>
             )}
          </Box>
        ) : awaitingApproval ? (
          <Box>
            <Text color="red" bold>🛑 确认执行? (y/n) ➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        ) : (
          <Box>
            <Text color="green" bold>Input ➤ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="输入指令..." />
          </Box>
        )}
      </Box>
    </Box>
  );
};