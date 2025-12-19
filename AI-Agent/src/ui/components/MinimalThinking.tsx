import { FC } from "react";
import Spinner from "ink-spinner";
import { Box, Text } from "ink";
import { THEME } from "../utils/theme.ts";

export const MinimalThinking: FC<{
  content: string;
  toolName?: string | null;
}> = ({ content, toolName }) => {
  // 1. 提取最后一行非空内容
  // 过滤掉空行
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  // 2. 获取显示的文本
  let displayText = toolName
    ? `Running tool: ${toolName}...`
    : lines.length > 0
      ? lines[lines.length - 1] // 获取最后一行
      : "Thinking...";

  // 清理 Markdown 标记 (放在截断之前，保证内容的有效性)
  displayText = displayText.replace(/^[#\-*]+\s*/, "");

  // 截断长文本
  // 如果文本超过 70 字符：
  // 旧逻辑: slice(0, 67) -> 显示开头，导致长句看起来不动
  // 新逻辑: slice(-67)   -> 显示【末尾】，让用户看到最新的动态
  if (displayText.length > 70) {
    displayText = "..." + displayText.slice(-67);
  }

  return (
    <Box flexDirection="row" alignItems="center" minHeight={1}>
      <Box marginRight={1}>
        {/* 工具运行和普通思考使用不同的 Spinner，视觉更丰富 */}
        <Text color={toolName ? "yellow" : THEME.aiAccent}>
          <Spinner type={toolName ? "arc" : "dots"} />
        </Text>
      </Box>
      <Text color={THEME.textDim} italic>
        {displayText}
      </Text>
    </Box>
  );
};
