import React from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "../App.tsx";
import { MarkdownText } from "../App.tsx";
import { THEME } from "../utils/theme.ts";
import { UIMessage } from "../utils/adapter.ts";

interface HistoryItemProps {
  item: UIMessage; // 直接使用定义好的接口
}

export const HistoryItem: React.FC<HistoryItemProps> = ({ item }) => {
  // 1. 【过滤】过滤掉不需要显示的中间状态（如果 Storage 里存了 Checkpoint 描述等）
  // 这里的 "Turn completed" 通常是 Checkpoint 的描述，不应该作为消息显示
  if (item.content === "Turn completed") {
    return null;
  }

  // 2. 【工具日志】直接通过 role 判断
  if (item.role === "tool") {
    const isSuccess = item.isSuccess !== false; // 默认为 true
    const toolName = item.toolName || "tool";

    return (
      <Box marginLeft={4} marginY={0}>
        <Text color={THEME.textDim}>
          {isSuccess ? "✔ " : "✖ "}
          {isSuccess ? "Executed: " : "Failed: "}
        </Text>
        <Text color={isSuccess ? THEME.tool : "red"} bold>
          {toolName}
        </Text>
      </Box>
    );
  }

  // 3. 【常规消息】
  let roleColor = THEME.userAccent;

  if (item.role === "ai") {
    roleColor = THEME.aiAccent;
  } else if (item.role === "system") {
    roleColor = THEME.system;
  }

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* 左侧徽章 */}
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
          /* Case B: AI 回复 (包含推理过程) */
          <Box flexDirection="column">
            {/* 推理部分 (如果存在且还没折叠) */}
            {item.reasoning && (
              <Box
                borderStyle="single"
                borderColor="gray"
                paddingX={1}
                marginBottom={1}
              >
                <Text color="gray" italic>
                  {item.reasoning}
                </Text>
              </Box>
            )}
            {/* 正文 */}
            <Box>
              <MarkdownText content={item.content} />
            </Box>
          </Box>
        ) : (
          /* Case C: 用户消息 */
          <Text color={THEME.textUser} bold>
            {item.content}
          </Text>
        )}
      </Box>
    </Box>
  );
};
