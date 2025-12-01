import React, { FC } from "react";
import Spinner from "ink-spinner";
import { Box, Text } from "ink";
import { THEME } from "./utils/theme.ts";

export const MinimalThinking: FC<{ content: string; toolName?: string }> = ({
  content,
  toolName,
}) => {
  // 1. 提取最后一行非空内容
  // 过滤掉空行，防止闪烁
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  
  // 2. 获取显示的文本
  // 如果有工具在运行，优先显示工具名
  // 否则显示最后一行思考日志，默认显示 "Thinking..."
  let displayText = toolName 
    ? `Running tool: ${toolName}...` 
    : (lines.length > 0 ? lines[lines.length - 1] : "Thinking...");

  // 3. 截断长文本
  // CLI 宽度有限，太长会换行导致 Spinner 错位，这里限制为 70 字符
  if (displayText.length > 70) {
    displayText = displayText.slice(0, 67) + "...";
  }

  return (
    <Box flexDirection="row" alignItems="center">
      <Box marginRight={1}>
        <Text color={THEME.aiAccent}>
          <Spinner type="dots" />
        </Text>
      </Box>
      <Text color={THEME.textDim} italic>
        {/* 移除开头的 markdown 符号，让日志更像日志 */}
        {displayText.replace(/^[#\-*]+\s*/, "")}
      </Text>
    </Box>
  );
};
