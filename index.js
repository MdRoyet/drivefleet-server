// ==========================================
// 0. CUSTOM GOOGLE DNS RESOLUTION FALLBACK
// ==========================================
import dns from "dns";
// Explicitly forces the Node runtime to resolve network hosts via Google Public DNS
dns.setServers(["8.8.8.8", "8.8.4.4"]);
console.log(
  "🔒 Network Layer: DNS routing locked to Google Public DNS (8.8.8.8)",
);

import express from "express";
import cors from "cors";
import { ObjectId } from "mongodb";
import dotenv from "dotenv";

// BetterAuth Imports
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { connectDB } from "./src/config/db.js";
import { auth } from "./src/config/auth.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// 1. MIDDLEWARE SETUP
// ==========================================
app.use(
  cors({
    origin: ["http://localhost:3000"],
    credentials: true,
  }),
);

// ==========================================
// 2. MOUNT BETTER AUTH
// ==========================================
// ⚠️ CRITICAL: Must be placed BEFORE express.json()
app.all("/api/auth/*", toNodeHandler(auth));

// Body Parser for standard API routes
app.use(express.json());

// ==========================================
// 3. CUSTOM SECURITY MIDDLEWARE (BetterAuth)
// ==========================================
const verifyToken = async (req, res, next) => {
  try {
    // BetterAuth automatically validates the HTTPOnly cookie session
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access: Session missing or invalid.",
      });
    }

    req.user = session.user; // Attach BetterAuth user metadata to request
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Forbidden access.",
    });
  }
};

