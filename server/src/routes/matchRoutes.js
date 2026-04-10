const { Router } = require("express");
const matchController = require("../controllers/matchController");

const router = Router();

// GET  /api/match/:code/strengths      — all teams' strength summary
router.get("/:code/strengths", matchController.getAllStrengths.bind(matchController));

// GET  /api/match/:code/team/:teamName/strength
router.get("/:code/team/:teamName/strength", matchController.getTeamStrength.bind(matchController));

// GET /api/match/:code/season       — latest stored league simulation
router.get("/:code/season", matchController.getSeasonSimulation.bind(matchController));

// POST /api/match/:code/xi             — submit Playing XI
router.post("/:code/xi", matchController.submitPlayingXI.bind(matchController));

// POST /api/match/:code/simulate       — trigger match simulation
router.post("/:code/simulate", matchController.simulateMatch.bind(matchController));

module.exports = router;
