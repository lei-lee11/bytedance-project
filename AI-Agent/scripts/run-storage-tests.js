#!/usr/bin/env node

/**
 * 会话存储机制测试运行脚本
 * 用于快速运行存储系统的完整测试套件
 */

import { runStorageTests } from '../tests/storage.test.js';

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.AI_AGENT_STORAGE_PATH = './test-storage-temp';

console.log('🔧 测试环境配置:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   AI_AGENT_STORAGE_PATH: ${process.env.AI_AGENT_STORAGE_PATH}`);
console.log('');

// 运行测试
runStorageTests()
  .then(() => {
    console.log('\n🎯 测试套件执行完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 测试套件执行失败:', error);
    console.error('\n请检查:');
    console.error('1. 存储目录权限是否正确');
    console.error('2. 磁盘空间是否充足');
    console.error('3. Node.js版本是否兼容');
    console.error('4. 依赖包是否正确安装');
    process.exit(1);
  });