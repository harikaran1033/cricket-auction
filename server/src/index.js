const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const config = require("./config");
const connectDB = require("./config/db");
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const setupSocketHandlers = require("./socket/handler");

async function startServer() {
  // Connect to MongoDB
  await connectDB();

  const app = express();
  const server = http.createServer(app);

  // Socket.io with CORS
  const io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.clientUrl }));
  app.use(express.json());
  app.use(morgan("dev"));

  // REST Routes
  app.use("/api", routes);

  // Error handler
  app.use(errorHandler);

  // Socket handlers
  setupSocketHandlers(io);

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
