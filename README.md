# ⚙️ DriveFleet - API Gateway (Server)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-black?style=for-the-badge&logo=JSON%20web%20tokens)
![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

The serverless API backend for **DriveFleet**, a modern peer-to-peer vehicle booking platform. This Express.js application acts as the central data gateway, handling secure authentication, database transactions, and strictly validated cross-domain API requests.

---

## 📖 Project Details

The DriveFleet API Gateway is designed with a strictly decoupled, microservice-inspired architecture. Instead of rendering HTML, this server exists solely to process data, manage the MongoDB cluster, and enforce platform security. 

It is fully optimized for **Vercel Serverless Functions**, meaning it spins up on-demand to handle requests without the overhead of maintaining a constantly running server.

**Core Responsibilities:**
* **Authentication Engine:** Mounts [Better Auth](https://better-auth.com/) to handle user registration, Google OAuth, and session management via mathematically signed JSON Web Tokens (JWT).
* **Security & CORS:** Enforces strict Cross-Origin Resource Sharing (CORS) policies, ensuring only the verified Next.js frontend can interact with the database.
* **Transactional Integrity:** Handles the logic for booking vehicles, preventing double-bookings, and updating car availability statuses.

---

## ✨ Key Features

* **Serverless-Ready:** Architected to run efficiently on Vercel's Edge/Node environments without cold-start timeouts.
* **Cross-Domain Cookie Security:** Configured to issue `SameSite=none` secure HTTP-only cookies, allowing the frontend and backend to live on entirely separate domains while maintaining airtight session security.
* **Native Session Verification:** Uses Better Auth's native session verifier as Express middleware to protect private routes (`/api/my-bookings`, `/api/cars` mutations).
* **MongoDB Native Driver:** Direct, optimized connection to MongoDB Atlas for lightning-fast CRUD operations.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB Atlas (Native `mongodb` driver)
* **Authentication:** Better Auth (Node API)
* **Security Plugins:** JWT (JSON Web Tokens), `cors`, `cookie-parser`
* **Environment Management:** `dotenv`
* **Deployment:** Vercel
