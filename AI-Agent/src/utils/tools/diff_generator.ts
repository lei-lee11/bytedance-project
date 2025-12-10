/**
 * Diff 生成器
 * 使用智能 diff 算法，只显示真正内容有变化的差异
 */

import * as Diff from 'diff';

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
    contextLines = 3
  ): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diffs = this.computeDiff(oldLines, newLines);
    return this.formatDiff(diffs, fileName, contextLines);
  }

  /**
   * 计算两个文本之间的差异
   * 使用智能 diff 算法，只标记真正改变的内容
   */
  private computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const diffs: DiffLine[] = [];
    
    // 使用 diff 库的智能算法
    const changes = Diff.diffArrays(oldLines, newLines);
    
    for (const change of changes) {
      if (change.added) {
        // 真正新增的行
        change.value.forEach(line => {
          diffs.push({ type: 'add', content: line });
        });
      } else if (change.removed) {
        // 真正删除的行
        change.value.forEach(line => {
          diffs.push({ type: 'remove', content: line });
        });
      } else {
        // 未变化的上下文行
        change.value.forEach(line => {
          diffs.push({ type: 'context', content: line });
        });
      }
    }
    
    return diffs;
  }

  /**
   * 格式化 diff 输出
   * 只显示变更周围的上下文行
   */
  private formatDiff(diffs: DiffLine[], fileName: string, contextLines: number): string {
    const lines: string[] = [];

    lines.push(`--- a/${fileName}`);
    lines.push(`+++ b/${fileName}`);
    lines.push('');

    // 1. 找出所有变更的位置
    const changeIndices: number[] = [];
    diffs.forEach((diff, index) => {
      if (diff.type === 'add' || diff.type === 'remove') {
        changeIndices.push(index);
      }
    });

    if (changeIndices.length === 0) {
      return '(没有差异)';
    }

    // 2. 计算需要显示的行范围（合并相近的变更块）
    const ranges: Array<{ start: number; end: number }> = [];
    
    for (const changeIndex of changeIndices) {
      const start = Math.max(0, changeIndex - contextLines);
      const end = Math.min(diffs.length - 1, changeIndex + contextLines);
      
      // 如果新范围与上一个范围重叠或相邻，合并它们
      if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
        ranges[ranges.length - 1].end = Math.max(ranges[ranges.length - 1].end, end);
      } else {
        ranges.push({ start, end });
      }
    }

    // 3. 输出各个变更块
    for (const range of ranges) {
      // 计算行号信息用于 @@ 标记
      let oldLineStart = 0;
      let newLineStart = 0;
      let oldLineCount = 0;
      let newLineCount = 0;
      
      for (let i = 0; i < range.start; i++) {
        if (diffs[i].type !== 'add') oldLineStart++;
        if (diffs[i].type !== 'remove') newLineStart++;
      }
      
      for (let i = range.start; i <= range.end; i++) {
        if (diffs[i].type !== 'add') oldLineCount++;
        if (diffs[i].type !== 'remove') newLineCount++;
      }
      
      // 添加 @@ 标记
      lines.push(`@@ -${oldLineStart + 1},${oldLineCount} +${newLineStart + 1},${newLineCount} @@`);
      
      // 输出这个范围内的所有行
      for (let i = range.start; i <= range.end; i++) {
        const diff = diffs[i];
        if (diff.type === 'remove') {
          lines.push(`- ${diff.content}`);
        } else if (diff.type === 'add') {
          lines.push(`+ ${diff.content}`);
        } else {
          lines.push(`  ${diff.content}`);
        }
      }
      
      lines.push(''); // 空行分隔不同的变更块
    }

    return lines.join('\n').trim();
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
   * 基于智能 diff 算法的准确统计
   */
  generateSummary(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diffs = this.computeDiff(oldLines, newLines);

    let additions = 0;
    let deletions = 0;

    for (const diff of diffs) {
      if (diff.type === 'add') {
        additions++;
      } else if (diff.type === 'remove') {
        deletions++;
      }
    }

    return `+${additions} -${deletions} 行变更`;
  }
}

// 导出单例
export const diffGenerator = new DiffGenerator();

