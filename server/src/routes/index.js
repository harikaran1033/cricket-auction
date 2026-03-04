const express = require("express");
const router = express.Router();
const roomRoutes = require("./roomRoutes");
const leagueRoutes = require("./leagueRoutes");

router.use("/rooms", roomRoutes);
router.use("/leagues", leagueRoutes);

// Health check
router.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

module.exports = router;
