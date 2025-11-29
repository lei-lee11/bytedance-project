import { Box, Text } from "ink";
import SelectInput from "ink-select-input"; 
type PendingToolState = { name: string; args: any };
export const ApprovalCard = ({
  tool,
  onSelect,
}: {
  tool: PendingToolState;
  onSelect: (choice: "approve" | "reject") => void;
}) => {
  const items = [
    { label: "Run this command", value: "approve" }, 
    { label: "Abort", value: "reject" },
  ];

  return (
    <Box flexDirection="column" marginTop={1} paddingBottom={1}>
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          ⚠ Permission Request
        </Text>
        <Text color="gray"> › The agent wants to execute an action:</Text>
      </Box>

      {/* 拟物化代码块风格 */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray" // 灰色边框更像编辑器
        paddingX={1}
        marginBottom={1}
        marginLeft={2} // 缩进，体现层级
      >
        <Box>
          <Text color="magenta">fn </Text>
          <Text bold color="blue">
            {tool.name}
          </Text>
          <Text color="gray">(</Text>
        </Box>

        {/* 参数格式化显示 */}
        <Box marginLeft={2} flexDirection="column">
          {Object.entries(tool.args).map(([key, val]) => (
            <Box key={key}>
              <Text color="cyan">{key}</Text>
              <Text color="gray">: </Text>
              <Text color="green">"{String(val)}"</Text>
              <Text color="gray">,</Text>
            </Box>
          ))}
        </Box>

        <Box>
          <Text color="gray">)</Text>
        </Box>
      </Box>

      {/* 菜单 */}
      <Box marginLeft={2}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value as "approve" | "reject")}
          isFocused={true}
          // 自定义指示器
          indicatorComponent={({ isSelected }) => (
            <Text color={isSelected ? "cyan" : "gray"}>
              {isSelected ? "● " : "○ "}
            </Text>
          )}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
              {label}
            </Text>
          )}
        />
      </Box>
    </Box>
  );
};
