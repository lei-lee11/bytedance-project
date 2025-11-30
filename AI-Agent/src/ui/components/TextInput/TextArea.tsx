import React, { useState, useEffect, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import chalk from 'chalk';

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  visibleLines?: number; 
}

export const TextArea: React.FC<TextAreaProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Enter text...',
  focus = true,
  visibleLines = 10,
}) => {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const [scrollTop, setScrollTop] = useState(0);

  // --- 辅助计算: 保持不变 ---
  const { lines, cursorRow, cursorCol } = useMemo(() => {
    const lines = value.split('\n');
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

  // --- 自动滚动: 保持不变 ---
  useEffect(() => {
    if (cursorRow < scrollTop) setScrollTop(cursorRow);
    if (cursorRow >= scrollTop + visibleLines) setScrollTop(cursorRow - visibleLines + 1);
  }, [cursorRow, scrollTop, visibleLines]);

  // --- 核心修复: 键盘事件处理 ---
  useInput((input, key) => {
    if (!focus) return;

    // 1. 提交逻辑 (Windows 兼容增强版)
    // 支持: Alt+Enter, Ctrl+Enter, Ctrl+X
    const isSubmit = (key.return && (key.meta || key.ctrl)) || (key.ctrl && input === 'x');
    if (isSubmit) {
      onSubmit(value);
      return;
    }

    // 2. 导航键 (上下左右) - 保持原有逻辑
    if (key.upArrow) {
      if (cursorRow > 0) {
        const prevLine = lines[cursorRow - 1];
        const newCol = Math.min(cursorCol, prevLine.length);
        let prevLineStartAbs = 0;
        for (let i=0; i<cursorRow-1; i++) prevLineStartAbs += lines[i].length + 1;
        setCursorOffset(prevLineStartAbs + newCol);
      }
      return;
    }
    if (key.downArrow) {
      if (cursorRow < lines.length - 1) {
        const nextLine = lines[cursorRow + 1];
        const newCol = Math.min(cursorCol, nextLine.length);
        let nextLineStartAbs = 0;
        for (let i=0; i<cursorRow+1; i++) nextLineStartAbs += lines[i].length + 1;
        setCursorOffset(nextLineStartAbs + newCol);
      }
      return;
    }
    if (key.leftArrow) {
      setCursorOffset(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset(prev => Math.min(value.length, prev + 1));
      return;
    }

    // 3. 删除键
    if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        const next = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        onChange(next);
        setCursorOffset(prev => prev - 1);
      }
      return;
    }
    // --- 4. 统一处理：打字、换行(Enter) 和 粘贴 ---
    // 过滤掉纯功能键 (例如单纯按下了 Ctrl，没有 input)
    if (!input && !key.return) return;

    let textToInsert = input;

    // 如果是回车键，强制为换行符
    if (key.return) {
      textToInsert = '\n';
    } else {
      // 关键修复：处理粘贴内容中的 Windows 换行符
      // 将 \r(Windows) 和 \r (Mac Legacy) 全部统一为 

      textToInsert = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    const next = value.slice(0, cursorOffset) + textToInsert + value.slice(cursorOffset);
    onChange(next);
    setCursorOffset(prev => prev + textToInsert.length);

  }, { isActive: focus });

  // --- 渲染 ---
  const viewportLines = lines.slice(scrollTop, scrollTop + visibleLines);

  if (!value && placeholder) {
    return <Box><Text color="gray">{placeholder}</Text></Box>;
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
                <Text inverse color="cyan">{line[cursorCol] || ' '}</Text>
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
