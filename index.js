const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// 0. CUSTOM GOOGLE DNS RESOLUTION FALLBACK
// ==========================================
const dns = require("dns");
// Explicitly forces the Node runtime to resolve network hosts via Google Public DNS
dns.setServers(["8.8.8.8", "8.8.4.4"]);
console.log(
  "🔒 Network Layer: DNS routing locked to Google Public DNS (8.8.8.8)",
);

// ==========================================
// 1. MIDDLEWARE SETUP
// ==========================================
app.use(
  cors({
    origin: ["http://localhost:3000"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// Custom Security Middleware: Token Verification
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized access: Token missing." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: "Forbidden access: Invalid or expired token.",
    });
  }
};

// ==========================================
// 2. MONGODB CONNECTION INSTANTIATION
// ==========================================
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // DNS & Network Optimization: Fail fast (5 seconds) instead of hanging indefinitely if DNS fails
  serverSelectionTimeoutMS: 5000,
});

async function runServer() {
  try {
    // Establish link with remote Atlas node cluster
    await client.connect();
    console.log("📌 Successfully connected to MongoDB Cluster (driveFleetDB)!");

    const db = client.db("driveFleetDB");
    const carsCollection = db.collection("cars");
    const bookingsCollection = db.collection("bookings");

    // ==========================================
    // 3. AUTHENTICATION & JWT API ROUTES
    // ==========================================

    app.post("/api/auth/jwt", async (req, res) => {
      try {
        const user = req.body;
        const token = jwt.sign(user, process.env.JWT_SECRET, {
          expiresIn: "7d",
        });

        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          })
          .json({
            success: true,
            message: "Secure authorization cookie established.",
          });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.post("/api/auth/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
          })
          .json({
            success: true,
            message: "Logged out and cookie cleared successfully.",
          });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 4. CARS ENGINE CRUD API ROUTES
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
    // 5. BOOKING TRANSACTIONAL API ROUTES
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
        const userEmail = req.query.email;
        if (!userEmail)
          return res.status(400).json({
            success: false,
            message: "Missing email parameter query.",
          });

        const bookings = await bookingsCollection
          .find({ userEmail: userEmail })
          .toArray();
        res.json({ success: true, data: bookings });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ==========================================
    // 6. HEALTH DIAGNOSTIC AND BASELINE ENTRY
    // ==========================================
    app.get("/", (req, res) => {
      res.send("⚙️ DriveFleet API Gateway running smoothly.");
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
    process.exit(1); // Kill the server process cleanly because it cannot run without a database
  }
}

// Fire up pipeline wrappers
runServer();
