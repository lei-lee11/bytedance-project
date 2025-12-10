import { Box, Text } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";

export const Header = ({ sessionId = "134efe70" }) => (
  <Box flexDirection="column" paddingBottom={1}>
    {/* Logo */}
    <Gradient name="morning">
      <BigText text="ZJ-CLI" font="block" colors={["system", "system"]} />
    </Gradient>

    {/* Sub-header: 左侧 Slogan，右侧 Session */}
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
    >
      <Box>
        <Text color="cyan"> ⚡ </Text>
        <Text color="gray">从小就志杰 </Text>
        <Text color="gray">|</Text>
        <Text dimColor> Intelligent CLI Tool</Text>
      </Box>
    </Box>
  </Box>
);
