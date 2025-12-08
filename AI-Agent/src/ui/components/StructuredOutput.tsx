import { Box, Text } from "ink";
import { THEME } from "../utils/theme.ts";

export const IntentOutput = ({ data }: { data: any }) => (
  <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
    <Text color="cyan" bold>🎯 意图识别</Text>
    <Box marginLeft={2} flexDirection="column">
      <Text>
        <Text color="green">类型: </Text>
        <Text bold>{data.intent === 'task' ? '编程任务' : '闲聊'}</Text>
      </Text>
      <Text>
        <Text color="green">置信度: </Text>
        <Text bold>{(data.confidence * 100).toFixed(0)}%</Text>
      </Text>
      <Text color="gray" italic>{data.reasoning}</Text>
    </Box>
  </Box>
);

export const ProjectPlanOutput = ({ data }: { data: any }) => (
  <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
    <Text color="yellow" bold>📋 项目规划</Text>
    
    {data.projectPlanText && (
      <Box marginLeft={2} marginTop={1}>
        <Text>{data.projectPlanText}</Text>
      </Box>
    )}
    
    {data.techStackSummary && (
      <Box marginLeft={2} marginTop={1} flexDirection="column">
        <Text color="magenta" bold>🛠️ 技术栈</Text>
        <Text>{data.techStackSummary}</Text>
      </Box>
    )}
    
    {data.projectInitSteps && data.projectInitSteps.length > 0 && (
      <Box marginLeft={2} marginTop={1} flexDirection="column">
        <Text color="blue" bold>📦 初始化步骤 ({data.projectInitSteps.length}个)</Text>
        {data.projectInitSteps.map((step: string, i: number) => (
          <Text key={i} color="gray">  {i + 1}. {step}</Text>
        ))}
      </Box>
    )}
  </Box>
);

export const TodosOutput = ({ data }: { data: any }) => (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>✅ 任务列表 (共 {data.todos.length} 个)</Text>
      {data.todos.map((todo: string, i: number) => {
        // 使用逗号分隔任务描述和其他信息
        const parts = todo.split(',');
        const description = parts[0]; // 第一部分是主要描述
        const details = parts.slice(1).join(','); // 其余部分
        
        return (
          <Box key={i} marginLeft={2} marginTop={1} flexDirection="column">
            <Text>
              <Text color="cyan" bold>任务 {i + 1}: </Text>
              <Text>{description.trim()}</Text>
            </Text>
            {details && (
              <Text color="gray" italic>  ↳ {details.trim()}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );