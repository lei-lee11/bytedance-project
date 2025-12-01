import { createStorageSystem } from "../storage/index.js";
export const storage = createStorageSystem({
  basePath: process.env.AI_AGENT_STORAGE_PATH || "~/.ai-agent",
  maxHistoryRecords: 100,
  autoBackup: true,
});
