import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import {
  detectProjectLanguage,
  findAvailableTestCommand,
  findAvailableSingleFileTestCommand,
} from '../src/utils/tools/testRunner.js';
import { testTools } from '../src/utils/tools/testRunner.js';

const TEST_DIR = join(process.cwd(), 'tests', 'temp-test-runner');

describe('Test Runner Tools', () => {
  // 创建测试目录
  beforeAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch (error) {
      // 忽略删除错误
    }
    await mkdir(TEST_DIR, { recursive: true });
  });

  // 清理测试目录
  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch (error) {
      // 忽略删除错误
    }
  });

  describe('detectProjectLanguage', () => {
    test('should detect JavaScript project from package.json', async () => {
      const testDir = join(TEST_DIR, 'js-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'package.json'), '{"name": "test"}');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('javascript');
    });

    test('should detect TypeScript project from tsconfig.json', async () => {
      const testDir = join(TEST_DIR, 'ts-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'tsconfig.json'), '{}');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('typescript');
    });

    test('should detect Python project from requirements.txt', async () => {
      const testDir = join(TEST_DIR, 'py-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'requirements.txt'), 'pytest==7.0.0');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('python');
    });

    test('should detect Python project from pyproject.toml', async () => {
      const testDir = join(TEST_DIR, 'py-project-2');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'pyproject.toml'), '[tool.poetry]');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('python');
    });

    test('should detect Go project from go.mod', async () => {
      const testDir = join(TEST_DIR, 'go-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'go.mod'), 'module test');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('go');
    });

    test('should detect Rust project from Cargo.toml', async () => {
      const testDir = join(TEST_DIR, 'rust-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'Cargo.toml'), '[package]');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('rust');
    });

    test('should detect TypeScript from .ts files when no config', async () => {
      const testDir = join(TEST_DIR, 'ts-files-only');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'index.ts'), 'const x: string = "test";');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toContain('typescript');
    });

    test('should return empty array for unknown project', async () => {
      const testDir = join(TEST_DIR, 'unknown-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'README.md'), '# Test');

      const languages = await detectProjectLanguage(testDir);

      expect(languages).toEqual([]);
    });
  });

  describe('findAvailableTestCommand', () => {
    test('should find npm test for JavaScript project with package.json', async () => {
      const testDir = join(TEST_DIR, 'npm-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: {
            test: 'jest',
          },
        })
      );

      const command = await findAvailableTestCommand('javascript', testDir);

      expect(command).toBeTruthy();
      expect(command).toMatch(/npm|yarn|pnpm|npx/);
    });

    test('should return null for project without test setup', async () => {
      const testDir = join(TEST_DIR, 'no-test-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: {},
        })
      );

      const command = await findAvailableTestCommand('javascript', testDir);

      // 应该跳过没有 test 脚本的命令，可能返回 npx 命令或 null
      expect(command === null || command?.startsWith('npx')).toBe(true);
    });

    test('should return null for invalid language', async () => {
      const command = await findAvailableTestCommand('invalid-language', TEST_DIR);

      expect(command).toBeNull();
    });
  });

  describe('findAvailableSingleFileTestCommand', () => {
    test('should find single file test command for JavaScript', async () => {
      const testDir = join(TEST_DIR, 'single-file-js');
      await mkdir(testDir, { recursive: true });
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: {
            test: 'jest',
          },
        })
      );

      const command = await findAvailableSingleFileTestCommand(
        'javascript',
        testDir,
        'test.spec.js'
      );

      expect(command).toBeTruthy();
      expect(command).toContain('test.spec.js');
      expect(command).toMatch(/jest|vitest|mocha|npm|yarn/);
    });

    test('should replace {file} placeholder with actual file path', async () => {
      const testDir = join(TEST_DIR, 'placeholder-test');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'package.json'), '{"name": "test"}');

      const command = await findAvailableSingleFileTestCommand(
        'javascript',
        testDir,
        'src/utils/calculator.test.js'
      );

      expect(command).toBeTruthy();
      expect(command).toContain('src/utils/calculator.test.js');
      expect(command).not.toContain('{file}');
    });

    test('should return null for invalid language', async () => {
      const command = await findAvailableSingleFileTestCommand(
        'invalid-language',
        TEST_DIR,
        'test.js'
      );

      expect(command).toBeNull();
    });
  });

  describe('Test Tools', () => {
    test('should export testTools array', () => {
      expect(Array.isArray(testTools)).toBe(true);
      expect(testTools.length).toBeGreaterThan(0);
    });

    test('should have auto_run_test tool', () => {
      const autoTestTool = testTools.find((tool) => tool.name === 'auto_run_test');
      expect(autoTestTool).toBeDefined();
      expect(autoTestTool?.description).toBeTruthy();
    });

    test('should have run_test_command tool', () => {
      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      expect(manualTestTool?.description).toBeTruthy();
    });

    test('should have run_single_test_file tool (NEW)', () => {
      const singleFileTool = testTools.find((tool) => tool.name === 'run_single_test_file');
      expect(singleFileTool).toBeDefined();
      expect(singleFileTool?.description).toContain('单个测试文件');
    });

    test('should have list_supported_test_languages tool', () => {
      const listTool = testTools.find((tool) => tool.name === 'list_supported_test_languages');
      expect(listTool).toBeDefined();
      expect(listTool?.description).toBeTruthy();
    });
  });

  describe('run_single_test_file tool (NEW FEATURE)', () => {
    test('should detect language from file extension', async () => {
      const singleFileTool = testTools.find((tool) => tool.name === 'run_single_test_file');
      expect(singleFileTool).toBeDefined();
      if (!singleFileTool) return;

      const testDir = join(TEST_DIR, 'auto-detect-lang');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'package.json'), JSON.stringify({ name: 'test', scripts: { test: 'jest' } }));
      await writeFile(join(testDir, 'test.spec.js'), 'test("example", () => {});');

      const result = await singleFileTool.func({
        testFilePath: join(testDir, 'test.spec.js'),
        workingDirectory: testDir,
        timeout: 5000,
      });

      expect(result).toContain('检测到语言');
    }, 10000);

    test('should accept manual language specification', async () => {
      const singleFileTool = testTools.find((tool) => tool.name === 'run_single_test_file');
      expect(singleFileTool).toBeDefined();
      if (!singleFileTool) return;

      const testDir = join(TEST_DIR, 'manual-lang');
      await mkdir(testDir, { recursive: true });
      await writeFile(join(testDir, 'package.json'), JSON.stringify({ name: 'test' }));

      const result = await singleFileTool.func({
        testFilePath: 'test.spec.js',
        language: 'javascript',
        workingDirectory: testDir,
        timeout: 5000,
      });

      expect(result).toContain('JavaScript/TypeScript');
    }, 10000);

    test('should handle file without detectable extension', async () => {
      const singleFileTool = testTools.find((tool) => tool.name === 'run_single_test_file');
      expect(singleFileTool).toBeDefined();
      if (!singleFileTool) return;

      const result = await singleFileTool.func({
        testFilePath: 'testfile',
        workingDirectory: TEST_DIR,
        timeout: 5000,
      });

      expect(result).toContain('无法检测文件语言类型');
    });

    test('should use default timeout of 60 seconds', () => {
      const singleFileTool = testTools.find((tool) => tool.name === 'run_single_test_file');
      expect(singleFileTool).toBeDefined();
      if (!singleFileTool) return;

      const schema = singleFileTool.schema;
      const timeoutField = schema.shape.timeout;
      
      // Zod 4.x API: use _def.value instead of _def.defaultValue()
      expect(timeoutField._def.value).toBe(60000);
    });
  });

  describe('Timeout improvements', () => {
    test('auto_run_test should have 60s default timeout', () => {
      const autoTestTool = testTools.find((tool) => tool.name === 'auto_run_test');
      expect(autoTestTool).toBeDefined();
      if (!autoTestTool) return;

      const schema = autoTestTool.schema;
      const timeoutField = schema.shape.timeout;
      
      // Zod 4.x API: use _def.value instead of _def.defaultValue()
      expect(timeoutField._def.value).toBe(60000);
    });

    test('run_test_command should have 60s default timeout', () => {
      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      const schema = manualTestTool.schema;
      const timeoutField = schema.shape.timeout;
      
      // Zod 4.x API: use _def.value instead of _def.defaultValue()
      expect(timeoutField._def.value).toBe(60000);
    });
  });

  describe('list_supported_test_languages tool', () => {
    test('should list all supported languages', async () => {
      const listTool = testTools.find((tool) => tool.name === 'list_supported_test_languages');
      expect(listTool).toBeDefined();
      if (!listTool) return;

      const result = await listTool.func({});

      expect(result).toContain('JavaScript/TypeScript');
      expect(result).toContain('Python');
      expect(result).toContain('Java');
      expect(result).toContain('Go');
      expect(result).toContain('Rust');
      expect(result).toContain('C#');
      expect(result).toContain('C++');
      expect(result).toContain('Ruby');
      expect(result).toContain('PHP');
    });

    test('should include single file test commands (NEW)', async () => {
      const listTool = testTools.find((tool) => tool.name === 'list_supported_test_languages');
      expect(listTool).toBeDefined();
      if (!listTool) return;

      const result = await listTool.func({});

      expect(result).toContain('单文件测试');
    });

    test('should show test file patterns', async () => {
      const listTool = testTools.find((tool) => tool.name === 'list_supported_test_languages');
      expect(listTool).toBeDefined();
      if (!listTool) return;

      const result = await listTool.func({});

      expect(result).toContain('测试文件');
      expect(result).toContain('.test.');
      expect(result).toContain('.spec.');
    });
  });

  describe('run_test_command tool - security', () => {
    test('should block dangerous commands', async () => {
      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      const result = await manualTestTool.func({
        command: 'rm -rf /',
        workingDirectory: TEST_DIR,
      });

      expect(result).toContain('⛔');
      expect(result).toContain('安全警告');
      expect(result).toContain('危险操作');
    });

    test('should block del /f commands on Windows', async () => {
      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      const result = await manualTestTool.func({
        command: 'del /f important.txt',
        workingDirectory: TEST_DIR,
      });

      expect(result).toContain('⛔');
      expect(result).toContain('安全警告');
    });

    test('should allow safe test commands', async () => {
      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      // 使用 node 执行简单命令作为安全测试
      const result = await manualTestTool.func({
        command: 'node --version',
        language: 'javascript',
        workingDirectory: TEST_DIR,
        timeout: 10000,
      });

      // 不应该被安全检查阻止
      expect(result).not.toContain('⛔');
      expect(result).not.toContain('安全警告');
    });
  });

  describe('auto_run_test tool', () => {
    test('should detect language and attempt to run tests', async () => {
      const autoTestTool = testTools.find((tool) => tool.name === 'auto_run_test');
      expect(autoTestTool).toBeDefined();
      if (!autoTestTool) return;
      const testDir = join(TEST_DIR, 'auto-test-project');
      await mkdir(testDir, { recursive: true });
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          scripts: {
            test: 'node --version', // 使用简单命令模拟测试
          },
        })
      );

      const result = await autoTestTool.func({
        workingDirectory: testDir,
        timeout: 10000,
      });

      expect(result).toContain('检测到语言');
      expect(result).toContain('JavaScript/TypeScript');
    });

    test('should handle directory without detectable language', async () => {
      const autoTestTool = testTools.find((tool) => tool.name === 'auto_run_test');
      expect(autoTestTool).toBeDefined();
      if (!autoTestTool) return;

      const testDir = join(TEST_DIR, 'no-lang-project');
      await mkdir(testDir, { recursive: true });

      const result = await autoTestTool.func({
        workingDirectory: testDir,
        timeout: 5000,
      });

      expect(result).toContain('无法检测到项目语言');
    });
  });

  describe('Integration: Real test execution', () => {
    test('should execute a simple Node.js test', async () => {
      const testDir = join(TEST_DIR, 'real-test-execution');
      await mkdir(testDir, { recursive: true });
      
      // 创建 package.json
      await writeFile(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-execution',
          scripts: {
            test: 'node test.js',
          },
        })
      );
      
      // 创建简单的测试脚本
      await writeFile(
        join(testDir, 'test.js'),
        `
          console.log('Running tests...');
          console.log('✓ Test 1 passed');
          console.log('✓ Test 2 passed');
          process.exit(0);
        `
      );

      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      const result = await manualTestTool.func({
        command: 'node test.js',
        language: 'javascript',
        workingDirectory: testDir,
        timeout: 10000,
      });

      expect(result).toContain('✅');
      expect(result).toContain('命令执行成功');
      expect(result).toContain('Test 1 passed');
      expect(result).toContain('Test 2 passed');
    });

    test('should handle test failure correctly', async () => {
      const testDir = join(TEST_DIR, 'failing-test');
      await mkdir(testDir, { recursive: true });
      
      // 创建会失败的测试脚本
      await writeFile(
        join(testDir, 'failing-test.js'),
        `
          console.log('Running tests...');
          console.error('✗ Test failed: Expected true but got false');
          process.exit(1);
        `
      );

      const manualTestTool = testTools.find((tool) => tool.name === 'run_test_command');
      expect(manualTestTool).toBeDefined();
      if (!manualTestTool) return;

      const result = await manualTestTool.func({
        command: 'node failing-test.js',
        workingDirectory: testDir,
        timeout: 10000,
      });

      expect(result).toContain('❌');
      expect(result).toContain('命令执行失败');
      expect(result).toContain('退出码');
    });
  });
});

