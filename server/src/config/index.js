require("dotenv").config();

module.exports = {
  port: process.env.PORT || 4000,
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/cricket-auction",
  nodeEnv: process.env.NODE_ENV || "development",
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",

  // Auction engine defaults
  auction: {
    defaultTimerSec: 15, // seconds per bid round
    minBidIncrement: 25, // in lakhs
    maxTimerExtensions: 3,
    nominationTimerSec: 30, // time for host to nominate
  },

  // Retention rules per league
  retention: {
    IPL: {
      maxRetentions: 6,
      maxCappedRetentions: 5,
      maxUnCappedRetentions: 2,
      slots: [
        { slot: 1, cost: 1800, type: "capped" },
        { slot: 2, cost: 1400, type: "capped" },
        { slot: 3, cost: 1100, type: "capped" },
        { slot: 4, cost: 1800, type: "uncapped" },
        { slot: 5, cost: 1400, type: "uncapped" },
        { slot: 6, cost: 400, type: "capped" },
      ],
    },
  },
};
