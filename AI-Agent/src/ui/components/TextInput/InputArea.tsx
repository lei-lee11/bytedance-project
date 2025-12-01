// src/components/InputArea.tsx
import React, { FC, useState, useEffect } from "react";
import { Box, Text } from "ink";
import { THEME } from "../../utils/theme.ts";
import { TextArea } from "./TextArea.tsx";
import { SuggestionBox } from "../SuggestionBox.tsx";
import { AVAILABLE_COMMANDS } from "../../utils/commands.ts";

interface InputAreaProps {
  onSubmit: (value: string) => void;
  isLoading: boolean;
}

export const InputArea: FC<InputAreaProps> = ({ onSubmit, isLoading }) => {
  const [query, setQuery] = useState("");

  // --- 建议框状态 ---
  const [suggestions, setSuggestions] = useState<typeof AVAILABLE_COMMANDS>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // [新增]：用于通知 TextArea 移动光标的触发器
  const [cursorTrigger, setCursorTrigger] = useState(0);

  // --- 监听输入，过滤建议 ---
  useEffect(() => {
    const lines = query.split("\n");
    const currentLine = lines[lines.length - 1] || "";

    if (currentLine.startsWith("/")) {
      const matchText = currentLine.toLowerCase();
      const filtered = AVAILABLE_COMMANDS.filter((cmd) =>
        cmd.value.toLowerCase().startsWith(matchText)
      );

      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, [query]);

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;
    setShowSuggestions(false);
    onSubmit(value);
    setQuery("");
  };

  // --- 处理建议框导航 ---
  const handleSuggestionNavigate = (dir: "up" | "down"): boolean => {
    if (!showSuggestions) return false;

    if (dir === "up") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else {
      setSelectedIndex((prev) => Math.min(suggestions.length - 1, prev + 1));
    }
    return true;
  };

  // --- 处理建议框选择 ---
  const handleSuggestionSelect = (): boolean => {
    if (!showSuggestions) return false;

    const selectedItem = suggestions[selectedIndex];
    if (selectedItem) {
      // 1. 更新文本内容 (这里简单地加上空格)
      const newValue = selectedItem.value + " ";
      setQuery(newValue);
      
      // 2. 关闭建议框
      setShowSuggestions(false);
      
      // 3. [新增] 触发光标移动到末尾
      // 每次 +1 都会导致 TextArea 内部的 useEffect 重新执行，并将光标设为 value.length
      setCursorTrigger((prev) => prev + 1);
    }
    return true; // 拦截 Enter/Tab
  };

  if (isLoading) {
    return (
      <Box marginY={1} paddingX={1}>
        <Text color="gray">Thinking...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 提示栏 */}
      <Box marginBottom={0} paddingX={1} justifyContent="space-between">
        <Text color="gray" dimColor>
          [Enter] 换行 | [Ctrl + X] 提交
        </Text>
        {showSuggestions && (
          <Text color={THEME.aiAccent} dimColor>
            [↑/↓] 选择 | [Tab] 补全
          </Text>
        )}
      </Box>

      {/* 建议框 */}
      {showSuggestions && (
        <Box marginLeft={2}>
          <SuggestionBox items={suggestions} selectedIndex={selectedIndex} />
        </Box>
      )}

      {/* 核心：输入框容器 */}
      <Box
        borderStyle="round"
        borderColor={showSuggestions ? THEME.aiAccent : THEME.borderActive}
        paddingX={1}
        flexDirection="row"
      >
        <Box marginRight={1}>
          <Text color={THEME.userAccent}>&gt;</Text>
        </Box>

        <Box flexGrow={1}>
          <TextArea
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            placeholder="输入指令 (如 /help) 或粘贴代码..."
            focus={!isLoading}
            visibleLines={8}
            onSuggestionNavigate={handleSuggestionNavigate}
            onSuggestionSelect={handleSuggestionSelect}
            // [新增] 传入触发器
            cursorToEndTrigger={cursorTrigger}
          />
        </Box>
      </Box>
    </Box>
  );
};
