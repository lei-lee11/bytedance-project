import { generateCode, generateTests } from '../src/agent/nodes.ts';
import { AgentState } from '../src/agent/state.js';

async function makeInitialState(): Promise<AgentState> {
  return {
    messages: [],
    summary: '',
    currentTask: '实现 twoSum 函数，输入整数数组和目标值，返回两数之和的索引，并补充单元测试。',
    programmingLanguage: 'TypeScript',
    codeContext: '',
    retryCount: 0,
    reviewResult: '',
    projectRoot: process.cwd(),
    projectTreeMessageId: '',
    projectTreeInjected: false,
    projectTreeText: '',
    testPlanText: '',
  } as AgentState;
}

async function run() {
  const initialState = await makeInitialState();
  console.log('Calling generateCode...');
  try {
    const deltaAfterCode = await generateCode(initialState as any);
    const stateAfterCode: AgentState = { ...initialState, ...deltaAfterCode } as AgentState;
    console.log('generateCode returned messages length:', (stateAfterCode.messages || []).length);
    const lastCodeMsg = (stateAfterCode.messages || []).at(-1);
    console.log('Last code message preview:', lastCodeMsg ? String((lastCodeMsg as any).content).slice(0, 400) : '(none)');

    console.log('\nCalling generateTests...');
    const deltaAfterTests = await generateTests(stateAfterCode as any);
    const stateAfterTests: AgentState = { ...stateAfterCode, ...deltaAfterTests } as AgentState;
    console.log('generateTests returned messages length:', (stateAfterTests.messages || []).length);
    const lastTestMsg = (stateAfterTests.messages || []).at(-1);
    console.log('Last test message preview:', lastTestMsg ? String((lastTestMsg as any).content).slice(0, 400) : '(none)');
  } catch (err) {
    console.error('Error during flow:', err);
  }
}

run();
