const express = require("express");
const router = express.Router();
const leagueController = require("../controllers/leagueController");

router.get("/", leagueController.getAllLeagues);
router.get("/:id", leagueController.getLeagueById);
router.get("/:id/players", leagueController.getPlayersByLeague);

module.exports = router;
