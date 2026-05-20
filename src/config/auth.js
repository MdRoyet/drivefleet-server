import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { db } from "./db.js";

export const auth = betterAuth({
  // 1. Tell BetterAuth to use MongoDB and pass it your database instance
  database: mongodbAdapter(db),

  // 2. Enable standard Email & Password registration/login
  emailAndPassword: {
    enabled: true,
  },

  // 3. Enable Google Social Login
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
});
