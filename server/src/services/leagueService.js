const { League } = require("../models");

/**
 * LeagueService — CRUD for leagues.
 */
class LeagueService {
  async getAllLeagues() {
    return League.find().select("name code totalTeams purse teams").lean();
  }

  async getLeagueById(id) {
    return League.findById(id).lean();
  }

  async getLeagueByCode(code) {
    return League.findOne({ code: code.toUpperCase() }).lean();
  }
}

module.exports = new LeagueService();
