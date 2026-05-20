import { MongoClient, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;

export const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 5000,
});

// 1. Export the db instance directly so BetterAuth can use it
export const db = client.db("driveFleetDB");

// 2. Export connectDB so index.js can establish the actual connection
let dbInstance = null;

export const connectDB = async () => {
  if (dbInstance) return dbInstance;
  try {
    await client.connect();
    console.log("📌 Successfully connected to MongoDB (driveFleetDB)!");
    dbInstance = db;
    return dbInstance;
  } catch (error) {
    console.error("❌ Failed to establish connection to MongoDB:", error);
    process.exit(1);
  }
};
