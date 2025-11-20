# Project

简单的智能体示例项目。

快速开始：

1. 创建`.env` 并填写密钥。
格式：

.env 格式
```
# 火山引擎 API 配置
VOLCENGINE_API_KEY= {{替换API Key}}
# 可以在这里配置模型ID和url，url不用改，id在文档里查
MODEL_ID = deepseek-v3-1-terminus
VOLCENGINE_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
```

2. 编译：`npm run build`

3. 进入交互式对话：`npm run convo:repl`

4. 单词对话：`npm run convo -- "你的问题"`

说明：
- 入口：`src/index.ts`。
- CLI：`src/cli/commands.ts`。
- 模型调用在：`src/tools/volcengine.ts`。
