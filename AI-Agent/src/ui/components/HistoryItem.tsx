import React from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "../App.tsx";
import { MarkdownText } from "../App.tsx";
import { THEME } from "../utils/theme.ts";
import { UIMessage } from "../utils/adapter.ts";
import { tryParseStructuredOutput } from "../utils/formatStructuredOutput.ts";
import {
  IntentOutput,
  ProjectPlanOutput,
  TodosOutput,
} from "./StructuredOutput.tsx";
interface HistoryItemProps {
  item: UIMessage; // 直接使用定义好的接口
}

export const HistoryItem: React.FC<HistoryItemProps> = ({ item }) => {
  // 1. 【过滤】过滤掉不需要显示的中间状态（如果 Storage 里存了 Checkpoint 描述等）
  // 这里的 "Turn completed" 通常是 Checkpoint 的描述，不应该作为消息显示
  if (item.content === "Turn completed") {
    return null;
  }

  // 2. 【工具日志】直接通过 role 判断
  if (item.role === "tool") {
    const isSuccess = item.isSuccess !== false; // 默认为 true
    const toolName = item.toolName || "tool";

    return (
      <Box marginLeft={4} marginY={0}>
        <Text color={THEME.textDim}>
          {isSuccess ? "✔ " : "✖ "}
          {isSuccess ? "Executed: " : "Failed: "}
        </Text>
        {toolName !== "project_tree " && (
          <Text color={isSuccess ? THEME.tool : "red"} bold>
            {toolName}
          </Text>
        )}
      </Box>
    );
  }

  // 3. 【常规消息】
  let roleColor = THEME.userAccent;

  if (item.role === "ai") {
    roleColor = THEME.aiAccent;
  } else if (item.role === "system") {
    roleColor = THEME.system;
  }

  // 尝试解析结构化输出
  const structuredData =
    tryParseStructuredOutput(item.content) ||
    (item.reasoning ? tryParseStructuredOutput(item.reasoning) : null);

  // 如果检测到结构化输出，使用专门的展示组件
  if (structuredData) {
    return (
      <Box flexDirection="column" marginBottom={1} gap={1}>
        {structuredData.map((item: any, idx: number) => {
          switch (item.type) {
            case "intent":
              return <IntentOutput key={idx} data={item.data} />;
            case "project_plan":
              return <ProjectPlanOutput key={idx} data={item.data} />;
            case "todos":
              return <TodosOutput key={idx} data={item.data} />;
            default:
              return null;
          }
        })}
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* 左侧徽章 */}
      <Box width={2} marginRight={1}>
        <Text color={roleColor}>
          <StatusBadge role={item.role} />
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {/* Case A: 系统消息 */}
        {item.role === "system" ? (
          <Text color={THEME.system}>{item.content}</Text>
        ) : item.role === "ai" ? (
          /* Case B: AI 回复 (包含推理过程) */
          <Box flexDirection="column">
            {/* 正文 */}
            <Box>
              <MarkdownText content={item.content} />
            </Box>
          </Box>
        ) : (
          /* Case C: 用户消息 */
          <Text color={THEME.textUser} bold>
            {item.content}
          </Text>
        )}
      </Box>
    </Box>
  );
};
