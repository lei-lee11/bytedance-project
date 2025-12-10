// AI-Agent/tests/agent_flow.test.ts
import { jest } from '@jest/globals';
import { generateCode, generateTests } from "../src/agent/nodes.js";
import { AgentState, createAgentState } from "../src/agent/state.js";

jest.setTimeout(180_000); // 调模型可能稍微久一点，给点时间，延长到 3 分钟

function makeInitialState(): AgentState {
  return createAgentState({
    currentTask: "实现 twoSum 函数，输入整数数组和目标值，返回两数之和的索引，并补充单元测试。",
    projectRoot: process.cwd(),
  });
}

describe("Agent code → tests flow", () => {
  it("should generate code with test plan, then generate unit tests", async () => {
    const initialState = makeInitialState();

    // 第一步：调用 generateCode，期望生成：
    // - Step 1/2/3 结构的回答
    // - 实现代码 + 初始测试代码（在 Step 3 里）
    const deltaAfterCode = await generateCode(initialState);
    const stateAfterCode: AgentState = {
      ...initialState,
      ...deltaAfterCode,
      testPlanText: deltaAfterCode.testPlanText ?? initialState.testPlanText,
    };

    expect(stateAfterCode.messages.length).toBeGreaterThan(0);

    const lastCodeMsg = stateAfterCode.messages[stateAfterCode.messages.length - 1]!;
    const lastCodeContent = String(lastCodeMsg.content);

    // 粗检查：是否包含 Step 结构（思维链 + 测试计划）
    expect(lastCodeContent).toContain("Step 1");
    expect(lastCodeContent).toContain("Step 2");
    expect(lastCodeContent).toContain("Step 3");

    // 如果你已经在 generateCode 里实现了提取 testPlanText 的逻辑，
    // 这里可以顺手验一下：
    // （没实现的话，可以把下面这一行断言先注释掉）
    // expect(stateAfterCode.testPlanText).toBeDefined();

    // 第二步：调用 generateTests，基于：
    // - state.currentTask / programmingLanguage
    // - codeContext 或最近一条 AI 消息中的实现代码
    // - （可选）state.testPlanText 作为已有测试计划
    const deltaAfterTests = await generateTests(stateAfterCode);
    const stateAfterTests: AgentState = {
      ...stateAfterCode,
      ...deltaAfterTests,
    };

    expect(stateAfterTests.messages.length).toBeGreaterThan(
      stateAfterCode.messages.length,
    );

    const lastTestMsg = stateAfterTests.messages[stateAfterTests.messages.length - 1]!;
    const lastTestContent = String(lastTestMsg.content);

    // 粗检查：是否有“单测结构”的痕迹
    // 例如：
    // - 仍然按照 Step 1/2/3 输出
    // - 或出现常见测试函数（describe/test/it 等）
    expect(
      lastTestContent.includes("Step 3") ||
        lastTestContent.includes("describe(") ||
        lastTestContent.includes("test(") ||
        lastTestContent.includes("it("),
    ).toBe(true);
  });
});
