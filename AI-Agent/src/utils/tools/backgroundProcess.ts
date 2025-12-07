import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn, ChildProcess, exec } from "child_process";

// 进程信息接口
interface ProcessInfo {
  id: string;
  command: string;
  args: string[];
  pid?: number;
  status: "running" | "stopped" | "error";
  startTime: Date;
  exitCode?: number;
  logs: string[]; // 最近 1000 行日志
  process?: ChildProcess;
}

// 进程管理器单例类
class ProcessManager {
  private static instance: ProcessManager;
  private processes: Map<string, ProcessInfo>;
  private nextId: number;
  private readonly MAX_LOG_LINES = 1000;

  private constructor() {
    this.processes = new Map();
    this.nextId = 1;
  }

  static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  // 启动后台进程
  startProcess(
    command: string,
    args: string[],
    workingDirectory?: string
  ): string {
    const processId = `proc_${this.nextId++}`;

    // 检查危险命令
    const dangerousPatterns = [
      "rm -rf",
      "del /f",
      "format",
      "dd if=",
      "mkfs",
      ":(){:|:&};:",
      "fork bomb",
    ];

    const fullCommand = `${command} ${args.join(" ")}`;
    for (const pattern of dangerousPatterns) {
      if (fullCommand.toLowerCase().includes(pattern)) {
        throw new Error(
          `⛔ 安全警告：命令包含危险操作 "${pattern}"，已阻止执行。`
        );
      }
    }

    // 创建进程信息
    const processInfo: ProcessInfo = {
      id: processId,
      command,
      args,
      status: "running",
      startTime: new Date(),
      logs: [],
    };

    try {
      // 启动子进程
      // 注意：使用 shell: true 时，在 Windows 上会创建进程树：
      // 1. Node.js spawn 启动 cmd.exe（这是 childProcess.pid）
      // 2. cmd.exe 启动实际命令进程（如 python）
      // 因此会看到两个进程：
      //   - cmd.exe 进程（PID = childProcess.pid）
      //   - 实际命令进程（如 python，PID 不同）
      // 为了解决这个问题，在终止进程时使用 taskkill /T 来终止整个进程树
      // 这确保了所有子进程（包括实际的命令进程）都会被终止
      const childProcess = spawn(command, args, {
        cwd: workingDirectory || process.cwd(),
        shell: true,
        detached: false,
      });

      // 检查 PID 是否存在（spawn 可能立即失败）
      if (childProcess.pid === undefined) {
        throw new Error("进程启动失败：无法获取进程 ID");
      }

      processInfo.process = childProcess;
      processInfo.pid = childProcess.pid;

      // 监听标准输出
      childProcess.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        lines.forEach((line) => {
          if (line.trim()) {
            this.addLog(processId, `[stdout] ${line}`);
          }
        });
      });

