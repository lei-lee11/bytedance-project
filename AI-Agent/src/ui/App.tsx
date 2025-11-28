import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, Static, useInput, Newline } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input"; // ✨ 新增：用于选择菜单
import Spinner from "ink-spinner";
import { useRequest } from "ahooks";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph } from "../agent/graph.js"; 

// --- 配置 Markdown ---
marked.setOptions({
  renderer: new TerminalRenderer({
    code: (code: any) => code,
    blockquote: (quote: string) => `│ ${quote}`,
  }) as any,
});

// --- 类型定义 ---
type UIMessage = {
  id: string;
  role: "user" | "ai" | "system";
  content: string;
  reasoning?: string;
};

type ToolState = { name: string; input: string; };
type PendingToolState = { name: string; args: any; };

const THREAD_ID = "cli-session-v1";
const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;


// 组件 1: 顶部标题栏 

const Header = () => (
  <Box borderStyle="classic" borderColor="blue" paddingX={1} marginBottom={1}>
    <Text bold color="blue">🤖 AI Agent CLI </Text>
    <Text color="gray"> | Powered by LangGraph & Ink</Text>
  </Box>
);


//  组件 2: 思考折叠面板 

const ThinkingPanel = ({ content, isFinished = false }: { content: string, isFinished?: boolean }) => {
  if (!content) return null;

  // 1. 如果思考已结束，显示一行摘要
  if (isFinished) {
    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
         <Text color="gray" dimColor>↳ 💡 思考过程已隐藏 (由 {content.length} 字符组成)</Text>
      </Box>
    );
  }

  // 2. 如果正在思考，截取最后几行 (类似 tail -f 效果)
  // split('\n') 可能会导致性能问题如果文本极大，但在流式输出中通常没事
  const lines = content.split('\n');
  const maxLines = 5; // 只显示最后 5 行
  
  const displayLines = lines.length > maxLines 
    ? lines.slice(-maxLines) 
    : lines;
  
  const isTruncated = lines.length > maxLines;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Box marginBottom={0}>
        <Text color="yellow" bold><Spinner type="dots" /> AI 正在思考...</Text>
      </Box>
      
      <Box marginTop={0} flexDirection="column">
        {/* 如果被截断，显示省略号提示 */}
        {isTruncated && (
          <Text color="yellow" dimColor>... (上文省略)</Text>
        )}
        
        {/* 显示最后几行内容 */}
        {displayLines.map((line, i) => (
           <Text key={i} color="yellow">{line || " "}</Text>
        ))}
      </Box>
    </Box>
  );
};


//  组件 3: 工具审批卡片 (核心交互)

const ApprovalCard = ({ 
  tool, 
  onSelect 
}: { 
  tool: PendingToolState, 
  onSelect: (choice: 'approve' | 'reject') => void 
}) => {
  
  const items = [
    { label: "✅ 批准执行 (Approve)", value: "approve" },
    { label: "🚫 拒绝操作 (Reject)", value: "reject" },
  ];

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="red" padding={1} marginY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>🛑 安全拦截 (Approval Required)</Text>
        <Text>AI 请求执行外部操作，请审核：</Text>
      </Box>

      {/* 工具详情框 */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text>🛠️ 工具名称: <Text bold color="magenta">{tool.name}</Text></Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">参数 Payload:</Text>
          <Text color="yellow">{JSON.stringify(tool.args, null, 2)}</Text>
        </Box>
      </Box>

      {/* 选择菜单 */}
      <Text bold>请选择操作:</Text>
      <SelectInput 
        items={items} 
        onSelect={(item) => onSelect(item.value as 'approve' | 'reject')}
      />
    </Box>
  );
};


