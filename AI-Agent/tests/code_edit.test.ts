import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  editCodeSnippet,
  previewCodeChange,
  findCodeContext,
  restoreFromBackup,
} from '../src/utils/tools/code_edit.js';
import fs from 'fs/promises';
import path from 'path';

describe('Code Edit Tools', () => {

  const testFilePath = path.join(process.cwd(), 'test_code_edit_temp.ts');
  const testContent = `function hello() {
  console.log("Hello World");
  return true;
}

function goodbye() {
  console.log("Goodbye");
}`;

  beforeEach(async () => {
    // 创建测试文件
    await fs.writeFile(testFilePath, testContent, 'utf-8');
  });

  afterEach(async () => {
    // 清理测试文件和备份
    try {
      await fs.unlink(testFilePath);
      // 清理备份文件
      const dir = path.dirname(testFilePath);
      const baseName = path.basename(testFilePath);
      const files = await fs.readdir(dir);
      const backups = files.filter(f => f.startsWith(baseName + '.backup.'));
      await Promise.all(backups.map(f => fs.unlink(path.join(dir, f))));
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('find_code_context', () => {
    test('should find code with context', async () => {
      const result = await findCodeContext.func({
        file_path: testFilePath,
        search_pattern: 'console.log',
        context_lines: 2,
      });

      expect(result).toContain('找到 2 处匹配');
      expect(result).toContain('Hello World');
      expect(result).toContain('Goodbye');
    });

    test('should not find non-existent code', async () => {
      const result = await findCodeContext.func({
        file_path: testFilePath,
        search_pattern: 'nonexistent',
        context_lines: 2,
      });

      expect(result).toContain('未找到');
    });
  });

  describe('preview_code_change', () => {
    test('should preview code change without modifying file', async () => {
      const oldCode = '  console.log("Hello World");';
      const newCode = '  console.log("Hi there!");';

      const result = await previewCodeChange.func({
        file_path: testFilePath,
        old_code: oldCode,
        new_code: newCode,
      });

      expect(result).toContain('代码变更预览');
      expect(result).toContain('Hello World');
      expect(result).toContain('Hi there');

      // 验证文件未被修改
      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toBe(testContent);
    });
  });

  describe('edit_code_snippet', () => {
    test('should edit code with preview only', async () => {
      const oldCode = '  console.log("Hello World");';
      const newCode = '  console.log("Hi there!");';

      const result = await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: oldCode,
        new_code: newCode,
        preview_only: true,
      });

      expect(result).toContain('代码修改预览');
      expect(result).toContain('预览模式：未实际修改文件');

      // 验证文件未被修改
      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toBe(testContent);
    });

    test('should edit code and create backup', async () => {
      const oldCode = '  console.log("Hello World");';
      const newCode = '  console.log("Hi there!");';

      const result = await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: oldCode,
        new_code: newCode,
        language: 'typescript',
        preview_only: false,
      });

      expect(result).toContain('已创建备份');
      expect(result).toContain('文件已成功修改');

      // 验证文件已被修改
      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toContain('Hi there!');
      expect(content).not.toContain('Hello World');
    });

    test('should handle non-unique matches', async () => {
      const oldCode = 'console.log';

      const result = await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: oldCode,
        new_code: 'logger.info',
        preview_only: true,
      });

      expect(result).toContain('找到 2 处匹配');
      expect(result).toContain('请提供更多上下文');
    });

    test('should handle non-existent code', async () => {
      const result = await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: 'nonexistent code',
        new_code: 'new code',
        preview_only: true,
      });

      expect(result).toContain('未找到匹配的代码片段');
    });
  });

  describe('restore_from_backup', () => {
    test('should list backups', async () => {
      // 先创建一个备份（通过编辑）
      await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: '  console.log("Hello World");',
        new_code: '  console.log("Modified");',
        language: 'typescript',
        preview_only: false,
      });

      const result = await restoreFromBackup.func({
        file_path: testFilePath,
        list_only: true,
      });

      expect(result).toContain('文件备份列表');
      expect(result).toContain('最新');
    });

    test('should restore from backup', async () => {
      // 先修改文件
      await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: '  console.log("Hello World");',
        new_code: '  console.log("Modified");',
        language: 'typescript',
        preview_only: false,
      });

      // 验证修改成功
      let content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toContain('Modified');

      // 恢复备份
      const result = await restoreFromBackup.func({
        file_path: testFilePath,
        list_only: false,
      });

      expect(result).toContain('已恢复文件从备份');

      // 验证恢复成功
      content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toContain('Hello World');
      expect(content).not.toContain('Modified');
    });
  });

  describe('Integration: Full editing workflow', () => {
    test('should support complete editing workflow', async () => {
      // 1. 查找要修改的代码
      const findResult = await findCodeContext.func({
        file_path: testFilePath,
        search_pattern: 'Hello World',
        context_lines: 2,
      });
      expect(findResult).toContain('找到');

      // 2. 预览修改
      const previewResult = await previewCodeChange.func({
        file_path: testFilePath,
        old_code: '  console.log("Hello World");',
        new_code: '  logger.info("Hello World");',
      });
      expect(previewResult).toContain('预览');

      // 3. 执行修改
      const editResult = await editCodeSnippet.func({
        file_path: testFilePath,
        old_code: '  console.log("Hello World");',
        new_code: '  logger.info("Hello World");',
        language: 'typescript',
        preview_only: false,
      });
      expect(editResult).toContain('成功修改');

      // 4. 验证修改
      const content = await fs.readFile(testFilePath, 'utf-8');
      expect(content).toContain('logger.info');

      // 5. 恢复备份
      const restoreResult = await restoreFromBackup.func({
        file_path: testFilePath,
        list_only: false,
      });
      expect(restoreResult).toContain('已恢复');

      // 6. 验证恢复
      const restoredContent = await fs.readFile(testFilePath, 'utf-8');
      expect(restoredContent).toBe(testContent);
    });
  });
});

