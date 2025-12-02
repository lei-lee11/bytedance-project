//mock
const FAKE_FILES = [
  "src/cli.tsx",
  "src/App.tsx",
  "src/hooks/useSessionManager.ts",
  "src/hooks/useMessageProcessor.ts",
  "package.json",
  "README.md",
  "tsconfig.json",
];
export const mockReadFile = async (path: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 模拟：如果路径包含 "error"，则抛出异常，测试错误处理
      if (path.includes("error")) {
        reject(new Error(`File not found: ${path}`));
        return;
      }

      // 正常情况返回假数据
      resolve(
        `
// -----------------------------
// 假装这是文件 ${path} 的内容
// line 1: import React...
// line 2: export const...
// -----------------------------
      `.trim(),
      );
    }, 500);
  });
};
export const mockSearchFiles = (query: string): string[] => {
  if (!query) return [];
  return FAKE_FILES.filter((f) =>
    f.toLowerCase().includes(query.toLowerCase()),
  );
};
