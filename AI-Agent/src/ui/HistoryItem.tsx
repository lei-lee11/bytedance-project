import React from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "./App.tsx"; // ⚠️ 请根据实际路径调整
import { MarkdownText } from "./App.tsx"; // ⚠️ 请根据实际路径调整

interface HistoryItemProps {
  item: {
    id: string;
    role: string;
    content: string;
    reasoning?: string;
  };
}

export const HistoryItem: React.FC<HistoryItemProps> = ({ item }) => {
  // 1. 【过滤】直接拦截并隐藏不需要的框架日志
  if (item.content.includes("Turn completed")) {
    return null;
  }

  // 2. 【美化】工具调用/执行日志
  // 检测是否包含 "Executed" 或 "Approved execution"
  const isToolLog =
    item.content.includes("Executed") ||
    item.content.includes("Approved execution");

  if (isToolLog) {
    // 提取工具名
    const toolName = item.content.split(" ").pop() || "tool";
    const isSuccess = item.content.includes("Executed");

    return (
      <Box marginLeft={4} marginY={0}>
        <Text color="gray" dimColor>
          {isSuccess ? "✔ " : "⚙️ "}
          {isSuccess ? "已执行: " : "调用中: "}
        </Text>
        <Text color={isSuccess ? "blue" : "yellow"} dimColor>
          {toolName}
        </Text>
      </Box>
    );
  }

  // 3. 【常规】普通消息渲染
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box width={2} marginRight={1}>
        <StatusBadge role={item.role} />
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {item.role === "system" ? (
          <Text color="yellow" dimColor>
            {item.content}
          </Text>
        ) : item.role === "ai" ? (
          <Box flexDirection="column">
            {/* 优化思考过程显示 */}
            {item.reasoning && (
              <Text color="gray" italic dimColor>
                ↳ 🧠 思考中...
              </Text>
            )}
            <MarkdownText content={item.content} />
          </Box>
        ) : (
          <Text bold>{item.content}</Text>
        )}
      </Box>
    </Box>
  );
};