// ==========================================
// 4. DATABASE CONNECTION & ROUTES
// ==========================================
async function runServer() {
  try {
    // Establish link with remote Atlas node cluster via your db.js config
    const db = await connectDB();
    const carsCollection = db.collection("cars");
    const bookingsCollection = db.collection("bookings");

    // ==========================================
    // 5. CARS ENGINE CRUD API ROUTES
    // ==========================================

    app.post("/api/cars", verifyToken, async (req, res) => {
      try {
        const carData = req.body;
        const result = await carsCollection.insertOne(carData);
        res.status(201).json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get("/api/cars", async (req, res) => {
      try {
        const { search, carType } = req.query;
        let query = {};

        if (search) {
          query.carName = { $regex: search, $options: "i" };
        }
        if (carType) {
          query.carType = carType;
        }

        const cars = await carsCollection.find(query).toArray();
        res.json({ success: true, data: cars });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get("/api/cars/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await carsCollection.findOne({ _id: new ObjectId(id) });
        if (!result)
          return res
            .status(404)
            .json({ success: false, message: "Car profile listing not found" });

        res.json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.put("/api/cars/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedFields = req.body;

        // ⚠️ CRITICAL FIX: Delete the _id property from the update body.
        // MongoDB IDs are immutable; passing it inside $set triggers a 500 Server Error.
        delete updatedFields._id;

        const result = await carsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFields },
        );

        res.json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.delete("/api/cars/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await carsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 5B. AI-POWERED NATURAL LANGUAGE SEARCH ENGINE
    // ==========================================
    import { GoogleGenAI } from "@google/generative-ai";

    // Initialize the Google Generative AI client using your server environment keys
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    app.post("/api/cars/ai-search", async (req, res) => {
      try {
        const { prompt } = req.body;

        if (!prompt || prompt.trim() === "") {
          return res
            .status(400)
            .json({
              success: false,
              message: "Prompt query parameter is empty.",
            });
        }

        // 🧠 System Prompt forcing the AI to output strictly valid MongoDB JSON query filters
        const systemInstruction = `
      You are an expert database routing agent for DriveFleet, a premium car rental platform.
      Your job is to translate a user's natural language request into a single, valid MongoDB JSON query filter object targeting the "cars" collection.

      Available Database Document Schema Fields to query:
      - carName (string, use case-insensitive $regex matching if a model/brand name is mentioned)
      - carType (string, must be exactly one of these classifications if referenced: "SUV", "Sedan", "Hatchback", "Luxury", "Electric")
      - dailyPrice (number, use operators like $lte or $gte based on budget parameters)
      - seatCapacity (number, use operators like $gte if they mention space limits)
      - pickupLocation (string, use a fuzzy regex match if a city/location is mentioned)
      - availabilityStatus (string, defaults to "Available" if they ask for things ready or open)

      CRITICAL RULE: Return ONLY a raw, unquoted JSON object. Do not include markdown wraps like \`\`\`json. Do not explain your output.
      Example Input: "Find a cheap SUV under 100 dollars"
      Example Output: {"carType": "SUV", "dailyPrice": {"$lte": 100}}
    `;

        const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const aiResult = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: `${systemInstruction}\n\nUser Prompt: "${prompt}"` },
              ],
            },
          ],
        });

        const aiTextResponse = aiResult.response.text().trim();

        // Parse the AI's string response into a functional MongoDB query filter object
        let dynamicMongoQuery = {};
        try {
          dynamicMongoQuery = JSON.parse(aiTextResponse);
        } catch (parseError) {
          console.error(
            "AI Output structure failed JSON formatting checks:",
            aiTextResponse,
          );
          // Fallback: Default to an empty query to protect client execution stability
          dynamicMongoQuery = {};
        }

        console.log(
          "⚡ AI Engine Translated Query Execution:",
          JSON.stringify(dynamicMongoQuery),
        );

        // Fetch matching listings directly from your live collection using the AI's query
        const matchedFleet = await carsCollection
          .find(dynamicMongoQuery)
          .toArray();

        res.json({
          success: true,
          queryExecuted: dynamicMongoQuery,
          count: matchedFleet.length,
          data: matchedFleet,
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 6. BOOKING TRANSACTIONAL API
    // ==========================================

    app.post("/api/bookings", verifyToken, async (req, res) => {
      try {
        const bookingData = req.body;
        const bookingResult = await bookingsCollection.insertOne(bookingData);

        await carsCollection.updateOne(
          { _id: new ObjectId(bookingData.carId) },
          { $inc: { booking_count: 1 } },
        );

        res.status(201).json({ success: true, data: bookingResult });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get("/api/my-bookings", verifyToken, async (req, res) => {
      try {
        // 🛡️ SECURE: Forces the database to search ONLY using the cryptographically verified session email
        const userEmail = req.user.email;

        const bookings = await bookingsCollection
          .find({ userEmail: userEmail })
          .toArray();
        res.json({ success: true, data: bookings });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Secure Cancellation Route (PATCH/PUT update loop)
    app.patch("/api/bookings/:id/cancel", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;

        // Update booking status to Cancelled in the database
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Cancelled",
              refundStatus: "Fully Refunded",
              cancelledAt: new Date().toISOString(),
            },
          },
        );

        if (result.modifiedCount > 0) {
          res.json({
            success: true,
            message: "Booking cancelled and refund processed.",
          });
        } else {
          res.status(404).json({
            success: false,
            message: "Booking record not found or already modified.",
          });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 7. HEALTH DIAGNOSTIC AND BASELINE
    // ==========================================
    app.get("/", (req, res) => {
      res.send("⚙️ DriveFleet API Gateway running smoothly with BetterAuth.");
    });

    // Start listening only if the database connected successfully
    app.listen(port, () => {
      console.log(`🚀 DriveFleet Operational Hub active on port: ${port}`);
    });
  } catch (err) {
    console.error("====================================================");
    console.error("❌ CRITICAL DATABASE INITIALIZATION ERROR:");
    console.error("====================================================");
    if (
      err.message.includes("ENOTFOUND") ||
      err.message.includes("EAI_AGAIN")
    ) {
      console.error(
        "👉 DNS Resolution Failed! Your server cannot reach the internet or the MongoDB host template.",
      );
      console.error(
        "👉 Check your internet connection or your local DNS settings.",
      );
    } else {
      console.error(`👉 Details: ${err.message}`);
    }
    console.error("====================================================");
    process.exit(1);
  }
}

// Fire up pipeline wrappers
runServer();
