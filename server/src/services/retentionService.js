const { Room, League, Player, LeaguePlayer, ActivityLog } = require("../models");

/**
 * RetentionService — handles player retention logic.
 * Validates retention rules, deducts purse, updates squads.
 */
class RetentionService {
  /**
   * Get retention config for a room.
   */
  async getRetentionConfig(roomCode) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    if (!room.retentionEnabled) throw new Error("Retention is not enabled for this room");

    return {
      slots: room.league.retention?.slots || [],
      maxRetentions: room.league.retention?.maxRetentions || 0,
      purse: room.league.purse,
    };
  }

  /**
   * Get players available for retention (league players grouped by previous team).
   */
  async getRetentionPlayers(roomCode) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const leaguePlayers = await LeaguePlayer.find({ league: room.league._id })
      .populate("player")
      .lean();

    // Group by previousTeam
    const grouped = {};
    for (const lp of leaguePlayers) {
      const team = lp.previousTeam || "Uncapped";
      if (!grouped[team]) grouped[team] = [];
      grouped[team].push({
        _id: lp._id,
        playerId: lp.player._id,
        name: lp.player.name,
        nationality: lp.player.nationality,
        isOverseas: lp.player.isOverseas,
        role: lp.player.role,
        basePrice: lp.basePrice,
        franchisePrice: lp.franchisePrice || 0,
        skills: lp.player.skills || [],
        stats: lp.stats,
        image: lp.player.image,
        previousTeam: lp.previousTeam,
      });
    }

    return grouped;
  }

  /**
   * Retain a player for a team.
   * Validates slot rules, overseas limits, purse deductions.
   */
  async retainPlayer({ roomCode, userId, leaguePlayerId, slotNumber }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    if (!room.retentionEnabled) throw new Error("Retention not enabled");

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (!team) throw new Error("Team not found in room");

    const league = room.league;
    const retentionSlots = league.retention?.slots || [];
    const maxRetentions = league.retention?.maxRetentions || 0;

    if (team.retentions.length >= maxRetentions) {
      throw new Error(`Maximum ${maxRetentions} retentions allowed`);
    }

    // Get slot config
    const slot = retentionSlots.find((s) => s.slot === slotNumber);
    if (!slot) throw new Error(`Invalid retention slot: ${slotNumber}`);

    // Check if slot already used
    if (team.retentions.length >= slotNumber) {
      throw new Error(`Slot ${slotNumber} already used`);
    }

    // Get league player
    const leaguePlayer = await LeaguePlayer.findById(leaguePlayerId).populate("player");
    if (!leaguePlayer) throw new Error("Player not found");

    // Validate previous team matches
    if (leaguePlayer.previousTeam && leaguePlayer.previousTeam !== team.teamName) {
      throw new Error(`${leaguePlayer.player.name} was not in ${team.teamName}`);
    }

    // Check if already retained by someone
    const alreadyRetained = room.joinedTeams.some((t) =>
      t.retentions.some(
        (r) => r.player.toString() === leaguePlayer.player._id.toString()
      )
    );
    if (alreadyRetained) throw new Error("Player already retained");

    // Use franchise price if available, otherwise fall back to slot cost
    const cost = leaguePlayer.franchisePrice || slot.cost;
    if (team.remainingPurse < cost) {
      throw new Error("Insufficient purse for this retention");
    }

    // Check overseas limit
    if (leaguePlayer.player.isOverseas) {
      const overseasCount = team.retentions.filter((r) => r.isOverseas).length;
      if (overseasCount >= 2) {
        throw new Error("Maximum 2 overseas retentions allowed");
      }
    }

    // Apply retention
    const retention = {
      player: leaguePlayer.player._id,
      leaguePlayer: leaguePlayer._id,
      acquiredFrom: "retention",
      price: cost,
      isOverseas: leaguePlayer.player.isOverseas,
    };

    team.retentions.push(retention);
    team.squad.push(retention);
    team.remainingPurse -= cost;

    await room.save();

    // Activity log
    await ActivityLog.create({
      room: room._id,
      type: "RETENTION_MADE",
      payload: {
        playerName: leaguePlayer.player.name,
        teamName: team.teamName,
        slot: slotNumber,
        cost,
      },
      userId,
      userName: team.userName,
    });

    return {
      room,
      retainedPlayer: {
        ...retention,
        playerName: leaguePlayer.player.name,
        nationality: leaguePlayer.player.nationality,
        role: leaguePlayer.player.role,
      },
    };
  }

  /**
   * Remove a retention.
   */
  async removeRetention({ roomCode, userId, playerId }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (!team) throw new Error("Team not found in room");

    const retentionIdx = team.retentions.findIndex(
      (r) => r.player.toString() === playerId
    );
    if (retentionIdx === -1) throw new Error("Retention not found");

    const retention = team.retentions[retentionIdx];
    team.remainingPurse += retention.price;
    team.retentions.splice(retentionIdx, 1);

    // Remove from squad too
    const squadIdx = team.squad.findIndex(
      (s) => s.player.toString() === playerId && s.acquiredFrom === "retention"
    );
    if (squadIdx !== -1) team.squad.splice(squadIdx, 1);

    await room.save();
    return room;
  }

  /**
   * Confirm retentions and move to lobby.
   */
  async confirmRetentions(roomCode, userId) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (!team) throw new Error("Team not found");

    team.isReady = true;
    await room.save();

    // Check if all teams confirmed
    const allReady = room.joinedTeams.every((t) => t.isReady);
    return { room, allReady };
  }
}

module.exports = new RetentionService();