// 主程序 App
export const App = ({ initialMessage }: { initialMessage?: string }) => {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<UIMessage[]>([]);
  const [statusText, setStatusText] = useState("");
  
  // 状态管理
  const [currentAIContent, setCurrentAIContent] = useState("");
  const [currentReasoning, setCurrentReasoning] = useState("");
  const [currentTool, setCurrentTool] = useState<ToolState | null>(null);
  const [pendingTool, setPendingTool] = useState<PendingToolState | null>(null); // 待审批工具
  
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // --- 发送消息逻辑 ---
  const { run: sendMessage, loading: isThinking } = useRequest(
    async (text: string | null, isResume = false) => {
      setInput("");
      setCurrentAIContent("");
      setCurrentReasoning("");
      setCurrentTool(null);
      setPendingTool(null);
      setAwaitingApproval(false);
      setStatusText(isResume ? "正在继续执行..." : "AI 正在思考...");

      const config = {
        configurable: { thread_id: THREAD_ID },
        version: "v2" as const,
      };

      try {
        // 如果是恢复执行，传入 null；如果是新消息，传入 HumanMessage
        const inputs = isResume ? null : { messages: [new HumanMessage(text!)] };
        const stream = await graph.streamEvents(inputs, config);

        if (!stream) return;

        let fullContent = "";
        let fullReasoning = "";

        for await (const event of stream) {
          // 1. 处理流式生成
          if (event.event === "on_chat_model_stream") {
            const chunk = event.data.chunk;
            
            // 提取思考内容 (兼容性处理)
            let reasoningChunk = "";
            if (chunk.additional_kwargs?.reasoning_content) {
               reasoningChunk = chunk.additional_kwargs.reasoning_content;
            } else if ((chunk as any).reasoning_content) {
               reasoningChunk = (chunk as any).reasoning_content;
            }

            if (reasoningChunk) {
              fullReasoning += reasoningChunk;
              setCurrentReasoning(fullReasoning);
            }

            if (chunk.content && typeof chunk.content === "string") {
              fullContent += chunk.content;
              setCurrentAIContent(fullContent);
            }
          } 
          // 2. 工具开始
          else if (event.event === "on_tool_start") {
            setCurrentTool({ 
              name: event.name, 
              input: JSON.stringify(event.data.input) 
            });
            setStatusText(`执行工具: ${event.name}...`);
          } 
          // 3. 工具结束
          else if (event.event === "on_tool_end") {
            setCurrentTool(null); 
            setStatusText("工具执行完毕");
          }
        }

        // 将本轮对话存入历史
        if (fullContent || fullReasoning) {
          setHistory((prev) => [
            ...prev,
            { 
              id: generateId(), 
              role: "ai", 
              content: fullContent,
              reasoning: fullReasoning 
            },
          ]);
          setCurrentAIContent(""); // 清空实时显示，转为历史显示
          setCurrentReasoning("");
        }

        // 检查是否因 interrupt 暂停
        const snapshot = await graph.getState(config);
        if (snapshot.next.length > 0) {
          setAwaitingApproval(true);
          const lastMsg = snapshot.values.messages[snapshot.values.messages.length - 1];
          if (lastMsg?.tool_calls?.length) {
            const call = lastMsg.tool_calls[0];
            setPendingTool({ name: call.name, args: call.args });
            setStatusText("等待用户批准...");
          }
        } else {
          setStatusText("");
        }

      } catch (e: any) {
        setHistory((prev) => [...prev, { id: generateId(), role: "system", content: `Error: ${e.message}` }]);
      }
    },
    { manual: true }
  );

  // --- 拒绝逻辑 ---
  const { run: rejectExecution } = useRequest(
    async () => {
      setStatusText("正在取消...");
      const config = { configurable: { thread_id: THREAD_ID } };
      const snapshot = await graph.getState(config);
      const lastMsg = snapshot.values.messages[snapshot.values.messages.length - 1];

      if (lastMsg?.tool_calls?.length) {
        const rejectionMessages = lastMsg.tool_calls.map((tc: any) => 
          new ToolMessage({ tool_call_id: tc.id, name: tc.name, content: "User rejected the tool execution." })
        );
        await graph.updateState(config, { messages: rejectionMessages });
        setHistory((prev) => [...prev, { id: generateId(), role: "system", content: "🚫 已拒绝执行" }]);
      }
      sendMessage(null, true); // 继续运行（让 AI 知道被拒绝了）
    },
    { manual: true }
  );

  // --- 初始化 ---
  useEffect(() => {
    if (initialMessage) {
      setHistory((prev) => [...prev, { id: generateId(), role: "user", content: initialMessage }]);
      sendMessage(initialMessage);
    }
  }, []);

  // --- 处理函数 ---
  const handleUserSubmit = (val: string) => {
    if (!val.trim()) return;
    setHistory((prev) => [...prev, { id: generateId(), role: "user", content: val }]);
    sendMessage(val, false);
  };

  // ✨ 处理菜单选择
 const handleApprovalSelect = (value: "approve" | "reject") => {
   // 防御性编程：虽然理论上菜单出来时 pendingTool 一定有值
   if (!pendingTool) return;

   if (value === "approve") {
     // 1. 记录详细的工具调用历史
     setHistory((prev) => [
       ...prev,
       {
         id: generateId(),
         role: "system",
         // 这里实现了你想要的效果：显示工具名 + 状态
         content: `🛠️ 调用工具: ${pendingTool.name} (✅ 已批准)`,
       },
     ]);

     // 2. 继续执行
     sendMessage(null, true);
   } else {
     // 拒绝时的记录
     setHistory((prev) => [
       ...prev,
       {
         id: generateId(),
         role: "system",
         content: `🚫 拒绝调用: ${pendingTool.name}`,
       },
     ]);

     rejectExecution();
   }
 };

  const isLoading = isThinking;

  // Markdown 渲染包装器
  const MarkdownText = ({ content }: { content: string }) => {
    const formattedText = useMemo(() => {
      try { return marked(content) || content; } catch { return content; }
    }, [content]);
    return <Text>{formattedText}</Text>;
  };

  // =========================================
  // 视图渲染
  // =========================================
  return (
    <Box flexDirection="column" padding={1}>
      <Header />

      {/* 1. 历史记录区 */}
      <Static items={history}>
        {(item) => (
          <Box key={item.id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={item.role === "user" ? "green" : item.role === "ai" ? "cyan" : "red"} bold>
                {item.role === "user" ? "👤 Human" : item.role === "ai" ? "🤖 AI" : "⚙️ System"}:
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              {item.role === "ai" && item.reasoning && (
                 <ThinkingPanel content={item.reasoning} isFinished={true} />
              )}
              {item.role === "ai" ? <MarkdownText content={item.content} /> : <Text>{item.content}</Text>}
            </Box>
          </Box>
        )}
      </Static>

      {/* 2. 实时活动区 (Thinking / Tool Running) */}
      {(isLoading || currentAIContent || currentReasoning || currentTool) && (
        <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box><Text color="cyan" bold>🤖 AI Generating...</Text></Box>
          
          <Box marginLeft={2} flexDirection="column">
            {/* 实时思考 */}
            {currentReasoning && <ThinkingPanel content={currentReasoning} isFinished={false} />}

            {/* 实时工具执行 (紫色转圈) */}
            {currentTool && (
              <Box borderStyle="round" borderColor="magenta" paddingX={1} marginY={0} flexDirection="column">
                 <Text color="magenta" bold><Spinner type="arc" /> 正在调用: {currentTool.name}</Text>
                 <Text color="magenta" dimColor>   args: {currentTool.input}</Text>
              </Box>
            )}
            
            {/* 实时正文 */}
            <MarkdownText content={currentAIContent} />
          </Box>
        </Box>
      )}

      {/* 3. 底部交互区 (State Machine) */}
      <Box borderStyle="round" borderColor={awaitingApproval ? "red" : "blue"} flexDirection="column">
        
        {/* 场景 A: 正在加载 */}
        {isLoading ? (
          <Text color="yellow"><Spinner type="dots" /> {statusText}</Text>
        ) : 
        
        /* 场景 B: 等待审批 (显示菜单按钮) */
        awaitingApproval && pendingTool ? (
          <ApprovalCard 
            tool={pendingTool} 
            onSelect={handleApprovalSelect} 
          />
        ) : 
        
        /* 场景 C: 等待用户输入 */
        (
          <Box>
            <Text color="green" bold>Input ➤ </Text>
            <TextInput 
              value={input} 
              onChange={setInput} 
              onSubmit={handleUserSubmit} 
              placeholder="输入指令..." 
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};
