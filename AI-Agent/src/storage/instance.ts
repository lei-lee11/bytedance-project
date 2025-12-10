import { StorageSystem } from "./index.js";

export const storage = new StorageSystem({
  basePath: "./data/langgraph-storage",
});

export const initPromise = storage.initialize();
