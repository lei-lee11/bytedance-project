import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface SyntaxCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SyntaxChecker {
  /**
   * 根据文件扩展名检测语言
   */
  detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
    };
    return languageMap[ext] || 'unknown';
  }

  /**
   * 检查代码语法
   */
  async checkSyntax(code: string, language: string): Promise<SyntaxCheckResult> {
    try {
      switch (language.toLowerCase()) {
        case 'typescript':
        case 'javascript':
          return await this.checkJavaScriptSyntax(code);
        case 'python':
          return await this.checkPythonSyntax(code);
        case 'json':
          return this.checkJSONSyntax(code);
        default:
          return {
            valid: true,
            errors: [],
            warnings: [`语法检查暂不支持 ${language} 语言`],
          };
      }
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
  }

  /**
   * 检查 JavaScript/TypeScript 语法
   */
  private async checkJavaScriptSyntax(code: string): Promise<SyntaxCheckResult> {
    try {
      // 简单的语法检查：尝试使用 Function 构造器
      // 注意：这只能检查基本语法错误
      new Function(code);
      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
  }

  /**
   * 检查 Python 语法
   */
  private async checkPythonSyntax(code: string): Promise<SyntaxCheckResult> {
    try {
      // 创建临时文件
      const tempFile = path.join(process.cwd(), `.temp_syntax_check_${Date.now()}.py`);
      await fs.writeFile(tempFile, code, 'utf-8');

      try {
        // Windows 兼容：使用 python 而不是 python3
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        await execAsync(`${pythonCmd} -m py_compile "${tempFile}"`, {
          timeout: 5000,
        });

        // 清理临时文件
        await fs.unlink(tempFile).catch(() => {});
        await fs.unlink(tempFile + 'c').catch(() => {}); // 删除 .pyc 文件

        return {
          valid: true,
          errors: [],
          warnings: [],
        };
      } catch (error: any) {
        // 清理临时文件
        await fs.unlink(tempFile).catch(() => {});

        return {
          valid: false,
          errors: [error.stderr || error.message],
          warnings: [],
        };
      }
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
  }

  /**
   * 检查 JSON 语法
   */
  private checkJSONSyntax(code: string): SyntaxCheckResult {
    try {
      JSON.parse(code);
      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error: any) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
  }

  /**
   * 格式化语法检查结果为可读字符串
   */
  formatResult(result: SyntaxCheckResult): string {
    if (result.valid) {
      return '✅ 语法检查通过';
    }

    let output = '❌ 语法检查失败:\n';
    if (result.errors.length > 0) {
      output += '\n错误:\n';
      result.errors.forEach((error, index) => {
        output += `  ${index + 1}. ${error}\n`;
      });
    }

    if (result.warnings.length > 0) {
      output += '\n警告:\n';
      result.warnings.forEach((warning, index) => {
        output += `  ${index + 1}. ${warning}\n`;
      });
    }

    return output;
  }
}

// 导出单例
export const syntaxChecker = new SyntaxChecker();

