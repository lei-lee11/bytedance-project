import React, { useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { useRequest } from "ahooks"; 
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { graph } from "../agent/graph.js";

// 类型定义
type UIMessage = {
  id: string;
  role: "user" | "ai" | "system" | "tool";
  content: string;
};

export const App = ({ initialMessage }: { initialMessage?: string }) => {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [statusText, setStatusText] = useState(""); // 细粒度的状态文本
  const [currentAIContent, setCurrentAIContent] = useState("");

  const { run: sendMessage, loading: isThinking } = useRequest(
    async (text: string) => {
      if (!text.trim()) return;

      // 1. 上屏用户消息
      const userMsgId = Date.now().toString();
      setHistory((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: text },
      ]);

      setInput("");
      setCurrentAIContent(""); // 清空上一轮的缓存
      setStatusText("AI 正在思考...");

      const config = { configurable: { thread_id: "cli-session-1" } };
      const stream = await graph.stream(
        { messages: [new HumanMessage(text)] },
        config,
      );

      let fullContent = "";

      for await (const event of stream) {
        const eventType = Object.keys(event)[0];
        const chunk = (event as any)[eventType];

        if (eventType === "agent") {
          if (
            chunk.messages &&
            Array.isArray(chunk.messages) &&
            chunk.messages.length > 0
          ) {
            const lastMsg = chunk.messages[chunk.messages.length - 1];

            // 只要有内容，就更新到"正在生成"的状态里
            if (lastMsg && typeof lastMsg.content === "string") {
              fullContent = lastMsg.content;
              setCurrentAIContent(fullContent); // <--- 实时更新这里，让普通组件渲染
            }
          }
        } else if (eventType === "tool") {
          setStatusText(`正在调用工具...`);
        }
      }

      // 5. 循环结束，说明生成完毕，把最终结果存入历史
      if (fullContent) {
        setHistory((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "ai", content: fullContent },
        ]);
        setCurrentAIContent(""); // 清空实时区域，因为已经进历史了
      }
    },
    {
      manual: true,
      onError: (error) => {
        setHistory((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: "system",
            content: `Error: ${error.message}`,
          },
        ]);
      },
      onFinally: () => {
        setStatusText("");
      },
    },
  );

  // 挑战 2: 启动参数支持
  useEffect(() => {
    if (initialMessage) {
      sendMessage(initialMessage);
    }
  }, []);


  return (
    <Box flexDirection="column" padding={1}>
      /* 历史消息 (静态，不可变) */
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text
                color={item.role === 'user' ? 'green' : item.role === 'ai' ? 'cyan' : 'red'}
                bold
              >
                {item.role === 'user' ? '👤 Human' : item.role === 'ai' ? '🤖 AI' : '⚠️ System'}:
              </Text>
            </Box>
            <Box marginLeft={2}>
              <Text>{item.content}</Text>
            </Box>
          </Box>
        )}
      </Static>

      {(currentAIContent || isThinking) && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="cyan" bold>🤖 AI (Thinking...): </Text>
          </Box>
          <Box marginLeft={2}>
            {/* 显示实时生成的内容 */}
            <Text>{currentAIContent}</Text>
          </Box>
        </Box>
      )}

      /* 3. 底部输入框 */
      <Box borderStyle="round" borderColor={isThinking ? "yellow" : "gray"} flexDirection="column">
        {isThinking ? (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" /> {statusText}
            </Text>
          </Box>
        ) : (
          <Box>
            <Text color="green" bold>Input ➤ </Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={(val) => sendMessage(val)}
              placeholder="输入指令..."
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}