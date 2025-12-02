import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn, ChildProcess } from "child_process";

// 进程信息接口
export interface ProcessInfo {
  id: string;
  command: string;
  args: string[];
  description?: string;
  process?: ChildProcess;
  pid?: number;
  status: "running" | "stopped" | "error";
  startTime?: Date;
  exitCode?: number;
  logs: string[];
}

class ProcessManager {
  private static instance: ProcessManager;
  private processes: Map<string, ProcessInfo> = new Map();
  private nextId = 1;
  private MAX_LOG_LINES = 2000;

  private constructor() {}

  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  startProcess(command: string, args: string[] = [], cwd?: string, description?: string): string {
    const id = `proc_${this.nextId++}`;

    const info: ProcessInfo = {
      id,
      command,
      args,
      description,
      status: "running",
      startTime: new Date(),
      logs: [],
    };

    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    info.process = child;
    info.pid = child.pid;

    child.stdout?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach((line: string) => {
        if (line.trim()) this.addLog(id, `[stdout] ${line}`);
      });
    });

    child.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      lines.forEach((line: string) => {
        if (line.trim()) this.addLog(id, `[stderr] ${line}`);
      });
    });

    child.on("exit", (code, signal) => {
      const p = this.processes.get(id);
      if (p) {
        p.status = code === 0 ? "stopped" : "error";
        p.exitCode = code ?? undefined;
        this.addLog(id, `[system] exited code=${code} signal=${signal ?? "none"}`);
      }
    });

    child.on("error", (err: any) => {
      const p = this.processes.get(id);
      if (p) {
        p.status = "error";
        this.addLog(id, `[error] ${err?.message ?? String(err)}`);
      }
    });

    this.processes.set(id, info);
    return id;
  }

  addLog(id: string, line: string) {
    const p = this.processes.get(id);
    if (!p) return;
    p.logs.push(`[${new Date().toISOString()}] ${line}`);
    if (p.logs.length > this.MAX_LOG_LINES) p.logs.shift();
  }

  async stopProcess(id: string): Promise<boolean> {
    const p = this.processes.get(id);
    if (!p) throw new Error(`process not found: ${id}`);
    if (p.status !== "running") return true;
    if (!p.process) {
      p.status = "error";
      throw new Error(`invalid process handle`);
    }

    return new Promise((resolve) => {
      const proc = p.process!;
      const killTimeout = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
          this.addLog(id, `[system] force killed`);
        } catch (e) {}
        resolve(true);
      }, 5000);

      try {
        proc.kill("SIGTERM");
        this.addLog(id, `[system] sent SIGTERM`);
        proc.once("exit", () => {
          clearTimeout(killTimeout);
          p.status = "stopped";
          resolve(true);
        });
      } catch (err: any) {
        clearTimeout(killTimeout);
        p.status = "error";
        this.addLog(id, `[error] stop failed: ${err?.message ?? String(err)}`);
        resolve(false);
      }
    });
  }

  listProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      command: p.command,
      args: p.args,
      description: p.description,
      process: undefined,
      pid: p.pid,
      status: p.status,
      startTime: p.startTime,
      exitCode: p.exitCode,
      logs: [],
    }));
  }

  getProcess(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  getProcessLogs(id: string, tail = 50): string[] {
    const p = this.processes.get(id);
    if (!p) throw new Error(`process not found: ${id}`);
    return p.logs.slice(-tail);
  }

  async cleanupAll(): Promise<void> {
    const running = Array.from(this.processes.values()).filter((x) => x.status === "running");
    await Promise.all(running.map((r) => this.stopProcess(r.id)));
  }

  reset(): void {
    Array.from(this.processes.values()).forEach((p) => {
      try {
        p.process?.kill("SIGKILL");
      } catch (e) {}
    });
    this.processes.clear();
    this.nextId = 1;
  }
}

const processManager = ProcessManager.getInstance();

const startDescription =
  "在系统终端启动一个后台进程（非阻塞），并返回进程 ID。支持指定工作目录。示例: command='python', args=['-m','http.server','8080']。";