      // 监听标准错误
      childProcess.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n");
        lines.forEach((line) => {
          if (line.trim()) {
            this.addLog(processId, `[stderr] ${line}`);
          }
        });
      });

      // 监听进程退出
      childProcess.on("exit", (code, signal) => {
        const info = this.processes.get(processId);
        if (info) {
          // 如果进程被信号终止（code 为 null，signal 有值），视为正常停止
          // 或者退出码为 0，也视为正常停止
          if (code === 0 || (code === null && signal)) {
            info.status = "stopped";
          } else {
            info.status = "error";
          }
          info.exitCode = code ?? undefined;
          this.addLog(
            processId,
            `[系统] 进程退出 - 退出码: ${code ?? "null"}, 信号: ${signal || "none"}`
          );
        }
      });

      // 监听错误（spawn 失败会触发此事件）
      // 注意：error 事件可能在 spawn 返回后立即触发
      let errorHandled = false;
      childProcess.on("error", (error) => {
        if (errorHandled) return;
        errorHandled = true;
        
        const info = this.processes.get(processId);
        if (info) {
          info.status = "error";
          this.addLog(processId, `[错误] 进程启动失败: ${error.message}`);
          // 确保进程信息已存储（标记为错误状态）
          if (!this.processes.has(processId)) {
            this.processes.set(processId, info);
          }
        }
      });

      // 存储进程信息（在确认 PID 存在后）
      this.processes.set(processId, processInfo);
      return processId;
    } catch (error: unknown) {
      // 同步错误（如参数错误等）
      processInfo.status = "error";
      const errorMessage = error instanceof Error ? error.message : String(error);
      processInfo.logs.push(`[错误] 启动失败: ${errorMessage}`);
      this.processes.set(processId, processInfo);
      throw error;
    }
  }

  // 添加日志（限制最大行数）
  private addLog(processId: string, logLine: string) {
    const info = this.processes.get(processId);
    if (info) {
      info.logs.push(`[${new Date().toISOString()}] ${logLine}`);
      if (info.logs.length > this.MAX_LOG_LINES) {
        info.logs.shift(); // 移除最旧的日志
      }
    }
  }

  // 停止进程
  async stopProcess(processId: string): Promise<boolean> {
    const info = this.processes.get(processId);
    if (!info) {
      throw new Error(`❌ 进程不存在: ${processId}`);
    }

    if (info.status !== "running") {
      return true; // 已经停止
    }

    if (!info.process || !info.pid) {
      info.status = "error";
      throw new Error(`❌ 无法停止进程: 进程句柄无效`);
    }

    const childProcess = info.process;
    const isWindows = process.platform === "win32";
    let isResolved = false; // 防止重复 resolve

    return new Promise((resolve) => {
      const safeResolve = (success: boolean) => {
        if (!isResolved) {
          isResolved = true;
          resolve(success);
        }
      };

      // 检查进程是否已经退出（处理竞态条件）
      if (childProcess.killed || childProcess.exitCode !== null) {
        info.status = "stopped";
        this.addLog(processId, "[系统] 进程已经退出");
        safeResolve(true);
        return;
      }

      // 设置超时强制杀死
      const killTimeout = setTimeout(() => {
        if (isResolved) return;
        
        try {
          let killSuccess = false;
          if (isWindows) {
            // Windows 不支持信号，直接 kill
            killSuccess = childProcess.kill();
            if (killSuccess) {
              this.addLog(processId, "[系统] 强制终止进程 (Windows)");
            } else {
              this.addLog(processId, "[警告] kill() 返回 false，进程可能无法终止");
              // 尝试使用系统命令强制终止（/T 参数终止整个进程树，包括子进程）
              if (info.pid) {
                try {
                  exec(`taskkill /F /T /PID ${info.pid}`, (error) => {
                    if (!error) {
                      this.addLog(processId, `[系统] 使用 taskkill /T 强制终止进程树 PID ${info.pid}（包括所有子进程）`);
                    }
                  });
                } catch (e) {
                  // 忽略错误
                }
              }
            }
          } else {
            killSuccess = childProcess.kill("SIGKILL");
            if (killSuccess) {
              this.addLog(processId, "[系统] 强制终止进程 (SIGKILL)");
            } else {
              this.addLog(processId, "[警告] kill(SIGKILL) 返回 false，进程可能无法终止");
              // 尝试使用系统命令强制终止
              if (info.pid) {
                try {
                  exec(`kill -9 ${info.pid}`, (error) => {
                    if (!error) {
                      this.addLog(processId, `[系统] 使用 kill -9 强制终止进程 PID ${info.pid}`);
                    }
                  });
                } catch (e) {
                  // 忽略错误
                }
              }
            }
          }
          // 更新状态
          if (info.status === "running") {
            info.status = "stopped";
          }
        } catch (error: unknown) {
          // 进程可能已经退出
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.addLog(processId, `[警告] 强制终止时出错: ${errorMessage}`);
        }
        safeResolve(true);
      }, 5000); // 5秒超时

      // 注册 exit 监听器（使用 once 避免重复触发）
      const exitHandler = () => {
        if (isResolved) return;
        clearTimeout(killTimeout);
        if (info.status === "running") {
          info.status = "stopped";
        }
        safeResolve(true);
      };

      // 如果进程已经退出，立即处理
      if (childProcess.killed || childProcess.exitCode !== null) {
        clearTimeout(killTimeout);
        info.status = "stopped";
        safeResolve(true);
        return;
      }

      // 尝试优雅退出
      try {
        let killSuccess = false;
        if (isWindows) {
          // Windows 上直接 kill，没有 SIGTERM
          // 注意：由于使用 shell: true，childProcess.pid 是 cmd.exe 的 PID
          // kill() 只会终止 cmd.exe，子进程（如 python）可能继续运行
          // 因此优先使用 taskkill /T 来终止整个进程树
          killSuccess = childProcess.kill();
          if (killSuccess) {
            this.addLog(processId, "[系统] 发送终止信号 (Windows)");
            // 同时使用 taskkill /T 确保终止所有子进程
            if (info.pid) {
              try {
                exec(`taskkill /F /T /PID ${info.pid}`, (error) => {
                  if (!error) {
                    this.addLog(processId, `[系统] 使用 taskkill /T 终止进程树 PID ${info.pid}（确保所有子进程被终止）`);
                  }
                });
              } catch (e) {
                // 忽略错误
              }
            }
          } else {
            this.addLog(processId, "[警告] kill() 返回 false，尝试使用 taskkill /T");
            // 如果 kill() 失败，直接使用 taskkill /T
            if (info.pid) {
              try {
                exec(`taskkill /F /T /PID ${info.pid}`, (error) => {
                  if (!error) {
                    killSuccess = true; // 更新成功状态
                    this.addLog(processId, `[系统] 使用 taskkill /T 终止进程树 PID ${info.pid}`);
                  }
                });
              } catch (e) {
                // 忽略错误
              }
            }
          }
        } else {
          killSuccess = childProcess.kill("SIGTERM");
          if (killSuccess) {
            this.addLog(processId, "[系统] 发送终止信号 (SIGTERM)");
          } else {
            this.addLog(processId, "[警告] kill(SIGTERM) 返回 false，尝试 SIGKILL");
            // 如果 SIGTERM 失败，直接尝试 SIGKILL
            const killKillSuccess = childProcess.kill("SIGKILL");
            if (killKillSuccess) {
              killSuccess = true; // 更新成功状态
              this.addLog(processId, "[系统] 直接发送 SIGKILL 信号");
            } else {
              this.addLog(processId, "[警告] kill(SIGKILL) 也返回 false");
            }
          }
        }

        // 如果 kill 失败且进程还在运行，标记为错误
        if (!killSuccess && !childProcess.killed && childProcess.exitCode === null) {
          clearTimeout(killTimeout);
          info.status = "error";
          this.addLog(processId, "[错误] 无法发送终止信号给进程");
          safeResolve(false);
          return;
        }

        // 注册 exit 监听器
        childProcess.once("exit", exitHandler);
      } catch (error: unknown) {
        clearTimeout(killTimeout);
        // 如果 kill 失败，可能是进程已经退出
        if (childProcess.killed || childProcess.exitCode !== null) {
          info.status = "stopped";
          safeResolve(true);
        } else {
          info.status = "error";
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.addLog(processId, `[错误] 停止失败: ${errorMessage}`);
          safeResolve(false);
        }
      }
    });
  }

  // 获取所有进程列表
  listProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((info) => ({
      id: info.id,
      command: info.command,
      args: info.args,
      pid: info.pid,
      status: info.status,
      startTime: info.startTime,
      exitCode: info.exitCode,
      logs: [], // 不返回完整日志
    }));
  }

  // 获取进程详情
  getProcess(processId: string): ProcessInfo | undefined {
    return this.processes.get(processId);
  }

  // 获取进程日志
  getProcessLogs(processId: string, tailLines = 50): string[] {
    const info = this.processes.get(processId);
    if (!info) {
      throw new Error(`❌ 进程不存在: ${processId}`);
    }

    // 返回最后 N 行
    return info.logs.slice(-tailLines);
  }

  // 清理所有进程
  async cleanupAll(): Promise<void> {
    const runningProcesses = Array.from(this.processes.values()).filter(
      (p) => p.status === "running"
    );

    console.log(`🧹 清理 ${runningProcesses.length} 个后台进程...`);

    const stopPromises = runningProcesses.map((p) => this.stopProcess(p.id));
    await Promise.all(stopPromises);

    console.log("✅ 所有后台进程已清理");
  }

  // 重置进程管理器（用于测试）
  reset(): void {
    // 停止所有运行中的进程
    const runningProcesses = Array.from(this.processes.values()).filter(
      (p) => p.status === "running" && p.process
    );
    
    const isWindows = process.platform === "win32";
    runningProcesses.forEach((p) => {
      try {
        if (isWindows) {
          p.process?.kill();
        } else {
          p.process?.kill("SIGKILL");
        }
      } catch (error) {
        // 忽略错误
      }
    });

    // 清空进程映射
    this.processes.clear();
    // 重置ID计数器
    this.nextId = 1;
  }
}

