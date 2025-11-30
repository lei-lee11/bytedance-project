import React from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";

export const Header = () => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* 1. 主 LOGO：巨大的 ZJ 字样 */}
      <Gradient name="mind">
        <BigText text="ZJ-CLI" font="block" align="left" />
      </Gradient>

      {/* 2.团队名 */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} width={50}>
        <Text>
          <Text color="cyan">⚡ 从小就志杰 </Text>
          <Text color="gray"> | </Text>
          <Text color="green">Intelligent CLI Tool</Text>
        </Text>
      </Box>

      {/* 装饰线 */}
      <Text color="gray">──────────────────────────────────────────</Text>
    </Box>
  );
};
