import { graph } from "../../agent/graph.ts";
import * as readline from "readline";

async function interactiveChat() {
  const threadId = "123e4567-e89b-12d3-a456-426614174001";
  const config = { configurable: { thread_id: threadId } };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("开始对话 (输入 'quit' 退出):");

  const askQuestion = () => {
    rl.question("用户: ", (input) => {
      // 使用void操作符明确忽略Promise返回值
      void (async () => {
        if (input.toLowerCase() === 'quit') {
          rl.close();
          return;
        }

        try {
          const streamResponse = await graph.stream(
            {
              messages: [{ role: "user", content: input }],
            },
            config
          );

          console.log("助手:");
          for await (const chunk of streamResponse) {
            console.log(chunk);
          }
          console.log("\n");
        } catch (error) {
          console.error("Error:", error);
        } finally {
          // 确保无论成功还是失败都继续下一轮对话
          askQuestion(); // 继续下一轮对话
        }
      })();
    });
  };

  askQuestion();
}

// 正确处理顶层async函数的Promise
interactiveChat().catch(console.error);