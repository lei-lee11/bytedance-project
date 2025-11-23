import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";

const DB_URI = "mongodb://localhost:27017";
const DB_NAME = "AI-Agent-DB";
const client = new MongoClient(DB_URI);
export const closeConnection = async () => {
  await client.close();
};
export const checkpointer = new MongoDBSaver({
  client,
  dbName: DB_NAME,
});