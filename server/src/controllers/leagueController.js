const leagueService = require("../services/leagueService");
const playerService = require("../services/playerService");

class LeagueController {
  async getAllLeagues(req, res, next) {
    try {
      const leagues = await leagueService.getAllLeagues();
      res.json({ success: true, data: leagues });
    } catch (err) {
      next(err);
    }
  }

  async getLeagueById(req, res, next) {
    try {
      const league = await leagueService.getLeagueById(req.params.id);
      if (!league) return res.status(404).json({ success: false, error: "League not found" });
      res.json({ success: true, data: league });
    } catch (err) {
      next(err);
    }
  }

  async getPlayersByLeague(req, res, next) {
    try {
      const players = await playerService.getPlayersByLeague(req.params.id);
      res.json({ success: true, data: players });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new LeagueController();
