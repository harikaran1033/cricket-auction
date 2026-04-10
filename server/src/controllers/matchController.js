const matchService = require("../services/matchService");

/**
 * MatchController — HTTP handlers for match simulation endpoints.
 */
class MatchController {
  /**
   * GET /match/:code/strengths
   * Returns all teams' strength breakdowns for a room.
   */
  async getAllStrengths(req, res, next) {
    try {
      const data = await matchService.getAllTeamStrengths(req.params.code);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /match/:code/team/:teamName/strength
   * Returns one team's detailed strength.
   */
  async getTeamStrength(req, res, next) {
    try {
      const data = await matchService.getTeamStrength(req.params.code, req.params.teamName);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getSeasonSimulation(req, res, next) {
    try {
      const data = await matchService.getSeasonSimulation(req.params.code);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /match/:code/xi
   * Submit Playing XI + C/VC for a team.
   * Body: { userId, playingXIPlayerIds, captainId, viceCaptainId }
   */
  async submitPlayingXI(req, res, next) {
    try {
      const { userId, playingXIPlayerIds, captainId, viceCaptainId } = req.body;
      const data = await matchService.submitPlayingXI(
        req.params.code,
        userId,
        playingXIPlayerIds,
        captainId,
        viceCaptainId
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /match/:code/simulate
   * Trigger match simulation for all confirmed teams.
   * Body: { userId }  — must be room host
   */
  async simulateMatch(req, res, next) {
    try {
      const data = await matchService.simulateMatch(req.params.code, req.body?.userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MatchController();
