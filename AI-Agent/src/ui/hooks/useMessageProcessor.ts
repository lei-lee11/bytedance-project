import { useCallback, useState } from "react";

export const useMessageProcessor = () => {
  const [isProcessing, setIsProcessing] = useState(false);

  // 辅助函数：纯提取，不发请求，不读文件
  const extractFilePaths = (text: string): string[] => {
    const fileRegex = /@([^\s]+)/g;
    const matches = [...text.matchAll(fileRegex)];
    return matches.map((m) => m[1]);
  };

  /**
   * 新的处理逻辑：
   * 1. 扫描 @path
   * 2. 清理掉消息中的 @path (可选，看你后端是否需要保留 @ 符号)
   * 3. 返回结构化数据供 API 调用
   */
  const processInput = useCallback(async (rawInput: string) => {
    setIsProcessing(true);
    try {
      // 1. 提取路径
      const filePaths = extractFilePaths(rawInput);

      // 2. (可选) 如果你希望发给大模型的消息里不包含 @src/xxx 这种干扰项，可以替换掉
      // 但通常建议保留，因为这能作为对上下文的引用指针
      // const cleanContent = rawInput.replace(/@([^\s]+)/g, "").trim();
      const contentToSend = rawInput;

      // 3. 直接返回，不做 IO 操作
      return {
        content: contentToSend,
        pendingFilePaths: filePaths, //  这里对应你后端的 state 字段
        metadata: {
          hasContext: filePaths.length > 0,
        },
      };
    } catch (error) {
      console.error("Error processing input:", error);
      // 即使出错，至少把原始文本返回去
      return { content: rawInput, pendingFilePaths: [], metadata: {} };
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // 用于 UI 实时显示的标签逻辑（保持不变）
  const scanForTags = useCallback((input: string) => {
    return extractFilePaths(input);
  }, []);

  return {
    processInput,
    isProcessing,
    scanForTags,
  };
};
