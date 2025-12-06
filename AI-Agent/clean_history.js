#!/usr/bin/env node

/**
 * 清理AI智能体历史记录脚本
 * 该脚本会删除所有会话的历史记录和检查点
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

async function cleanHistory() {
    // 获取历史记录存储目录
    const aiAgentDir = path.join(homedir(), '.ai-agent');
    const sessionsDir = path.join(aiAgentDir, 'sessions');

    try {
        console.log('正在检查历史记录存储目录...');
        
        // 检查目录是否存在
        await fs.access(sessionsDir);
        
        console.log(`找到历史记录目录: ${sessionsDir}`);
        
        // 列出所有会话目录
        const sessionDirs = await fs.readdir(sessionsDir, { withFileTypes: true });
        const sessionFolders = sessionDirs.filter(dirent => dirent.isDirectory());
        
        if (sessionFolders.length === 0) {
            console.log('没有找到历史记录会话');
            return;
        }
        
        console.log(`找到 ${sessionFolders.length} 个会话，准备清理...`);
        
        // 逐个删除会话目录
        for (const sessionFolder of sessionFolders) {
            const sessionPath = path.join(sessionsDir, sessionFolder.name);
            await fs.rm(sessionPath, { recursive: true, force: true });
            console.log(`已清理会话: ${sessionFolder.name}`);
        }
        
        console.log('\n✅ 所有历史记录已成功清理！');
        console.log(`清理的目录: ${sessionsDir}`);
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('未找到历史记录目录，可能已经被清理过了');
            console.log(`预期目录: ${sessionsDir}`);
        } else {
            console.error('清理历史记录时发生错误:', error.message);
            process.exit(1);
        }
    }
}

// 执行清理
cleanHistory();
