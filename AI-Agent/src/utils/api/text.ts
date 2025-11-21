const { Client } = await import("@langchain/langgraph-sdk");
// only set the apiUrl if you changed the default port when calling langgraph dev
const client = new Client({ apiUrl: "http://localhost:2024" });

const streamResponse = client.runs.stream(
  null, // Threadless run
  "agent", // Assistant ID
  {
    input: {
      messages: [{ role: "user", content: "用C++实现一个简单的加法函数" }],
    },
    streamMode: "messages-tuple",
  },
);

for await (const chunk of streamResponse) {
  console.log(`Receiving new event of type: ${chunk.event}...`);
  console.log(JSON.stringify(chunk.data));
  console.log("\n\n");
}
