const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const config = require("./config");
const connectDB = require("./config/db");
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const setupSocketHandlers = require("./socket/handler");
const roomService = require("./services/roomService");

async function startServer() {
  // Connect to MongoDB
  await connectDB();

  const app = express();
  const server = http.createServer(app);

  const clientBuildPath = path.join(__dirname, "..", "..", "client", "dist");
  const hasClientBuild = fs.existsSync(clientBuildPath);
  const normalizeOrigin = (value = "") => String(value).trim().replace(/\/+$/, "");
  const allowedOrigins = (config.clientUrls || []).map(normalizeOrigin).filter(Boolean);
  const allowAllOrigins = allowedOrigins.includes("*");
  const corsOrigin = (origin, callback) => {
    // Allow non-browser clients and same-origin/server-side calls with no Origin header.
    if (!origin) return callback(null, true);
    const normalizedOrigin = normalizeOrigin(origin);
    if (allowAllOrigins) return callback(null, true);
    if (allowedOrigins.includes(normalizedOrigin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`), false);
  };

  // Socket.io with CORS
  const io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // Connection state recovery: replays missed events when a client reconnects
    // (Socket.IO 4.6+). Critical for multi-user resilience.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  // Optional Redis adapter for horizontal scaling (multiple server instances).
  // Set REDIS_URL env var to enable.  Without it, single-instance mode is used.
  if (process.env.REDIS_URL) {
    try {
      const { createClient } = require("redis");
      const { createAdapter } = require("@socket.io/redis-adapter");
      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log("[Socket.IO] Redis adapter enabled — multi-instance mode");
    } catch (e) {
      console.warn("[Socket.IO] Redis adapter unavailable, running single-instance:", e.message);
    }
  }

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json());
  app.use(morgan("dev"));

  // Serve built client if present
  if (hasClientBuild) {
    app.use(express.static(clientBuildPath));
  }

  // REST Routes
  app.use("/api", routes);

  // SPA fallback (only if build exists)
  if (hasClientBuild) {
    app.get("*", (req, res) => {
      res.sendFile(path.join(clientBuildPath, "index.html"));
    });
  }

  // Error handler
  app.use(errorHandler);

  // Socket handlers
  setupSocketHandlers(io);

  const cleanupInterval = setInterval(async () => {
    try {
      const deleted = await roomService.cleanupInactiveRooms();
      if (deleted > 0) {
        console.log(`[RoomService] Cleaned up ${deleted} inactive room(s)`);
      }
    } catch (err) {
      console.error("[RoomService] Cleanup failed:", err.message);
    }
  }, 60 * 1000);

  // ── Graceful shutdown ─────────────────────────────────────────────
  // Handles SIGTERM (Docker/K8s stop) and SIGINT (Ctrl-C in dev).
  // Closes the HTTP server first so no new connections are accepted,
  // then stops background timers, then exits cleanly.
  function gracefulShutdown(signal) {
    console.log(`\n[Server] ${signal} received — shutting down gracefully…`);
    clearInterval(cleanupInterval);

    server.close((err) => {
      if (err) {
        console.error("[Server] Error while closing HTTP server:", err.message);
        process.exit(1);
      }
      console.log("[Server] HTTP server closed. Goodbye!");
      process.exit(0);
    });

    // Force exit if close takes too long (10 s)
    setTimeout(() => {
      console.error("[Server] Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

  // Start
  server.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════╗
║  🏏 Cricket Auction Server              ║
║  Port: ${config.port}                            ║
║  Env:  ${config.nodeEnv}                    ║
║  DB:   Connected                         ║
╚══════════════════════════════════════════╝
    `);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
