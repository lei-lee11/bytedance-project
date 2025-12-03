import { StorageSystem } from "../storage/index.js";
import { LangGraphStorageAdapter } from "../storage/langgraphAdapter.js";
import { storage, initPromise } from "../storage/instance.ts";
/**
 * 创建 LangGraph 检查点保存器
 * 使用自定义的存储系统适配器
 */
export async function createCheckpointer() {
  // 创建存储系统实例
  // const storage = new StorageSystem({
  //   basePath: "./data/langgraph-storage",
  // });

  // // 初始化存储系统
  // await storage.initialize();
  await initPromise;

  // 创建 LangGraph 存储适配器
  const checkpointer = new LangGraphStorageAdapter(storage);

  return checkpointer;
}

/**
 * 便捷函数：获取默认的检查点保存器
 * 用于快速集成到图中
 */
export let checkpointer: LangGraphStorageAdapter;

// 初始化检查点（异步）
export async function initializeCheckpointer() {
  checkpointer = await createCheckpointer();
  return checkpointer;
}
