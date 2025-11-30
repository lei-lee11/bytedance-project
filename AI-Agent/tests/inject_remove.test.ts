import { injectProjectTreeNode } from "../src/agent/nodes";

type AnyState = Record<string, any>;

function applyMessagesReducer(currentMessages: any[], newMessages: any[]) {
  const idsToRemove = new Set<string>();
  const result: any[] = [...currentMessages];

  for (const msg of newMessages) {
    // 识别 RemoveMessage（简单方式：构造函数名 或 presence of id and type）
    const ctor = msg?.constructor?.name;
    if ((ctor === "RemoveMessage" || msg?.type === "remove") && msg.id) {
      idsToRemove.add(msg.id);
      // 同时从 result 中移除已存在的旧消息
      for (let i = result.length - 1; i >= 0; --i) {
        if (result[i] && result[i].id === msg.id) {
          result.splice(i, 1);
        }
      }
      continue;
    }

    // 普通消息：如果其 id 在待删集合中，则忽略；否则追加
    if (msg?.id && idsToRemove.has(msg.id)) {
      // 忽略
      continue;
    }
    result.push(msg);
  }
  return result;
}

test("injectProjectTreeNode removes previous project-tree message when reinjected", async () => {
  const state: AnyState = {
    messages: [],
    projectRoot: ".",
    projectTreeInjected: false,
    projectTreeMessageId: undefined,
  };

  const first = await injectProjectTreeNode(state as any);
  expect(first.projectTreeInjected).toBe(true);
  expect(first.projectTreeMessageId).toBeDefined();

  // 应用第一次返回的 messages 到 state
  let applied = applyMessagesReducer(state.messages || [], first.messages || []);

  // 模拟状态变更
  const stateAfterFirst = {
    ...state,
    messages: applied,
    projectTreeInjected: true,
    projectTreeMessageId: first.projectTreeMessageId,
  };

  // 第二次注入：把 injected 置为 false，但保留 messageId
  const beforeSecond = { ...stateAfterFirst, projectTreeInjected: false };
  const second = await injectProjectTreeNode(beforeSecond as any);
  expect(second.projectTreeInjected).toBe(true);
  expect(second.projectTreeMessageId).toBeDefined();

  // 应用第二次返回的 messages 到已应用的 messages
  const applied2 = applyMessagesReducer(stateAfterFirst.messages || [], second.messages || []);

  // 断言：applied2 中不应包含第一次的 message id
  const ids = applied2.map((m: any) => m.id).filter(Boolean);
  expect(ids).not.toContain(first.projectTreeMessageId);
  expect(ids).toContain(second.projectTreeMessageId);
});
