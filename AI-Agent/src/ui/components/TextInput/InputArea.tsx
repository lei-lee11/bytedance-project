import React, { FC, useState } from "react";
import { Box, Text } from "ink";
import { THEME } from "../../utils/theme.ts";
// 注意引用路径：如果 InputArea 和 TextArea 在同一目录下，使用 ./TextArea.js
// 如果你是 TypeScript 项目且使用了 tsx，运行时通常引用编译后的 .js 扩展名，或者配置了打包工具则不需要后缀
import { TextArea } from "./TextArea.tsx";

interface InputAreaProps {
  onSubmit: (value: string) => void;
  isLoading: boolean;
}

export const InputArea: FC<InputAreaProps> = ({ onSubmit, isLoading }) => {
  // 1. 管理输入框的状态
  const [query, setQuery] = useState("");

  // 2. 处理提交逻辑
  const handleSubmit = (value: string) => {
    if (!value.trim()) return; // 防止提交空内容

    onSubmit(value); // 调用父组件的提交
    setQuery(""); // 提交后清空输入框
  };

  // 3. Loading 状态显示
  if (isLoading) {
    return (
      <Box marginY={1} paddingX={1}>
        <Text color="gray">Thinking...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 顶部：操作提示栏 (非常重要，因为操作逻辑变了) */}
      <Box marginBottom={0} paddingX={1}>
        <Text color="gray" dimColor>
          [Enter] 换行 | [Ctrl + X] 提交
        </Text>
      </Box>

      {/* 核心：输入框容器 */}
      <Box
        borderStyle="round"
        borderColor={THEME.borderActive}
        paddingX={1}
        flexDirection="row"
      >
        {/* 左侧提示符 */}
        <Box marginRight={1}>
          <Text color={THEME.userAccent}>&gt;</Text>
        </Box>

        {/* 右侧输入组件 */}
        <Box flexGrow={1}>
          <TextArea
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            placeholder="输入指令 (支持粘贴多行代码)..."
            focus={!isLoading} // 确保 Loading 时不响应键盘
            visibleLines={8} // 设置最大显示行数，超过会滚动
          />
        </Box>
      </Box>
    </Box>
  );
};
