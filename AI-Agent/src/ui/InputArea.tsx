import React, { FC, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export const InputArea: FC<{
  onSubmit: (val: string) => void;
  isLoading: boolean;
}> = ({
  onSubmit,
  isLoading,
}: {
  onSubmit: (val: string) => void;
  isLoading: boolean;
}) => {
  const [query, setQuery] = useState("");

  // 如果正在加载，不仅不渲染输入框，还要确保清空状态，防止残影
  if (isLoading) {
    return (
      <Box marginY={1}>
        <Text color="gray">Wait...</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      marginTop={1}
    >
      <Box marginRight={1}>
        <Text color="green">➜ </Text>
      </Box>

      <TextInput
        value={query}
        onChange={setQuery}
        onSubmit={(val) => {
          if (!val.trim()) return;
          onSubmit(val);
          setQuery(""); // 提交后清空
        }}
        placeholder="在此输入指令 (支持中文)..."
        // 确保焦点始终在这里
        focus={!isLoading}
      />
    </Box>
  );
};
