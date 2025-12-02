import { HumanMessage } from "@langchain/core/messages";
import {initializeGraph} from "../src/agent/graph.js";
import { v4 as uuidv4 } from 'uuid';

// 会话存储路径 AI-Agent/data/langgraph-storage

console.log("🚀 基本对话示例 - LangGraph 会话存储");

try {
    // 1. 初始化图和存储系统
    console.log("\n📦 初始化图和存储系统...");
    const graph = await initializeGraph();

    console.log("✅ 图和存储系统初始化完成");

    // 2. 定义会话ID和配置
    const THREAD_ID = `cli-session-${uuidv4().slice(0, 8)}`;
    const config = {
        configurable: {
            thread_id: THREAD_ID,
        },
        recursion_limit: 10, // 防止无限循环
    };

    console.log(`📋 使用会话ID: ${THREAD_ID}`);

    // 3. 准备用户输入 - 第一次对话
    console.log("\n💬 第一次用户输入: '你好，我的名字叫李华'");
    const firstInput = {
        messages: [
            new HumanMessage({
                content: "你好，我的名字叫李华",
                id: "human-msg-1"
            })
        ],
        projectRoot: process.cwd(),
        projectTreeInjected: false,
    };

    // 4. 执行图 - 第一次调用
    console.log("\n🔄 第一次图调用...");
    console.log("预期流程: START -> agent -> (无工具调用) -> END");

    const startTime1 = Date.now();
    const result1 = await graph.invoke(firstInput, config);
    const duration1 = Date.now() - startTime1;

    console.log(`✅ 第一次调用完成，耗时: ${duration1}ms`);
    console.log(`📝 AI 响应: ${result1.messages[result1.messages.length - 1]?.content || '无'}`);

    // 6. 第二次对话 - 只提供新的用户输入，LangGraph 会自动加载历史
    console.log("\n💬 第二次用户输入: '我叫什么名字'");
    const secondInput = {
        // 只提供新的用户消息，LangGraph 会自动从 checkpoint 加载之前的对话历史
        messages: [
            new HumanMessage({
                content: "我叫什么名字？",
                id: "human-msg-2"
            })
        ],
        projectRoot: process.cwd(),
        projectTreeInjected: false,
    };

    // 7. 执行图 - 第二次调用
    console.log("\n🔄 第二次图调用...");
    console.log("预期流程: START -> agent (自动加载历史) -> (无工具调用) -> END");
    console.log("LangGraph 会自动从 checkpoint 加载之前的完整对话历史");

    const startTime2 = Date.now();
    const result2 = await graph.invoke(secondInput, config);
    const duration2 = Date.now() - startTime2;

    console.log(`✅ 第二次调用完成，耗时: ${duration2}ms`);
    console.log(`📝 AI 响应: ${result2.messages[result2.messages.length - 1]?.content || '无'}`);

    // 8. 第三次对话 - 只提供新的用户输入，LangGraph 会自动加载历史
    console.log("\n💬 第三次用户输入: '你能帮我做什么？'");
    const thirdInput = {
        // 只提供新的用户消息，LangGraph 会自动从 checkpoint 加载之前的对话历史
        messages: [
            new HumanMessage({
                content: "你能帮我做什么？",
                id: "human-msg-3"
            })
        ],
        projectRoot: process.cwd(),
        projectTreeInjected: false,
    };

    // 9. 执行图 - 第二次调用
    console.log("\n🔄 第三次图调用...");
    console.log("预期流程: START -> agent (自动加载历史) -> (无工具调用) -> END");
    console.log("LangGraph 会自动从 checkpoint 加载之前的完整对话历史");

    const startTime3 = Date.now();
    const result3 = await graph.invoke(thirdInput, config);
    const duration3 = Date.now() - startTime3;

    console.log(`✅ 第二次调用完成，耗时: ${duration3}ms`);
    console.log(`📝 AI 响应: ${result3.messages[result3.messages.length - 1]?.content || '无'}`);


} catch (error) {
    console.error("❌ 基本对话示例失败:", error);
    throw error;
}
