/**
 * 简单的 Diff 生成器
 * 生成类似 unified diff 格式的输出
 */

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export class DiffGenerator {
  /**
   * 生成 diff 输出
   */
  generateDiff(
    oldContent: string,
    newContent: string,
    fileName: string,
    contextLines: number = 3
  ): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diffs = this.computeDiff(oldLines, newLines);
    return this.formatDiff(diffs, fileName, contextLines);
  }

  /**
   * 计算两个文本之间的差异
   */
  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const diffs: DiffLine[] = [];
    
    // 简单的逐行对比算法
    let oldIndex = 0;
    let newIndex = 0;

    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (oldIndex >= oldLines.length) {
        // 剩余的都是新增行
        diffs.push({
          type: 'add',
          content: newLines[newIndex],
          lineNumber: newIndex + 1,
        });
        newIndex++;
      } else if (newIndex >= newLines.length) {
        // 剩余的都是删除行
        diffs.push({
          type: 'remove',
          content: oldLines[oldIndex],
          lineNumber: oldIndex + 1,
        });
        oldIndex++;
      } else if (oldLines[oldIndex] === newLines[newIndex]) {
        // 相同的行
        diffs.push({
          type: 'context',
          content: oldLines[oldIndex],
          lineNumber: oldIndex + 1,
        });
        oldIndex++;
        newIndex++;
      } else {
        // 不同的行 - 简单处理为先删除后添加
        diffs.push({
          type: 'remove',
          content: oldLines[oldIndex],
          lineNumber: oldIndex + 1,
        });
        diffs.push({
          type: 'add',
          content: newLines[newIndex],
          lineNumber: newIndex + 1,
        });
        oldIndex++;
        newIndex++;
      }
    }

    return diffs;
  }

  /**
   * 格式化 diff 输出
   */
  private formatDiff(diffs: DiffLine[], fileName: string, contextLines: number): string {
    const lines: string[] = [];

    lines.push(`--- a/${fileName}`);
    lines.push(`+++ b/${fileName}`);
    lines.push('');

    // 简化版本：显示所有差异
    let hasChanges = false;
    for (const diff of diffs) {
      if (diff.type === 'remove') {
        lines.push(`- ${diff.content}`);
        hasChanges = true;
      } else if (diff.type === 'add') {
        lines.push(`+ ${diff.content}`);
        hasChanges = true;
      } else if (hasChanges) {
        // 只在有变更时才显示上下文
        lines.push(`  ${diff.content}`);
      }
    }

    if (!hasChanges) {
      return '(没有差异)';
    }

    return lines.join('\n');
  }

  /**
   * 生成彩色 diff（用于终端）
   */
  generateColoredDiff(
    oldContent: string,
    newContent: string,
    fileName: string
  ): string {
    const diff = this.generateDiff(oldContent, newContent, fileName);
    
    // 简单的着色逻辑
    return diff
      .split('\n')
      .map(line => {
        if (line.startsWith('---') || line.startsWith('+++')) {
          return `\x1b[1m${line}\x1b[0m`; // 粗体
        } else if (line.startsWith('-')) {
          return `\x1b[31m${line}\x1b[0m`; // 红色
        } else if (line.startsWith('+')) {
          return `\x1b[32m${line}\x1b[0m`; // 绿色
        } else if (line.startsWith('@@')) {
          return `\x1b[36m${line}\x1b[0m`; // 青色
        }
        return line;
      })
      .join('\n');
  }

  /**
   * 生成简洁的变更摘要
   */
  generateSummary(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let additions = 0;
    let deletions = 0;

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= oldLines.length) {
        additions++;
      } else if (i >= newLines.length) {
        deletions++;
      } else if (oldLines[i] !== newLines[i]) {
        deletions++;
        additions++;
      }
    }

    return `+${additions} -${deletions} 行变更`;
  }
}

// 导出单例
export const diffGenerator = new DiffGenerator();

