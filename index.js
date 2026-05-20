// ==========================================
// 0. CUSTOM GOOGLE DNS RESOLUTION FALLBACK
// ==========================================
import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);
console.log(
  "🔒 Network Layer: DNS routing locked to Google Public DNS (8.8.8.8)",
);

import express from "express";
import cors from "cors";
import { ObjectId } from "mongodb";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { toNodeHandler } from "better-auth/node";
import { connectDB } from "./src/config/db.js";
import { auth } from "./src/config/auth.js";

dotenv.config();

const app = express();

// ==========================================
// 1. MIDDLEWARE SETUP (CORS & Cookies)
// ==========================================
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://drivefleet-client-five.vercel.app",
    ],
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

// ==========================================
// 2. MOUNT BETTER AUTH
// ==========================================
app.all("/api/auth/*", toNodeHandler(auth));

// ==========================================
// 3. LAZY-LOADED JWKS SECURE COOKIE VERIFICATION
// ==========================================
// Safe from cold-start crashes because it executes only when a request arrives
let JWKS = null;
const getJWKS = () => {
  if (!JWKS) {
    const JWKS_URI =
      process.env.JWKS_URI ||
      `${process.env.NEXT_PUBLIC_SERVER_URL || process.env.VERCEL_URL || "https://drivefleet-server-3fq1b6d6z-md-royets-projects.vercel.app"}/api/auth/jwks`;

    // Fallback block if environment variables are missing
    if (!JWKS_URI || JWKS_URI.includes("undefined")) {
      throw new Error(
        "Missing critical environment configuration: JWKS_URI or server URL variables.",
      );
    }

    JWKS = createRemoteJWKSet(new URL(JWKS_URI));
  }
  return JWKS;
};

const verifyJwksCookie = async (req, res, next) => {
  try {
    const token = req.cookies.drivefleet_jwt;
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access: Secure JWT cookie missing.",
      });
    }

    const jwksSet = getJWKS();
    const { payload } = await jwtVerify(token, jwksSet);
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(403).json({
      success: false,
      message:
        "Forbidden access: Token configuration issue, tampered or expired.",
    });
  }
};

// ==========================================
// 4. DATABASE COLLECTION REFERENCES
// ==========================================
let db, carsCollection, bookingsCollection;
const getCollection = async (collectionName) => {
  if (!db) {
    db = await connectDB();
    carsCollection = db.collection("cars");
    bookingsCollection = db.collection("bookings");
  }
  return db.collection(collectionName);
};

// ==========================================
// 5. CARS ENGINE CRUD API ROUTES
// ==========================================
app.post("/api/cars", verifyJwksCookie, async (req, res) => {
  try {
    const cars = await getCollection("cars");
    const result = await cars.insertOne(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/cars", async (req, res) => {
  try {
    const { search, carType } = req.query;
    let query = {};
    if (search) query.carName = { $regex: search, $options: "i" };
    if (carType) query.carType = carType;

    const cars = await getCollection("cars");
    const result = await cars.find(query).toArray();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/cars/:id", async (req, res) => {
  try {
    const cars = await getCollection("cars");
    const result = await cars.findOne({ _id: new ObjectId(req.params.id) });
    if (!result)
      return res
        .status(404)
        .json({ success: false, message: "Car profile not found" });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put("/api/cars/:id", verifyJwksCookie, async (req, res) => {
  try {
    const updatedFields = req.body;
    delete updatedFields._id;
    const cars = await getCollection("cars");
    const result = await cars.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updatedFields },
    );
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/cars/:id", verifyJwksCookie, async (req, res) => {
  try {
    const cars = await getCollection("cars");
    const result = await cars.deleteOne({ _id: new ObjectId(req.params.id) });
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
    const bookings = await getCollection("bookings");
    const cars = await getCollection("cars");

    const bookingResult = await bookings.insertOne(bookingData);
    await cars.updateOne(
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
    const bookings = await getCollection("bookings");
    const result = await bookings.find({ userEmail: req.user.email }).toArray();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch("/api/bookings/:id/cancel", verifyJwksCookie, async (req, res) => {
  try {
    const bookings = await getCollection("bookings");
    const result = await bookings.updateOne(
      { _id: new ObjectId(req.params.id) },
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
      res
        .status(404)
        .json({
          success: false,
          message: "Booking not found or already modified.",
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
  res.send("⚙️ DriveFleet API Gateway is ALIVE and SECURE on Vercel!");
});

// Production environment listener bypass
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 5000;
  app.listen(port, () =>
    console.log(`Legacy server listening on port ${port}...`),
  );
}

export default app;