// 导出单例实例
const processManager = ProcessManager.getInstance();

// 工具1: 启动后台进程
const startBackgroundProcess = new DynamicStructuredTool({
  name: "start_background_process",
  description:
    "启动一个后台进程（非阻塞）。适用于长期运行的服务，如 HTTP 服务器、数据库、开发服务器等。" +
    "进程将在后台运行，不会阻塞 Agent 的其他操作。" +
    "返回进程 ID，可用于后续管理（查看日志、停止进程等）。"+
    "\n\n**重要提示**：" +
    "\n- Windows 系统使用 'python' 而不是 'python3'" +
    "\n- Windows 系统使用 'node' 而不是 'nodejs'" +
    "\n- 路径分隔符：Windows 使用反斜杠 \\ 或正斜杠 /，Unix 使用正斜杠 /",
  schema: z.object({
    command: z
      .string()
      .describe(
        "要执行的命令（如 'python', 'node', 'npm' 等）。不要包含参数。"
      ),
    args: z
      .array(z.string())
      .optional()
      .default([])
      .describe(
        "命令参数数组。例如: ['-m', 'http.server', '8080'] 或 ['run', 'dev']"
      ),
    workingDirectory: z
      .string()
      .optional()
      .describe("工作目录（默认为当前目录）"),
  }),
  func: async ({ command, args = [], workingDirectory }) => {
    try {
      // Windows 命令兼容性转换
      let actualCommand = command;
      if (process.platform === 'win32') {
        const commandMap: Record<string, string> = {
          'python3': 'python',
          'python3.exe': 'python.exe',
          'pip3': 'pip',
        };
        actualCommand = commandMap[command] || command;
      }
      const processId = processManager.startProcess(
        actualCommand,
        args,
        workingDirectory
      );
      const info = processManager.getProcess(processId);

      let result = `✅ 已启动后台进程: ${processId}\n`;
      result += `📝 命令: ${actualCommand} ${args.join(" ")}\n`;  // ✅ 显示实际命令
      if (actualCommand !== command) {
        result += `ℹ️ 原命令 '${command}' 已自动转换为 '${actualCommand}' (Windows兼容)\n`;
      }
      result += `🆔 PID: ${info?.pid}\n`;
      result += `📂 工作目录: ${workingDirectory || process.cwd()}\n`;
      result += `⏰启动时间: ${info?.startTime.toLocaleString()}\n\n`;
      result += `💡 提示: 使用 get_process_logs 查看日志，使用 stop_background_process 停止进程`;

      return result;
    } catch (error: any) {
      return `❌ 启动进程失败: ${error.message}`;
    }
  },
});

