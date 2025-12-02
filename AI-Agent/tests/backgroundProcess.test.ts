import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  startBackgroundProcess,
  stopBackgroundProcess,
  listBackgroundProcesses,
  getProcessLogs,
  cleanupAllProcesses,
  resetProcessManager,
} from '../src/utils/tools/backgroundProcess.js';

describe('Background Process Management', () => {

  // 每个测试前重置进程管理器
  beforeEach(() => {
    resetProcessManager();
  });

  // 每个测试后清理所有进程
  afterEach(async () => {
    await cleanupAllProcesses();
  });

  describe('startBackgroundProcess', () => {
    test('should start a simple command successfully', async () => {
      const result = await startBackgroundProcess.func({
        command: 'python',
        args: ['-m', 'http.server', '8080'],
      });

      expect(result).toContain('✅ 已启动后台进程');
      expect(result).toContain('proc_');
      expect(result).toContain('PID:');
    });

    test('should reject dangerous commands', async () => {
      const result = await startBackgroundProcess.func({
        command: 'rm',
        args: ['-rf', '/'],
      });

      expect(result).toContain('❌');
      expect(result).toContain('安全警告');
      expect(result).toContain('危险操作');
    });

    test('should python3 start process', async () => {
      const result = await startBackgroundProcess.func({
        command: 'python3',
        args: ['-m', 'http.server', '8000'],
      });

      expect(result).toContain('✅ 已启动后台进程');
      expect(result).toContain('proc_');
      expect(result).toContain('PID:');
    });
  });

  describe('listBackgroundProcesses', () => {
    test('should return empty message when no processes', async () => {
      const result = await listBackgroundProcesses.func({});

      expect(result).toContain('当前没有后台进程在运行');
    });

    test('should list running processes', async () => {
      // 启动一个进程（Windows 兼容：使用 node 执行无限循环）
      await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });

      // 等待进程启动
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await listBackgroundProcesses.func({});

      expect(result).toContain('📊 后台进程列表');
      expect(result).toContain('proc_');
      expect(result).toContain('node');
      expect(result).toContain('running');
    });

    test('should show multiple processes', async () => {
      // 启动两个进程（Windows 兼容）
      await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });
      await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });

      // 等待进程启动
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await listBackgroundProcesses.func({});

      expect(result).toContain('共 2 个');
      expect(result).toContain('proc_1');
      expect(result).toContain('proc_2');
    });
  });

  describe('getProcessLogs', () => {
    test('should return error for non-existent process', async () => {
      const result = await getProcessLogs.func({
        processId: 'proc_999',
        tailLines: 50,
      });

      expect(result).toContain('❌');
      expect(result).toContain('进程不存在');
    });

    test('should capture stdout logs', async () => {
      // 启动一个会产生输出的进程
      const startResult = await startBackgroundProcess.func({
        command: 'echo',
        args: ['Test Output'],
      });

      // 提取进程 ID
      const match = startResult.match(/proc_\d+/);
      expect(match).not.toBeNull();
      const processId = match ? match[0] : '';

      // 等待进程完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 获取日志
      const logsResult = await getProcessLogs.func({
        processId,
        tailLines: 10,
      });

      expect(logsResult).toContain('📋 进程日志');
      expect(logsResult).toContain(processId);
      expect(logsResult).toContain('echo Test Output');
    });

    test('should limit log lines', async () => {
      const startResult = await startBackgroundProcess.func({
        command: 'echo',
        args: ['Test'],
      });

      const match = startResult.match(/proc_\d+/);
      const processId = match ? match[0] : '';

      await new Promise(resolve => setTimeout(resolve, 200));

      const logsResult = await getProcessLogs.func({
        processId,
        tailLines: 5,
      });

      expect(logsResult).toContain('进程日志');
    });
  });

  describe('stopBackgroundProcess', () => {
    test('should return error for non-existent process', async () => {
      const result = await stopBackgroundProcess.func({
        processId: 'proc_999',
      });

      expect(result).toContain('❌');
      expect(result).toContain('进程不存在');
    });

    test('should stop a running process', async () => {
      // 启动一个长期运行的进程（Windows 兼容）
      const startResult = await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });

      const match = startResult.match(/proc_\d+/);
      expect(match).not.toBeNull();
      const processId = match ? match[0] : '';

      // 等待进程启动并确认运行
      await new Promise(resolve => setTimeout(resolve, 800));

      // 检查进程确实在运行
      const listResult = await listBackgroundProcesses.func({});
      expect(listResult).toContain('running');

      // 停止进程
      const stopResult = await stopBackgroundProcess.func({
        processId,
      });

      expect(stopResult).toContain('已停止进程');
      expect(stopResult).toContain(processId);
    });

    test('should handle already stopped process', async () => {
      // 启动一个快速退出的进程
      const startResult = await startBackgroundProcess.func({
        command: 'echo',
        args: ['Quick exit'],
      });

      const match = startResult.match(/proc_\d+/);
      const processId = match ? match[0] : '';

      // 等待进程退出
      await new Promise(resolve => setTimeout(resolve, 500));

      // 尝试停止已经退出的进程
      const stopResult = await stopBackgroundProcess.func({
        processId,
      });

      expect(stopResult).toContain('已经停止');
    });
  });

  describe('Process lifecycle', () => {
    test('should track process from start to stop', async () => {
      // 启动进程（Windows 兼容）
      const startResult = await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });
      expect(startResult).toContain('✅ 已启动后台进程');

      const match = startResult.match(/proc_\d+/);
      const processId = match ? match[0] : '';

      // 等待进程启动
      await new Promise(resolve => setTimeout(resolve, 800));

      // 检查进程列表
      const listResult = await listBackgroundProcesses.func({});
      expect(listResult).toContain(processId);
      expect(listResult).toContain('running');

      // 停止进程
      const stopResult = await stopBackgroundProcess.func({
        processId,
      });
      expect(stopResult).toContain('已停止进程');

      // 再次检查列表
      const listResult2 = await listBackgroundProcesses.func({});
      expect(listResult2).toContain(processId);
      expect(listResult2).toContain('stopped');
    });
  });

  describe('Cleanup', () => {
    test('should cleanup all running processes', async () => {
      // 启动多个进程（Windows 兼容）
      await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });
      await startBackgroundProcess.func({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)'],
      });

      // 等待进程启动
      await new Promise(resolve => setTimeout(resolve, 800));

      const beforeCleanup = await listBackgroundProcesses.func({});
      expect(beforeCleanup).toContain('共 2 个');
      expect(beforeCleanup).toContain('running');

      // 清理所有进程
      await cleanupAllProcesses();

      // 等待清理完成
      await new Promise(resolve => setTimeout(resolve, 200));

      // 验证进程状态已更新
      const afterCleanup = await listBackgroundProcesses.func({});
      // 进程应该显示为 stopped
      expect(afterCleanup).not.toContain('running');
    });
  });
});

