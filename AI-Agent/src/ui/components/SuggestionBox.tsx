// src/components/SuggestionBox.tsx
import React from "react";
import { Box, Text } from "ink";
import { THEME } from "../utils/theme.ts";

interface Command {
  value: string;
  description: string;
  isDirectory?: boolean;
}

interface SuggestionBoxProps {
  items: Command[];
  selectedIndex: number;
}

export const SuggestionBox: React.FC<SuggestionBoxProps> = ({
  items,
  selectedIndex,
}) => {
  if (items.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={THEME.aiAccent} // 使用亮色边框表示激活状态
      paddingX={1}
      width={60} // 固定宽度或根据内容自适应
      marginBottom={0}
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        // 为目录添加视觉提示
        const arrow = item.isDirectory ? ' →' : '';
        return (
          <Box key={item.value}>
            <Text
              color={isSelected ? THEME.bg : THEME.textDim}
              backgroundColor={isSelected ? THEME.aiAccent : undefined}
              bold={isSelected}
            >
              {isSelected ? " > " : "   "}
              {item.value.padEnd(10)}
              <Text color={isSelected ? THEME.bg : THEME.textDim} italic>
                {item.description}{arrow}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