// 工具2: 停止后台进程
const stopBackgroundProcess = new DynamicStructuredTool({
  name: "stop_background_process",
  description:
    "停止一个正在运行的后台进程。" +
    "会先发送 SIGTERM 信号优雅退出，如果 5 秒内未退出则强制终止。",
  schema: z.object({
    processId: z
      .string()
      .describe("要停止的进程 ID（由 start_background_process 返回）"),
  }),
  func: async ({ processId }) => {
    try {
      const info = processManager.getProcess(processId);
      if (!info) {
        return `❌ 进程不存在: ${processId}`;
      }

      if (info.status !== "running") {
        return `ℹ️ 进程 ${processId} 已经停止（状态: ${info.status}）`;
      }

      await processManager.stopProcess(processId);

      const finalInfo = processManager.getProcess(processId);
      let result = `✅ 已停止进程: ${processId}\n`;
      result += `📝 命令: ${info.command} ${info.args.join(" ")}\n`;
      result += `⏱️ 运行时长: ${Math.round((Date.now() - info.startTime.getTime()) / 1000)} 秒\n`;

      if (finalInfo?.exitCode !== undefined) {
        result += `🔢 退出码: ${finalInfo.exitCode}\n`;
      }

      // 显示最后几行日志
      const recentLogs = processManager.getProcessLogs(processId, 5);
      if (recentLogs.length > 0) {
        result += `\n📋 最后几行日志:\n${recentLogs.join("\n")}`;
      }

      return result;
    } catch (error: any) {
      return `❌ 停止进程失败: ${error.message}`;
    }
  },
});

