import React from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "../App.tsx"; // 保持你的引入路径
import { MarkdownText } from "../App.tsx"; // 保持你的引入路径
import { THEME } from "../utils/theme.ts";

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
  const isToolLog =
    item.content.includes("Executed") ||
    item.content.includes("Approved execution");

  if (isToolLog) {
    // 提取工具名
    const toolName = item.content.split(" ").pop() || "tool";
    const isSuccess = item.content.includes("Executed");

    return (
      <Box marginLeft={4} marginY={0}>
        {/* 左侧图标/前缀：使用暗色 (Dim) */}
        <Text color={THEME.textDim}>
          {isSuccess ? "✔ " : "⚙️ "}
          {isSuccess ? "已执行: " : "调用中: "}
        </Text>

        {/* 工具名称：成功用抹茶绿，进行中用系统橙或淡紫 */}
        <Text color={isSuccess ? THEME.tool : THEME.system} bold>
          {toolName}
        </Text>
      </Box>
    );
  }

  // 3. 【常规】普通消息渲染

  // 预先决定颜色，避免 JSX 里写太复杂的逻辑
  let textColor = THEME.textUser; // 默认用户颜色
  let roleColor = THEME.userAccent;

  if (item.role === "ai") {
    textColor = THEME.textAi; // 淡灰
    roleColor = THEME.aiAccent; // 柔和蓝
  } else if (item.role === "system") {
    textColor = THEME.system; // 橙黄
    roleColor = THEME.system;
  }

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* 左侧头像/状态徽章 */}
      <Box width={2} marginRight={1}>
        <Text color={roleColor}>
          <StatusBadge role={item.role} />
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {/* Case A: 系统消息 */}
        {item.role === "system" ? (
          <Text color={THEME.system}>{item.content}</Text>
        ) : item.role === "ai" ? (
          /* Case B: AI 回复 */
          <Box flexDirection="column">
            {/* AI 正文内容 */}
            {/* 注意：MarkdownText 内部最好也能接收 color 属性，或者由父级控制 */}
            <Box>
              <MarkdownText content={item.content} />
            </Box>
          </Box>
        ) : (
          /* Case C: 用户消息 - 使用白烟色 */
          <Text color={THEME.textUser} bold>
            {item.content}
          </Text>
        )}
      </Box>
    </Box>
  );
};
