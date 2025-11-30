import React, { FC } from "react";
import Spinner from "ink-spinner";
import { Box, Text } from "ink";

export const MinimalThinking: FC<{ content: string; toolName?: string }> = ({
  content,
  toolName,
}: {
  content: string;
  toolName?: string;
}) => {
  // 获取最后一行非空内容作为状态描述
  const lines = content.split("\n").filter((l) => l.trim());
  const lastLine =
    lines.length > 0 ? lines[lines.length - 1].slice(0, 60) : "Thinking...";

  return (
    <Box marginY={1}>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text color="gray">
        {" "}
        {toolName ? `Running ${toolName}...` : lastLine}
      </Text>
    </Box>
  );
};
