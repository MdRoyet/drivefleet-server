import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins"; // ⚡ Import the JWT Plugin
import { db } from "./db.js";
import dotenv from "dotenv";

dotenv.config(); // Ensure env variables load here!

export const auth = betterAuth({
  database: mongodbAdapter(db),

  // 1. Tell BetterAuth EXACTLY where it lives
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000/api/auth",

  // 2. Tell BetterAuth to trust your Next.js frontend!
  trustedOrigins: ["http://localhost:3000"],

  emailAndPassword: {
    enabled: true,
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },

  plugins: [
    // ⚡ This activates asymmetric signing and generates the /api/auth/jwks endpoint!
    jwt({
      jwks: {
        keyRotationInterval: 7 * 24 * 60 * 60, // Auto-rotates your security keys weekly
      },
    }),
  ],
});

