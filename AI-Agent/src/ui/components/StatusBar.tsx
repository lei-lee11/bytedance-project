import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../utils/theme.ts";

interface StatusBarProps {
  threadId?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({ threadId }) => {
  console.log(threadId);
  const displayId = threadId ? threadId.split("-").pop() : "N/A";

  return (
    <Box
      width="100%"
      paddingX={1}
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={THEME.textDim}
      flexDirection="row"
      justifyContent="space-between"
    >
      {/* 左侧区域 */}
      <Box>
        <Text>
          <Text color={THEME.aiAccent} bold>
            AI CLI
          </Text>
          <Text color={THEME.textDim}> │ </Text>
          <Text color={THEME.textDim}>
            CMD: <Text color="white">"/" for Tools</Text>,{" "}
            <Text color="white">“@” for Files</Text>
          </Text>
        </Text>
      </Box>

      {/* 右侧区域 */}
      <Box>
        <Text color={THEME.textDim}>
          Session: <Text color={THEME.tool}>{displayId}</Text>
        </Text>
      </Box>
    </Box>
  );
};
