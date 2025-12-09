// src/components/TextInput/InputArea.tsx
import { FC, useState, useMemo, useEffect } from "react";
import { Box, Text } from "ink";
import { THEME } from "../../utils/theme.ts";
import { TextArea } from "./TextArea.tsx";
import { SuggestionBox } from "../SuggestionBox.tsx";
import { AVAILABLE_COMMANDS } from "../../utils/commands.ts";
// 使用真实的文件系统 API
import { searchFiles, FileSystemItem } from "../../utils/fileSystemApi.ts";

interface SessionMetadata {
  thread_id: string;
  title?: string;
  message_count?: number;
}

interface Session {
  metadata: SessionMetadata;
}

interface InputAreaProps {
  onSubmit: (value: string) => void;
  isLoading: boolean;
  sessions?: Session[];
}

interface SuggestionItem {
  value: string;
  description: string;
  type: string;
  isDirectory?: boolean;
}

export const InputArea: FC<InputAreaProps> = ({
  onSubmit,
  isLoading,
  sessions = [],
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorTrigger, setCursorTrigger] = useState(0);
  const [isSelectionUpdate, setIsSelectionUpdate] = useState(false);

  // 新增：缓存文件搜索结果
  const [fileItems, setFileItems] = useState<FileSystemItem[]>([]);

  // --- 1. 核心建议逻辑 ---
  const suggestions = useMemo(() => {
    const lines = query.split("\n");
    const currentLine = lines[lines.length - 1] || "";

    // 注意：不要过早 trim，因为我们需要判断光标后的空格
    // 如果刚刚选中过，或者当前行是空的，不显示
    if (isSelectionUpdate || !currentLine) return [];

    // -------------------------------------------------------
    // 场景 A: 文件补全模式 (@)
    // 触发条件：@开头，或者空格后跟@，且后面没有空格（表示正在打字）
    // 正则含义：匹配行尾的 @xxxx
    // -------------------------------------------------------
    const fileMatch = currentLine.match(/(?:^|\s)@([^\s]*)$/);
    if (fileMatch) {
      // 使用缓存的文件列表生成建议
      if (fileItems.length > 0) {
        return fileItems.map((item) => ({
          value: `@${item.path}${item.isDirectory ? "/" : ""}`, // 目录后加斜杠
          description: item.isDirectory ? "📁 Directory" : "📄 File",
          type: "file",
          isDirectory: item.isDirectory, // 标记是否为目录
        }));
      }
    }

    // -------------------------------------------------------
    // 场景 B: 会话切换模式 (/switch)
    // -------------------------------------------------------
    const cleanLine = currentLine.trim(); // 指令判断可以忽略前后空格
    if (cleanLine.startsWith("/switch")) {
      const param = cleanLine.replace(/^\/switch\s*/, "").toLowerCase();

      const sessionItems = sessions.map((s) => ({
        value: `/switch ${s.metadata.thread_id}`,
        description: s.metadata.title
          ? `${s.metadata.title} (${s.metadata.message_count})`
          : `Untitled (${s.metadata.message_count})`,
        type: "command",
      }));

      const matches = sessionItems.filter(
        (item) =>
          item.value.toLowerCase().includes(param) ||
          item.description.toLowerCase().includes(param),
      );

      if (matches.length > 0) return matches;
    }

    // -------------------------------------------------------
    // 场景 B2: 会话删除模式 (/delete)
    // -------------------------------------------------------
    if (cleanLine.startsWith("/delete")) {
      const param = cleanLine.replace(/^\/delete\s*/, "").toLowerCase();

      const sessionItems = sessions.map((s) => ({
        value: `/delete ${s.metadata.thread_id}`,
        description: s.metadata.title
          ? `🗑️ ${s.metadata.title} (${s.metadata.message_count} messages)`
          : `🗑️ Untitled (${s.metadata.message_count} messages)`,
        type: "command",
      }));

      const matches = sessionItems.filter(
        (item) =>
          item.value.toLowerCase().includes(param) ||
          item.description.toLowerCase().includes(param),
      );

      if (matches.length > 0) return matches;
    }

    // -------------------------------------------------------
    // 场景 B3: 会话信息查看模式 (/getSessionInfo)
    // -------------------------------------------------------
    if (cleanLine.startsWith("/getSessionInfo")) {
      const param = cleanLine.replace(/^\/getSessionInfo\s*/, "").toLowerCase();

      const sessionItems = sessions.map((s) => ({
        value: `/getSessionInfo ${s.metadata.thread_id}`,
        description: s.metadata.title
          ? `ℹ️ ${s.metadata.title} (${s.metadata.message_count} messages)`
          : `ℹ️ Untitled (${s.metadata.message_count} messages)`,
        type: "command",
      }));

      // 如果没有参数，显示所有会话
      if (!param) {
        // 添加一个无需参数的选项来查看当前会话
        const currentSessionOption = {
          value: "/getSessionInfo",
          description: "ℹ️ View current session information",
          type: "command" as const,
        };
        return [currentSessionOption, ...sessionItems];
      }

      const matches = sessionItems.filter(
        (item) =>
          item.value.toLowerCase().includes(param) ||
          item.description.toLowerCase().includes(param),
      );

      if (matches.length > 0) return matches;
    }

    // -------------------------------------------------------
    // 场景 C: 通用指令模式 (/)
    // -------------------------------------------------------
    if (cleanLine.startsWith("/")) {
      const matchText = cleanLine.toLowerCase();
      const allCommands = [
        ...AVAILABLE_COMMANDS,
        { value: "/switch", description: "Switch session" },
      ];

      const uniqueCommands = Array.from(
        new Map(allCommands.map((item) => [item.value, item])).values(),
      );

      return uniqueCommands
        .map((cmd) => ({
          value: cmd.value,
          description: cmd.description || "",
          type: "command",
        }))
        .filter((item) => item.value.toLowerCase().startsWith(matchText));
    }

    return [];
  }, [query, fileItems, sessions, isSelectionUpdate]);

  const showSuggestions = suggestions.length > 0;

  // --- 异步搜索文件 ---
  useEffect(() => {
    const lines = query.split("\n");
    const currentLine = lines[lines.length - 1] || "";
    const fileMatch = currentLine.match(/(?:^|\s)@([^\s]*)$/);

    if (fileMatch) {
      const searchStr = fileMatch[1];

      // 异步搜索文件
      searchFiles(searchStr)
        .then((items) => {
          setFileItems(items);
        })
        .catch((error) => {
          console.error("Failed to search files:", error);
          setFileItems([]);
        });
    } else {
      // 不在文件搜索模式，清空缓存
      setFileItems([]);
    }
  }, [query]);

  // --- 2. 状态重置 ---
  useEffect(() => {
    setSelectedIndex(0);
    if (isSelectionUpdate) {
      const timer = setTimeout(() => setIsSelectionUpdate(false), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [query, isSelectionUpdate]);

  const handleSubmit = (value: string) => {
    if (!value.trim()) return;
    setIsSelectionUpdate(true);
    onSubmit(value);
    setQuery("");
  };

  const handleSuggestionNavigate = (dir: "up" | "down"): boolean => {
    if (!showSuggestions) return false;
    if (dir === "up") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return true;
    } else {
      setSelectedIndex((prev) => Math.min(suggestions.length - 1, prev + 1));
      return true;
    }
  };

  // --- 3. 核心修改：处理选中逻辑 ---
  const handleSuggestionSelect = (): boolean => {
    if (!showSuggestions) return false;

    const selectedItem = suggestions[selectedIndex] as SuggestionItem;
    if (selectedItem) {
      setIsSelectionUpdate(true);

      // 判断如何替换文本
      // 如果是 @文件，我们只替换最后一部分
      if (selectedItem.value.startsWith("@")) {
        const lines = query.split("\n");
        const currentLine = lines[lines.length - 1] || "";

        // 找到最后一个 @ 的位置
        const lastAtIndex = currentLine.lastIndexOf("@");

        if (lastAtIndex !== -1) {
          // 保留 @ 之前的内容
          const prefix = currentLine.substring(0, lastAtIndex);

          // 如果是目录，不加空格，让用户继续浏览
          // 如果是文件，加空格表示补全完成
          const suffix = selectedItem.isDirectory ? "" : " ";
          const newLine = prefix + selectedItem.value + suffix;

          // 如果有多行，我们需要把最后一行替换掉，保留之前的行
          lines[lines.length - 1] = newLine;
          setQuery(lines.join("\n"));
        }
      }
      // 如果是指令 (/switch 或 /help)，通常是整行替换
      else {
        setQuery(selectedItem.value + " ");
      }

      setCursorTrigger((prev) => prev + 1);
    }
    return true;
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
      <Box marginBottom={0} paddingX={1} justifyContent="space-between">
        <Text color="gray" dimColor>
          [Enter] New Line | [Ctrl + X] Subimt
        </Text>
        {showSuggestions && (
          <Text color={THEME.aiAccent} dimColor>
            [↑/↓] | [Tab]
          </Text>
        )}
      </Box>

      {showSuggestions && (
        <Box marginLeft={2}>
          <SuggestionBox items={suggestions} selectedIndex={selectedIndex} />
        </Box>
      )}

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
            placeholder="Type your message..."
            focus={!isLoading}
            visibleLines={8}
            onSuggestionNavigate={handleSuggestionNavigate}
            onSuggestionSelect={handleSuggestionSelect}
            cursorToEndTrigger={cursorTrigger}
          />
        </Box>
      </Box>
    </Box>
  );
};