// 工具3: 列出所有后台进程
const listBackgroundProcesses = new DynamicStructuredTool({
  name: "list_background_processes",
  description:
    "列出所有后台进程的信息，包括进程 ID、命令、状态、PID、运行时长等。",
  schema: z.object({}),
  func: async () => {
    const processes = processManager.listProcesses();

    if (processes.length === 0) {
      return "ℹ️ 当前没有后台进程在运行";
    }

    let result = `📊 后台进程列表 (共 ${processes.length} 个):\n\n`;

    processes.forEach((proc) => {
      const statusIcon =
        proc.status === "running"
          ? "🟢"
          : proc.status === "stopped"
            ? "⚪"
            : "🔴";
      const runningTime = Math.round(
        (Date.now() - proc.startTime.getTime()) / 1000
      );

      result += `${statusIcon} ${proc.id}\n`;
      result += `   命令: ${proc.command} ${proc.args.join(" ")}\n`;
      result += `   状态: ${proc.status}\n`;
      result += `   PID: ${proc.pid || "N/A"}\n`;
      result += `   运行时长: ${runningTime} 秒\n`;
      result += `   启动时间: ${proc.startTime.toLocaleString()}\n`;
      if (proc.exitCode !== undefined) {
        result += `   退出码: ${proc.exitCode}\n`;
      }
      result += "\n";
    });

    result += `💡 提示: 使用 get_process_logs <process_id> 查看详细日志`;

    return result;
  },
});

// 工具4: 获取进程日志
const getProcessLogs = new DynamicStructuredTool({
  name: "get_process_logs",
  description:
    "获取指定后台进程的日志输出（stdout 和 stderr）。" +
    "可以指定返回最后 N 行日志。",
  schema: z.object({
    processId: z.string().describe("进程 ID"),
    tailLines: z
      .number()
      .optional()
      .default(50)
      .describe("返回最后 N 行日志（默认 50 行，最多 1000 行）"),
  }),
  func: async ({ processId, tailLines = 50 }) => {
    try {
      const info = processManager.getProcess(processId);
      if (!info) {
        return `❌ 进程不存在: ${processId}`;
      }

      const logs = processManager.getProcessLogs(
        processId,
        Math.min(tailLines, 1000)
      );

      let result = `📋 进程日志: ${processId}\n`;
      result += `📝 命令: ${info.command} ${info.args.join(" ")}\n`;
      result += `📊 状态: ${info.status}\n`;
      result += `📏 日志行数: ${logs.length}\n`;
      result += `\n${"=".repeat(60)}\n\n`;

      if (logs.length === 0) {
        result += "ℹ️ 暂无日志输出";
      } else {
        result += logs.join("\n");
      }

      return result;
    } catch (error: any) {
      return `❌ 获取日志失败: ${error.message}`;
    }
  },
});

// 导出工具数组
export const backgroundProcessTools = [
  startBackgroundProcess,
  stopBackgroundProcess,
  listBackgroundProcesses,
  getProcessLogs,
];

// 导出单个工具（用于测试）
export {
  startBackgroundProcess,
  stopBackgroundProcess,
  listBackgroundProcesses,
  getProcessLogs,
};

// 导出清理函数
export async function cleanupAllProcesses(): Promise<void> {
  await processManager.cleanupAll();
}

// 导出重置函数（仅用于测试）
export function resetProcessManager(): void {
  processManager.reset();
}

