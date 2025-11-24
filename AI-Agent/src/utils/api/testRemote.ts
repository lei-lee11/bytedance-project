const { Client } = await import("@langchain/langgraph-sdk");
import { closeConnection } from "../../config/checkpointer.ts";

// only set the apiUrl if you changed the default port when calling langgraph dev
const client = new Client({ apiUrl: "http://localhost:2024" });

const streamResponse = client.runs.stream(
  "123e4567-e89b-12d3-a456-426614174001", // Threadless run
  "agent", // Assistant ID
  {
    input: {
      messages: [{ role: "user", content: "实现一个c++的快速排序函数" }],
    },
    streamMode: "messages-tuple",
  },
);
// const streamResponse1 = await graph.stream(
//   {
//     messages: [{ role: "user", content: "使用c++实现一个快速排序函数" }],
//   },

//   { configurable: { thread_id: "123e4567-e89b-12d3-a456-426614174001" } }, // ← MemorySaver 通过 thread_id 区分会话
// );
// const streamResponse = await graph.stream(
//   {
//     messages: [{ role: "user", content: "改用python实现" }],
//   },

//   { configurable: { thread_id: "123e4567-e89b-12d3-a456-426614174001" } }, // ← MemorySaver 通过 thread_id 区分会话
// );
// // for await (const chunk of streamResponse1) {
// //   console.log(chunk);
// //   console.log("\n\n");
// // }
for await (const chunk of streamResponse) {
  console.log(chunk);
  console.log("\n\n");
}
await closeConnection();

console.log("MongoDB connection closed.");