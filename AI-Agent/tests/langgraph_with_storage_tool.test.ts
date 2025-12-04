// 导入必要的模块
import { HumanMessage } from "@langchain/core/messages";
import {initializeGraph} from "../src/agent/graph.js";
import { v4 as uuidv4 } from 'uuid';

/**
 * 工具调用会话示例
 * 展示涉及工具调用的复杂会话如何存储
 */
console.log("\n🚀 工具调用会话示例");

try {
    const graph = await initializeGraph();

    const THREAD_ID = `cli-session-${uuidv4().slice(0, 8)}`;
    const config = {
        configurable: { thread_id: THREAD_ID },
        recursion_limit: 15
    };

    // 触发工具调用的用户输入
    console.log("\n💬 用户输入: '在src目录下创建一个hello.txt文件，内容为'欢迎使用命令行工具'");
    const userInput = {
        messages: [
            new HumanMessage({
                content: "在src目录下创建一个hello.txt文件，内容为'欢迎使用命令行工具'",
                id: "human-msg-1"
            })
        ],
        projectRoot: process.cwd(),
        projectTreeInjected: false,
    };

    console.log("🔄 执行工具调用会话...");
    console.log("预期流程: START -> agent -> tool 调用 -> 工具执行 -> agent -> END");

    const startTime = Date.now();
    const result = await graph.invoke(userInput, config);
    const duration = Date.now() - startTime;

    console.log(`✅ 工具调用会话完成，耗时: ${duration}ms`);

    // 分析工具调用
    result.messages.forEach(msg => {
        console.log(msg);
    });

} catch (error) {
    console.error("❌ 工具调用会话示例失败:", error);
    throw error;
}


