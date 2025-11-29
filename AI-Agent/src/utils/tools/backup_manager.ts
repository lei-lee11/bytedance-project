import fs from 'fs/promises';
import path from 'path';

export class BackupManager {
  private readonly MAX_BACKUPS = 1;
  private readonly BACKUP_SUFFIX = '.backup.';

  /**
   * 创建文件备份
   */
  async createBackup(filePath: string): Promise<string> {
    try {
      // 检查文件是否存在
      await fs.access(filePath);

      // 生成备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${filePath}${this.BACKUP_SUFFIX}${timestamp}`;

      // 复制文件
      await fs.copyFile(filePath, backupPath);

      // 清理旧备份
      await this.cleanupOldBackups(filePath);

      return backupPath;
    } catch (error: any) {
      throw new Error(`创建备份失败: ${error.message}`);
    }
  }

  /**
   * 列出文件的所有备份
   */
  async listBackups(filePath: string): Promise<string[]> {
    try {
      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath);

      // 读取目录中的所有文件
      const files = await fs.readdir(dir);

      // 过滤出该文件的备份
      const backups = files
        .filter(file => file.startsWith(baseName + this.BACKUP_SUFFIX))
        .map(file => path.join(dir, file))
        .sort()
        .reverse(); // 最新的在前

      return backups;
    } catch (error: any) {
      throw new Error(`列出备份失败: ${error.message}`);
    }
  }

  /**
   * 恢复备份
   */
  async restore(filePath: string, backupPath?: string): Promise<void> {
    try {
      let sourceBackup: string;

      if (backupPath) {
        // 使用指定的备份
        sourceBackup = backupPath;
      } else {
        // 使用最新的备份
        const backups = await this.listBackups(filePath);
        if (backups.length === 0) {
          throw new Error('没有找到备份文件');
        }
        sourceBackup = backups[0];
      }

      // 检查备份文件是否存在
      await fs.access(sourceBackup);

      // 恢复文件
      await fs.copyFile(sourceBackup, filePath);
    } catch (error: any) {
      throw new Error(`恢复备份失败: ${error.message}`);
    }
  }

  /**
   * 清理旧备份，只保留最新的 MAX_BACKUPS 个
   */
  private async cleanupOldBackups(filePath: string): Promise<void> {
    try {
      const backups = await this.listBackups(filePath);

      // 删除超出数量的旧备份
      if (backups.length > this.MAX_BACKUPS) {
        const toDelete = backups.slice(this.MAX_BACKUPS);
        await Promise.all(toDelete.map(backup => fs.unlink(backup)));
      }
    } catch (error) {
      // 清理失败不影响主流程
      console.warn('清理旧备份时出错:', error);
    }
  }

  /**
   * 删除文件的所有备份
   */
  async deleteAllBackups(filePath: string): Promise<number> {
    try {
      const backups = await this.listBackups(filePath);
      await Promise.all(backups.map(backup => fs.unlink(backup)));
      return backups.length;
    } catch (error: any) {
      throw new Error(`删除备份失败: ${error.message}`);
    }
  }
}

// 导出单例
export const backupManager = new BackupManager();

