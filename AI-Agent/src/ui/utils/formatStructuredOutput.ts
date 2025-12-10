export function tryParseStructuredOutput(text: string) {
    // 尝试提取JSON对象
    const jsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    
    if (!jsonMatches) return null;
    
    const parsed: any[] = [];
    
    for (const jsonStr of jsonMatches) {
      try {
        const obj = JSON.parse(jsonStr);
        
        // 识别意图分类输出
        if (obj.intent && obj.confidence !== undefined && obj.reasoning) {
          parsed.push({ type: 'intent', data: obj });
        }
        // 识别项目规划输出
        else if (obj.projectPlanText || obj.techStackSummary || obj.projectInitSteps) {
          parsed.push({ type: 'project_plan', data: obj });
        }
        // 识别任务列表输出
        else if (obj.todos && Array.isArray(obj.todos)) {
          parsed.push({ type: 'todos', data: obj });
        }
      } catch (e) {
        // 忽略无法解析的内容
      }
    }
    
    return parsed.length > 0 ? parsed : null;
}

/**
 * 流式内容解析器：从当前流式文本中提取已闭合的 JSON 对象，
 * 并返回剩余未闭合的尾巴（用于显示 Processing）。
 */
export function parseStreamingStructuredOutput(text: string) {
  const items: any[] = [];
  let tail = "";

  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"' && !escape) {
      inString = !inString;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      // 找到一个完整的对象
      if (depth === 0 && start !== -1) {
        const jsonStr = text.slice(start, i + 1);
        try {
          const obj = JSON.parse(jsonStr);
          if (obj.intent && obj.confidence !== undefined && obj.reasoning) {
            items.push({ type: "intent", data: obj });
          } else if (
            obj.projectPlanText ||
            obj.techStackSummary ||
            obj.projectInitSteps
          ) {
            items.push({ type: "project_plan", data: obj });
          } else if (obj.todos && Array.isArray(obj.todos)) {
            items.push({ type: "todos", data: obj });
          }
        } catch {
          // ignore parse errors for stream
        }
        start = -1;
      }
    }
  }

  // 剩余未闭合的尾巴
  if (depth > 0 && start !== -1) {
    tail = text.slice(start);
  } else if (depth === 0 && start === -1) {
    // 没有处于解析中的 JSON，保留末尾少量字符用于提示
    tail = "";
  }

  return { items, tail };
}