export const startBackgroundProcess = new DynamicStructuredTool({
  name: "start_background_process",
  description: startDescription,
  schema: z.object({
    command: z.string().describe("要执行的命令，不含参数"),
    args: z.array(z.string()).optional().default([]),
    workingDirectory: z.string().optional(),
    description: z.string().optional(),
  }),
  func: async ({ command, args = [], workingDirectory, description }) => {
    try {
      let actual = command;
      if (process.platform === "win32") {
        const map: Record<string, string> = { python3: "python", "python3.exe": "python.exe", pip3: "pip" };
        actual = map[command] ?? command;
      }

      const id = processManager.startProcess(actual, args, workingDirectory, description);
      const info = processManager.getProcess(id);
      const startTimeText = info?.startTime ? info.startTime.toLocaleString() : "未知";

      let res = `✅ 已启动后台进程: ${id}\n`;
      res += `📝 命令: ${actual} ${args.join(" ")}\n`;
      if (actual !== command) res += `ℹ️ 原命令 '${command}' 已转换为 '${actual}'\n`;
      res += `🆔 PID: ${info?.pid ?? "N/A"}\n`;
      res += `📂 工作目录: ${workingDirectory ?? process.cwd()}\n`;
      res += `⏰ 启动时间: ${startTimeText}\n\n`;
      res += `提示: 使用 get_process_logs 和 stop_background_process 管理进程。`;

      return res;
    } catch (err: any) {
      return `❌ 启动失败: ${err?.message ?? String(err)}`;
    }
  },
});

export const stopBackgroundProcess = new DynamicStructuredTool({
  name: "stop_background_process",
  description: "停止后台进程（先尝试优雅退出，超时则强制）。",
  schema: z.object({ processId: z.string() }),
  func: async ({ processId }) => {
    try {
      const info = processManager.getProcess(processId);
      if (!info) return `❌ 进程不存在: ${processId}`;
      if (info.status !== "running") return `ℹ️ 进程 ${processId} 状态: ${info.status}`;
      await processManager.stopProcess(processId);
      const final = processManager.getProcess(processId);
      let res = `✅ 已停止: ${processId}\n`;
      res += `命令: ${info.command} ${info.args.join(" ")}\n`;
      if (final?.exitCode !== undefined) res += `退出码: ${final.exitCode}\n`;
      const logs = processManager.getProcessLogs(processId, 5);
      if (logs.length) res += `\n最近日志:\n${logs.join("\n")}`;
      return res;
    } catch (err: any) {
      return `❌ 停止失败: ${err?.message ?? String(err)}`;
    }
  },
});

export const listBackgroundProcesses = new DynamicStructuredTool({
  name: "list_background_processes",
  description: "列出后台进程（ID、命令、状态、PID）。",
  schema: z.object({}),
  func: async () => {
    const list = processManager.listProcesses();
    if (!list.length) return "ℹ️ 当前没有后台进程";
    let out = `📊 后台进程 (${list.length}):\n\n`;
    list.forEach((p) => {
      out += `${p.id} | ${p.command} ${p.args.join(" ")} | ${p.status} | PID:${p.pid ?? "N/A"}\n`;
    });
    return out;
  },
});

export const getProcessLogs = new DynamicStructuredTool({
  name: "get_process_logs",
  description: "获取进程日志（可限制行数）。",
  schema: z.object({ processId: z.string(), tailLines: z.number().optional().default(50) }),
  func: async ({ processId, tailLines = 50 }) => {
    try {
      const logs = processManager.getProcessLogs(processId, Math.min(tailLines, 1000));
      if (!logs.length) return `ℹ️ 进程 ${processId} 暂无日志`;
      return logs.join("\n");
    } catch (err: any) {
      return `❌ 获取日志失败: ${err?.message ?? String(err)}`;
    }
  },
});

export const backgroundProcessTools = [
  startBackgroundProcess,
  stopBackgroundProcess,
  listBackgroundProcesses,
  getProcessLogs,
];

export async function cleanupAllProcesses(): Promise<void> {
  await processManager.cleanupAll();
}

export function resetProcessManager(): void {
  processManager.reset();
}






