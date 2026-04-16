const { Room, League, Player, LeaguePlayer, ActivityLog } = require("../models");

/**
 * RetentionService — handles player retention logic.
 * Validates retention rules, deducts purse, updates squads.
 */
class RetentionService {
  _normalizeTeamName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  _buildTeamAliasLookup(teams = []) {
    const lookup = new Map();
    for (const t of teams) {
      const full = String(t?.name || "").trim();
      const short = String(t?.shortName || "").trim();
      if (!full) continue;
      lookup.set(this._normalizeTeamName(full), full);
      if (short) lookup.set(this._normalizeTeamName(short), full);
    }
    return lookup;
  }

  _resolveCanonicalTeamName(name, teamLookup) {
    if (!name) return "";
    const normalized = this._normalizeTeamName(name);
    const LEGACY_TEAM_ALIASES = {
      "royal challengers bangalore": "Royal Challengers Bengaluru",
      "kings xi punjab": "Punjab Kings",
      "delhi daredevils": "Delhi Capitals",
    };
    return teamLookup.get(normalized) || LEGACY_TEAM_ALIASES[normalized] || String(name).trim();
  }

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

    const teamLookup = this._buildTeamAliasLookup(room?.league?.teams || []);

    // Group by previousTeam (normalized to league full names when possible)
    const grouped = {};
    for (const lp of leaguePlayers) {
      const team = lp.previousTeam
        ? this._resolveCanonicalTeamName(lp.previousTeam, teamLookup)
        : "Uncapped";
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
    const teamLookup = this._buildTeamAliasLookup(league?.teams || []);
    const canonicalPreviousTeam = this._resolveCanonicalTeamName(leaguePlayer.previousTeam, teamLookup);
    if (canonicalPreviousTeam && canonicalPreviousTeam !== team.teamName) {
      throw new Error(`${leaguePlayer.player.name} was not in ${team.teamName}`);
    }

    // Check if already retained by someone
    const alreadyRetained = room.joinedTeams.some((t) =>
      t.retentions.some(
        (r) => r.player.toString() === leaguePlayer.player._id.toString()
      )
    );
    if (alreadyRetained) throw new Error("Player already retained");

    // Retention cost = player's previous franchise price
    const cost = leaguePlayer.franchisePrice;
    if (!cost || cost <= 0) {
      throw new Error(`${leaguePlayer.player.name} has no franchise price set for retention`);
    }
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
