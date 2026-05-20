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

// New Security Imports for JWT + Cookies
import cookieParser from "cookie-parser";
import { createRemoteJWKSet, jwtVerify } from "jose";

// BetterAuth Imports
import { toNodeHandler } from "better-auth/node";
import { connectDB } from "./src/config/db.js";
import { auth } from "./src/config/auth.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// 1. MIDDLEWARE SETUP (CORS & Cookies)
// ==========================================
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://drivefleet-client-five.vercel.app", // ⚡ ADD THIS EXACT LINE
    ],
    credentials: true,
  }),
);

// Mount cookie parser before express.json()
app.use(cookieParser());

// ==========================================
// 2. MOUNT BETTER AUTH
// ==========================================
// ⚠️ CRITICAL: Must be placed BEFORE express.json()
app.all("/api/auth/*", toNodeHandler(auth));

// Body Parser for standard API routes
app.use(express.json());

// ==========================================
// 3. JWKS SECURE COOKIE VERIFICATION MIDDLEWARE
// ==========================================
// Automatically fetches the public cryptographic keys from your Next.js Better Auth instance
const JWKS_URI =
  process.env.JWKS_URI || `${process.env.NEXT_PUBLIC_SERVER_URL}/api/auth/jwks`;
const JWKS = createRemoteJWKSet(new URL(JWKS_URI));

const verifyJwksCookie = async (req, res, next) => {
  try {
    // ⚡ Extract the JWT directly from the secure HTTPOnly cookie
    const token = req.cookies.drivefleet_jwt;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access: Secure JWT cookie missing.",
      });
    }

    // ⚡ Verify the signature mathematically against the Better Auth public keys
    const { payload } = await jwtVerify(token, JWKS);

    // Attach verified user claims (like sub, email) to the request context
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(403).json({
      success: false,
      message: "Forbidden access: Token tampered or expired.",
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

    app.post("/api/cars", verifyJwksCookie, async (req, res) => {
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

    app.put("/api/cars/:id", verifyJwksCookie, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedFields = req.body;

        // ⚠️ CRITICAL FIX: Delete the _id property from the update body.
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

    app.delete("/api/cars/:id", verifyJwksCookie, async (req, res) => {
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
    // 6. BOOKING TRANSACTIONAL API
    // ==========================================

    app.post("/api/bookings", verifyJwksCookie, async (req, res) => {
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

    app.get("/api/my-bookings", verifyJwksCookie, async (req, res) => {
      try {
        // 🛡️ SECURE: Forces the database to search ONLY using the verified session email
        const userEmail = req.user.email;

        const bookings = await bookingsCollection
          .find({ userEmail: userEmail })
          .toArray();
        res.json({ success: true, data: bookings });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Secure Cancellation Route
    app.patch(
      "/api/bookings/:id/cancel",
      verifyJwksCookie,
      async (req, res) => {
        try {
          const id = req.params.id;

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
      },
    );

    // ==========================================
    // 7. HEALTH DIAGNOSTIC AND BASELINE
    // ==========================================
    app.get("/", (req, res) => {
      res.send(
        "⚙️ DriveFleet API Gateway running smoothly with JWKS HTTPOnly Cookie Verification.",
      );
    });

    // Start listening only if the database connected successfully
    if (process.env.NODE_ENV !== "production") {
      const port = process.env.PORT || 5000;
      app.listen(port, () => {
        console.log(`Legacy server listening on port ${port}...`);
      });
    }
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
    } else {
      console.error(`👉 Details: ${err.message}`);
    }
    console.error("====================================================");
    process.exit(1);
  }
}

// Fire up pipeline wrappers
runServer();

app.get("/", (req, res) => {
  res.send("⚙️ DriveFleet API Gateway is ALIVE on Vercel!");
});

export default app;
