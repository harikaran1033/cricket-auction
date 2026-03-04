const { Player, LeaguePlayer } = require("../models");

/**
 * PlayerService — player queries.
 */
class PlayerService {
  async getPlayersByLeague(leagueId) {
    return LeaguePlayer.find({ league: leagueId })
      .populate("player")
      .lean();
  }

  async getPlayerById(playerId) {
    return Player.findById(playerId).lean();
  }

  async searchPlayers(query) {
    return Player.find({
      name: { $regex: query, $options: "i" },
    })
      .limit(20)
      .lean();
  }
}

module.exports = new PlayerService();
