#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const tsxLoader = path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = path.join(projectRoot, 'src', 'cli.tsx');
const tsConfigPath = path.join(projectRoot, 'tsconfig.json'); // 新增

if (!fs.existsSync(tsxLoader)) {
  console.error(`Error: 找不到 tsx, 请检查 node_modules`);
  process.exit(1);
}

const args = [
  tsxLoader,
  '--tsconfig', tsConfigPath, // 显式传入配置
  cliEntry,
  ...process.argv.slice(2)
];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    PROJECT_ROOT: process.cwd(),
  }
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
