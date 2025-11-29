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

const MinimalThinking = ({
  content,
  toolName,
}: {
  content: string;
  toolName?: string;
}) => {
  // 获取最后一行非空内容作为状态描述
  const lines = content.split("\n").filter((l) => l.trim());
  const lastLine =
    lines.length > 0 ? lines[lines.length - 1].slice(0, 60) : "Thinking...";

  return (
    <Box marginY={1}>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text color="gray">
        {" "}
        {toolName ? `Running ${toolName}...` : lastLine}
      </Text>
    </Box>
  );
};


//  组件 3: 工具审批卡片 (核心交互)

const ApprovalCard = ({
  tool,
  onSelect,
}: {
  tool: PendingToolState;
  onSelect: (choice: "approve" | "reject") => void;
}) => {
  const items = [
    { label: "Run this command", value: "approve" }, // 英文更简洁，或用 "执行指令"
    { label: "Abort", value: "reject" },
  ];

  return (
    <Box flexDirection="column" marginTop={1} paddingBottom={1}>
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          ⚠ Permission Request
        </Text>
        <Text color="gray"> › The agent wants to execute an action:</Text>
      </Box>

      {/* 拟物化代码块风格 */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray" // 灰色边框更像编辑器
        paddingX={1}
        marginBottom={1}
        marginLeft={2} // 缩进，体现层级
      >
        <Box>
          <Text color="magenta">fn </Text>
          <Text bold color="blue">
            {tool.name}
          </Text>
          <Text color="gray">(</Text>
        </Box>

        {/* 参数格式化显示 */}
        <Box marginLeft={2} flexDirection="column">
          {Object.entries(tool.args).map(([key, val]) => (
            <Box key={key}>
              <Text color="cyan">{key}</Text>
              <Text color="gray">: </Text>
              <Text color="green">"{String(val)}"</Text>
              <Text color="gray">,</Text>
            </Box>
          ))}
        </Box>

        <Box>
          <Text color="gray">)</Text>
        </Box>
      </Box>

      {/* 菜单 */}
      <Box marginLeft={2}>
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value as "approve" | "reject")}
          isFocused={true}
          // 自定义指示器
          indicatorComponent={({ isSelected }) => (
            <Text color={isSelected ? "cyan" : "gray"}>
              {isSelected ? "● " : "○ "}
            </Text>
          )}
          itemComponent={({ isSelected, label }) => (
            <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
              {label}
            </Text>
          )}
        />
      </Box>
    </Box>
  );
};

const InputArea = ({
  onSubmit,
  isLoading,
}: {
  onSubmit: (val: string) => void;
  isLoading: boolean;
}) => {
  const [query, setQuery] = useState("");

  // 如果正在加载，不仅不渲染输入框，还要确保清空状态，防止残影
  if (isLoading) {
    return (
      <Box marginY={1}>
        <Text color="gray">Wait...</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      marginTop={1}
      // ✨ 关键技巧：尽量保持输入框在界面下方，视觉上贴近输入法候选窗
    >
      <Box marginRight={1}>
        <Text color="green">➜ </Text>
      </Box>

      <TextInput
        value={query}
        onChange={setQuery}
        onSubmit={(val) => {
          if (!val.trim()) return;
          onSubmit(val);
          setQuery(""); // 提交后清空
        }}
        placeholder="在此输入指令 (支持中文)..."
        // ✨ 确保焦点始终在这里
        focus={!isLoading}
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

        //最终输出
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
            
            //流式输出
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
const StatusBadge = ({ role }: { role: string }) => {
  switch (role) {
    case "user":
      return <Text color="green">➜ </Text>;
    case "ai":
      return <Text color="cyan">◇ </Text>; // Vercel 风格
    case "system":
      return <Text color="gray">│ </Text>;
    default:
      return <Text> </Text>;
  }
  };
  

  // =========================================
  // 视图渲染
  // =========================================
  return (
    <Box flexDirection="column" height="100%" padding={1}>
      <Header />
      {/* 1. 顶部：历史记录和 Logo  */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Logo */}
        <Box marginBottom={1}>
          <Text color="green" bold>
            CUSTOM CLI v1.0
          </Text>
        </Box>

        {/* 历史记录 */}
        <Static items={history}>
          {(item) => (
            <Box key={item.id} flexDirection="row" marginBottom={1}>
              {/* 左侧图标列，保持对齐 */}
              <Box width={2} marginRight={1}>
                <StatusBadge role={item.role} />
              </Box>

              {/* 右侧内容列 */}
              <Box flexDirection="column" flexGrow={1}>
                {/* 如果是 System 消息（比如工具调用结果），用灰色显示，更像日志 */}
                {item.role === "system" ? (
                  <Text color="gray" dimColor>
                    {item.content}
                  </Text>
                ) : (
                  // AI 和 User 消息正常显示
                  <Box flexDirection="column">
                    {item.role === "ai" && item.reasoning && (
                      // 思考过程：折叠且灰色，不抢眼
                      <Text color="gray" dimColor>
                        ↳ 🧠 {item.reasoning.slice(0, 50)}... (Thought process
                        hidden)
                      </Text>
                    )}
                    {item.role === "ai" ? (
                      <MarkdownText content={item.content} />
                    ) : (
                      <Text bold>{item.content}</Text>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Static>
      </Box>

      {/* 2. 实时活动区 (Thinking / Tool Running) */}
      <Box flexDirection="column">
        {(isLoading || currentAIContent || currentReasoning || currentTool) && (
          <Box
            flexDirection="column"
            marginBottom={1}
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
          >
            <Box>
              <Text color="cyan" bold>
                🤖 AI Generating...
              </Text>
            </Box>

            <Box marginLeft={2} flexDirection="column">
              {/* 实时思考 */}
              {(currentReasoning || currentTool) && (
                <MinimalThinking
                  content={currentReasoning}
                  toolName={currentTool?.name}
                />
              )}

              {/* 实时正文 */}
              {currentAIContent && <MarkdownText content={currentAIContent} />}
            </Box>
          </Box>
        )}
      </Box>

      {/* 3. 底部交互区 (State Machine) */}
      <Box marginTop={1}>
        {awaitingApproval ? (
          // 如果在审批，显示审批卡片
          <ApprovalCard tool={pendingTool!} onSelect={handleApprovalSelect} />
        ) : (
          // 否则显示输入框
          <InputArea onSubmit={handleUserSubmit} isLoading={isLoading} />
        )}
      </Box>
    </Box>
  );
};
