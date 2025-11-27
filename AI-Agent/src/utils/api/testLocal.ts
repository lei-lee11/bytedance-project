import { graph } from "../../agent/graph.ts";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import * as readline from "readline";

// 创建 readline 接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// 封装提问函数为 Promise，方便 await 调用
const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function interactiveChat() {
  const threadId = "test-thread-local-001"; // 固定 ID 以保持上下文
  const config = { configurable: { thread_id: threadId } };

  console.log("--- 本地测试终端 ---");
  console.log("输入 'quit' 退出");

  const running = true;
  while (running) {
    // 1. 获取用户输入
    const input = await askQuestion("用户: ");
    if (input.toLowerCase() === "quit") break;

    try {
      // 2. 初次运行图
      // 我们封装一个函数来处理流式输出，因为后面审批通过后还要复用这段逻辑
      await runAndHandleInterrupts(
        { messages: [new HumanMessage(input)] },
        config,
      );
    } catch (error) {
      console.error("Error:", error);
    }
  }

  rl.close();
}

/**
 * 核心函数：运行图并在遇到中断时处理人工审批
 */
async function runAndHandleInterrupts(inputs: any, config: any) {
  // 1. 运行图 (如果是恢复运行，inputs 应该是 null)
  let streamResponse = await graph.stream(inputs, config);

  console.log("助手 (思考中...):");
  for await (const chunk of streamResponse) {
    // 打印图的中间状态，根据需要可以简化打印内容
    // console.log(JSON.stringify(chunk, null, 2));

    // 简单的输出过滤，只看最后的消息内容
    const nodeName = Object.keys(chunk)[0];
    if ((chunk as any)[nodeName]?.messages) {
      const typedChunk = chunk as Record<string, any>;
      const msg = typedChunk[nodeName]?.messages?.[0];
      if (msg.content) console.log(`[${nodeName}]: ${msg.content}`);
    }
  }

  // 2. 运行结束后，检查是否停在了“中断点”
  let snapshot = await graph.getState(config);

  // 只要接下来的步骤包含 'human_review'，说明需要审批
  while (snapshot.next.length > 0 && snapshot.next.includes("human_review")) {
    // 获取最后一条消息，查看 Agent 想要干什么
    const lastMessage =
      snapshot.values.messages[snapshot.values.messages.length - 1];
    const toolCall = lastMessage.tool_calls?.[0];

    console.log("============= 系统拦截: 敏感操作请求 =============");
    if (toolCall) {
      console.log(`操作名称: ${toolCall.name}`);
      console.log(`参数详情: ${JSON.stringify(toolCall.args, null, 2)}`);
    }
    console.log("====================================================");

    // 3. 询问用户
    const approval = await askQuestion("👉 是否批准执行? (y/n): ");

    if (approval.toLowerCase() === "y") {
      console.log("✅ 已批准，继续执行...");

      // 恢复执行：传入 null，表示不修改状态，直接从暂停处继续
      streamResponse = await graph.stream(null, config);
    } else {
      console.log("❌ 已拒绝。");

      // 拒绝策略：我们向图中注入一条 ToolMessage，伪装成工具报错
      // 这样 Agent 就会知道工具没执行成功，并可能会道歉
      const toolErrorMessage = new ToolMessage({
        tool_call_id: toolCall.id,
        content:
          "Error: 用户拒绝了该敏感操作 (User rejected the sensitive operation).",
        name: toolCall.name,
      });

      // 更新图的状态，假装这个是在 human_review 节点产生的
      await graph.updateState(
        config,
        { messages: [toolErrorMessage] },
        "human_review", // 这一步很重要，告诉图这是审批节点的结果
      );

      // 更新完状态后，继续运行图，让 Agent 处理这个错误
      streamResponse = await graph.stream(null, config);
    }

    // 打印后续的流 (无论是批准后执行工具，还是拒绝后 Agent 道歉)
    for await (const chunk of streamResponse) {
      const nodeName = Object.keys(chunk)[0];
      if ((chunk as any)[nodeName]?.messages) {
        const typedChunk = chunk as Record<string, any>;
        const msg = typedChunk[nodeName]?.messages?.[0];
        if (msg.content) console.log(`[${nodeName}]: ${msg.content}`);
      }
    }

    // 再次更新快照，确保没有后续中断了（循环检查）
    snapshot = await graph.getState(config);
  }

  console.log("(本轮对话结束)");
}

// 启动程序
interactiveChat().catch(console.error);
