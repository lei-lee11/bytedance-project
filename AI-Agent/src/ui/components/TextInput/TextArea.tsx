import React, { useState, useEffect, useMemo } from "react";
import { Text, Box, useInput } from "ink";

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  visibleLines?: number;
  // 建议框控制回调
  onSuggestionNavigate?: (direction: "up" | "down") => boolean;
  onSuggestionSelect?: () => boolean;
  // 强制光标移动触发器
  cursorToEndTrigger?: number;
}

export const TextArea: React.FC<TextAreaProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = "Enter text...",
  focus = true,
  visibleLines = 10,
  onSuggestionNavigate,
  onSuggestionSelect,
  cursorToEndTrigger = 0,
}) => {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const [scrollTop, setScrollTop] = useState(0);

  //  核心计算逻辑 
  const { lines, cursorRow, cursorCol } = useMemo(() => {
    const lines = value.split("\n");
    let runningLength = 0;
    let cRow = 0;
    let cCol = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + 1;
      if (cursorOffset < runningLength + lineLength) {
        cRow = i;
        cCol = cursorOffset - runningLength;
        break;
      }
      runningLength += lineLength;
    }

    if (cursorOffset >= value.length) {
      cRow = lines.length - 1;
      cCol = lines[lines.length - 1].length;
    }

    return { lines, cursorRow: cRow, cursorCol: cCol };
  }, [value, cursorOffset]);

  //  自动滚动 
  useEffect(() => {
    if (cursorRow < scrollTop) setScrollTop(cursorRow);
    if (cursorRow >= scrollTop + visibleLines)
      setScrollTop(cursorRow - visibleLines + 1);
  }, [cursorRow, scrollTop, visibleLines]);

  //  监听触发器，自动将光标移到末尾 
  useEffect(() => {
    if (cursorToEndTrigger > 0) {
      setCursorOffset(value.length);
    }
  }, [cursorToEndTrigger, value.length]);

  // 键盘输入处理 
  useInput(
    (input, key) => {
      if (!focus) return;

      // 1. 优先处理建议框导航 (拦截 Up/Down)
      // 如果建议框打开，按上下键不移动光标，而是选择建议
      if (onSuggestionNavigate) {
        if (key.upArrow) {
          const handled = onSuggestionNavigate("up");
          if (handled) return; 
        }
        if (key.downArrow) {
          const handled = onSuggestionNavigate("down");
          if (handled) return;
        }
      }

      // 2. 优先处理建议框选择 (拦截 Tab 和 Enter)
      if (onSuggestionSelect) {
        // Tab 或者 (Enter 且不是 Ctrl+Enter)
        if (key.tab || (key.return && !key.ctrl && !key.meta)) {
           const handled = onSuggestionSelect();
           // 如果建议框确实处理了选择（即建议框是打开的），则拦截，不进行后续的换行操作
           if (handled) return;
        }
      }

      // 3. 提交逻辑 (Ctrl+Enter / Alt+Enter / Ctrl+X)
      const isSubmit =
        (key.return && (key.meta || key.ctrl)) || (key.ctrl && input === "x");
      if (isSubmit) {
        onSubmit(value);
        return;
      }

      // 4. 常规光标导航 (上下左右)
      if (key.upArrow) {
        if (cursorRow > 0) {
          const prevLine = lines[cursorRow - 1];
          const newCol = Math.min(cursorCol, prevLine.length);
          let prevLineStartAbs = 0;
          for (let i = 0; i < cursorRow - 1; i++)
            prevLineStartAbs += lines[i].length + 1;
          setCursorOffset(prevLineStartAbs + newCol);
        }
        return;
      }
      if (key.downArrow) {
        if (cursorRow < lines.length - 1) {
          const nextLine = lines[cursorRow + 1];
          const newCol = Math.min(cursorCol, nextLine.length);
          let nextLineStartAbs = 0;
          for (let i = 0; i < cursorRow + 1; i++)
            nextLineStartAbs += lines[i].length + 1;
          setCursorOffset(nextLineStartAbs + newCol);
        }
        return;
      }
      if (key.leftArrow) {
        setCursorOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorOffset((prev) => Math.min(value.length, prev + 1));
        return;
      }

      // 5. 删除键 (Backspace / Delete)
      if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          const next =
            value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
          onChange(next);
          setCursorOffset((prev) => prev - 1);
        }
        return;
      }

      // 6. 核心文本输入逻辑
      // 如果没有 input 字符（例如只按了 Shift），或者是 Tab 键且没被建议框拦截，则忽略
      if (!input && !key.return) return;
      if (key.tab) return; // 单纯的 Tab 在这里不输入任何字符

      let textToInsert = input;

      // 如果是回车键，强制为换行符
      if (key.return) {
        textToInsert = "\n";
      } else {
        // 粘贴内容清洗
        textToInsert = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      }

      const next =
        value.slice(0, cursorOffset) + textToInsert + value.slice(cursorOffset);
      onChange(next);
      setCursorOffset((prev) => prev + textToInsert.length);
    },
    { isActive: focus }
  );

  const viewportLines = lines.slice(scrollTop, scrollTop + visibleLines);

  if (!value && placeholder) {
    return (
      <Box>
        <Text color="gray">{placeholder}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {viewportLines.map((line, idx) => {
        const realRowIndex = scrollTop + idx;
        const isCursorRow = realRowIndex === cursorRow;

        return (
          <Box key={realRowIndex}>
            {isCursorRow ? (
              <Text>
                {line.slice(0, cursorCol)}
                <Text inverse color="cyan">
                  {line[cursorCol] || " "}
                </Text>
                {line.slice(cursorCol + 1)}
              </Text>
            ) : (
              <Text>{line}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
