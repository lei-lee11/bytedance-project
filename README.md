# Project

简单的智能体示例项目。

快速开始：

1. 复制 `.env.example` 到 `.env` 并填写密钥。
2. 本地调试：`npm run dev` 或 `npx tsx src/index.ts "你的问题"`。
3. 编译并运行：`npm run build && npm run start`。

说明：
- 入口：`src/index.ts`。
- CLI：`src/cli/commands.ts`。
- 模型调用在：`src/tools/volcengine.ts`。
