/**
 * matchService.js — Business logic for match simulation.
 *
 * Responsibilities:
 *  - submitPlayingXI   : validate and store the Playing XI + C/VC for a team
 *  - simulateMatch     : run full point simulation for all teams in a room
 *  - getTeamStrength   : on-demand strength calculation for a team
 *  - buildRatings      : pre-compute player profiles for all squad entries
 */

const { AuctionState, Room, LeaguePlayer } = require("../models");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { dataDir, getDataPath, getScriptPath } = require("../store");
const {
  buildSquadProfiles,
  selectBestXI,
  validateTeam,
  validatePlayingXI,
  calculateTeamStrength,
  simulatePlayerPoints,
  applyFatigue,
  rollInjury,
  buildPlayerProfile,
  getOverseasLimit,
} = require("../utils/matchEngine");

const execFileAsync = promisify(execFile);

const TEAM_VENUE_MAP = {
  "Chennai Super Kings": "MA Chidambaram Stadium, Chennai",
  "Mumbai Indians": "Wankhede Stadium, Mumbai",
  "Royal Challengers Bengaluru": "M Chinnaswamy Stadium, Bengaluru",
  "Royal Challengers Bangalore": "M Chinnaswamy Stadium, Bengaluru",
  "Kolkata Knight Riders": "Eden Gardens, Kolkata",
  "Sunrisers Hyderabad": "Rajiv Gandhi International Stadium, Hyderabad",
  "Rajasthan Royals": "Sawai Mansingh Stadium, Jaipur",
  "Delhi Capitals": "Arun Jaitley Stadium, Delhi",
  "Punjab Kings": "Punjab Cricket Association IS Bindra Stadium, Mohali",
  "Lucknow Super Giants": "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium, Lucknow",
  "Gujarat Titans": "Narendra Modi Stadium, Ahmedabad",
};

class MatchService {
  _pythonCandidates() {
    const envBin = String(process.env.PYTHON_BIN || process.env.PYTHON_PATH || "").trim();
    const defaults = [
      "python3",
      "python",
      "python3.12",
      "python3.11",
      "python3.10",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
    ];
    return [...new Set([envBin, ...defaults].filter(Boolean))];
  }

  _isMissingBinaryError(err) {
    return err?.code === "ENOENT" || err?.errno === "ENOENT";
  }

  _formatPythonMissingError(candidates = []) {
    const envHint = process.env.PYTHON_BIN || process.env.PYTHON_PATH
      ? `Configured python binary "${process.env.PYTHON_BIN || process.env.PYTHON_PATH}" was not found. `
      : "";
    const triedHint = candidates.length
      ? `Checked: ${candidates.join(", ")}. `
      : "";
    return new Error(
      `${envHint}${triedHint}Python runtime is unavailable in this environment. ` +
      `Install Python 3 on the server image, or set PYTHON_BIN to a valid executable path (for example: /usr/bin/python3).`
    );
  }

  async _execPython(args) {
    const candidates = this._pythonCandidates();
    let lastErr = null;

    for (const bin of candidates) {
      try {
        return await execFileAsync(bin, args, {
          cwd: dataDir,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (err) {
        if (this._isMissingBinaryError(err)) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    if (lastErr) throw this._formatPythonMissingError(candidates);
    throw new Error("Failed to launch Python simulation process");
  }

  /**
   * buildRatingsForTeam — enrich a squad with computed ratingData.
   * Accepts raw squad entries where .player and .leaguePlayer may be populated.
   */
  _enrichSquad(squadEntries) {
    return buildSquadProfiles(squadEntries);
  }

  _playerId(entry) {
    return entry?.player?._id?.toString() || entry?.player?.toString() || null;
  }

  _teamVenue(team = {}) {
    return (
      TEAM_VENUE_MAP[team.teamName] ||
      TEAM_VENUE_MAP[team.name] ||
      "Dubai International Cricket Stadium"
    );
  }

  _playerName(entry) {
    return entry?.player?.name || entry?.name || null;
  }

  _getMatchData(auctionState, teamName) {
    if (!auctionState?.teamMatchData) return {};
    if (typeof auctionState.teamMatchData.get === "function") {
      return auctionState.teamMatchData.get(teamName) || {};
    }
    return auctionState.teamMatchData?.[teamName] || {};
  }

  _isBowlingOption(entry = {}) {
    const role = String(entry?.player?.role || entry?.role || "").toLowerCase();
    const skills = (entry?.player?.skills || entry?.skills || []).map((skill) =>
      String(skill).toLowerCase().replace(/\s+/g, "_")
    );
    const bowlingStyle = String(entry?.player?.bowlingStyle || entry?.bowlingStyle || "").toLowerCase();
    return (
      role.includes("bowler") ||
      role.includes("all-rounder") ||
      skills.some((skill) => skill.includes("bowler") || skill.includes("spin")) ||
      bowlingStyle.includes("fast") ||
      bowlingStyle.includes("medium") ||
      bowlingStyle.includes("spin")
    );
  }

  _chooseBowlers(xiEntries = []) {
    const bowlingOptions = xiEntries.filter((entry) => this._isBowlingOption(entry));
    const sorted = [...bowlingOptions].sort((a, b) => {
      const aScore = Number(a?.ratingData?.bowlingScore || 0) + Number(a?.ratingData?.overallRating || 0) * 0.15;
      const bScore = Number(b?.ratingData?.bowlingScore || 0) + Number(b?.ratingData?.overallRating || 0) * 0.15;
      return bScore - aScore;
    });
    const chosen = [];
    for (const entry of sorted) {
      const name = this._playerName(entry);
      if (!name || chosen.includes(name)) continue;
      chosen.push(name);
      if (chosen.length >= 6) break;
    }
    if (chosen.length < 5) {
      for (const entry of xiEntries) {
        const name = this._playerName(entry);
        if (!name || chosen.includes(name)) continue;
        chosen.push(name);
        if (chosen.length >= 5) break;
      }
    }
    return chosen;
  }

  _buildLeagueTeamsPayload(room, auctionState) {
    const teams = room.joinedTeams || [];
    if (teams.length < 2) {
      throw new Error("League simulation requires at least 2 teams");
    }

    const payloadTeams = teams.map((team) => {
      const matchData = this._getMatchData(auctionState, team.teamName);
      const savedXIIds = Array.isArray(matchData.playingXI)
        ? matchData.playingXI.map((id) => id?.toString()).filter(Boolean)
        : [];
      if (!matchData.xiConfirmed) {
        throw new Error(`${team.teamName} has not confirmed their Playing XI yet`);
      }
      if (savedXIIds.length !== 11) {
        throw new Error(`${team.teamName} must submit a full Playing XI before league simulation`);
      }

      const enriched = this._enrichSquad(team.squad);
      const xiEntries = savedXIIds
        .map((playerId) => enriched.find((entry) => this._playerId(entry) === playerId))
        .filter(Boolean);

      if (xiEntries.length !== 11) {
        throw new Error(`Could not resolve saved Playing XI for ${team.teamName}`);
      }

      const playing11 = xiEntries.map((entry) => this._playerName(entry)).filter(Boolean);
      const bowlers = this._chooseBowlers(xiEntries);

      return {
        name: team.teamName,
        venue: this._teamVenue(team),
        playing11,
        batting_order: [...playing11],
        bowlers,
      };
    });

    return { teams: payloadTeams };
  }

  async _runPythonLeagueSimulation(leagueTeamsPayload, seed = null) {
    const tempFile = path.join(os.tmpdir(), `league_teams_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    await fs.writeFile(tempFile, JSON.stringify(leagueTeamsPayload, null, 2), "utf8");

    try {
      const args = [
        getScriptPath("simulate_league.py"),
        "--player-data",
        getDataPath("ipl_player_analytics.json"),
        "--matchup-data",
        getDataPath("ipl_player_matchups.json"),
        "--players",
        getDataPath("players.json"),
        "--ground-history",
        getDataPath("ipl_ground_history.json"),
        "--league-teams",
        tempFile,
      ];
      if (Number.isInteger(seed)) {
        args.push("--seed", String(seed));
      }

      const { stdout, stderr } = await this._execPython(args);

      if (stderr && stderr.trim()) {
        console.warn("[matchService] Python simulator stderr:", stderr.trim());
      }

      return JSON.parse(stdout);
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  /**
   * getTeamStrength — compute team strength for a single team.
   * Used by the frontend to display live strength during auction.
   *
   * @param {string} roomCode
   * @param {string} teamName
   * @returns {object} strengthBreakdown
   */
  async getTeamStrength(roomCode, teamName) {
    const room = await Room.findOne({ roomCode })
      .populate({
        path: "joinedTeams",
        populate: { path: "squad.player squad.leaguePlayer" },
      })
      .lean();
    if (!room) throw new Error("Room not found");

    const team = room.joinedTeams.find((t) => t.teamName === teamName);
    if (!team) throw new Error("Team not found");

    const enriched = this._enrichSquad(team.squad);
    const validation = validateTeam(enriched);
    const state = await AuctionState.findOne({ room: room._id }).lean();
    const matchData = this._getMatchData(state, teamName);
    const fatigueMap = matchData.fatigueMap
      ? Object.fromEntries(Object.entries(matchData.fatigueMap))
      : {};
    const savedXIIds = Array.isArray(matchData.playingXI)
      ? matchData.playingXI.map((id) => id?.toString()).filter(Boolean)
      : [];
    const savedXIEntries = savedXIIds
      .map((id) => enriched.find((entry) => this._playerId(entry) === id))
      .filter(Boolean);
    const playingXI = savedXIEntries.length === 11 ? savedXIEntries : selectBestXI(enriched);

    const strength = calculateTeamStrength({
      squadEntries: enriched,
      playingXI,
      captainId: matchData.captainId || null,
      viceCaptainId: matchData.viceCaptainId || null,
      playersPerTeam: room.playersPerTeam || 25,
      fatigueMap,
    });

    const playerProfiles = enriched.map((e) => ({
      playerId: this._playerId(e),
      name: e?.player?.name,
      role: e?.player?.role,
      nationality: e?.player?.nationality,
      isOverseas: Boolean(e?.player?.isOverseas || e?.isOverseas),
      skills: e?.player?.skills || [],
      overallRating: e.ratingData?.overallRating,
      fairPoint: e.ratingData?.fairPoint || 0,
      consistency: e.ratingData?.consistency,
      fairPlayScore: e.ratingData?.fairPlayScore,
      valueLabel: e.ratingData?.valueLabel,
      hasRealStats: e.ratingData?.stats?.hasRealStats,
      price: e?.price || 0,
      context: e.ratingData?.context || null,
    }));

    return {
      teamName,
      squad: playerProfiles,
      playerProfiles,
      savedPlayingXI: savedXIIds,
      savedCaptainId: matchData.captainId || null,
      savedViceCaptainId: matchData.viceCaptainId || null,
      xiConfirmed: Boolean(matchData.xiConfirmed),
      ...strength,
      validation,
    };
  }

  /**
   * submitPlayingXI — validate and persist Playing XI + C/VC selections.
   *
   * Rules:
   *  - Exactly 11 player ids must be provided
   *  - All must be in the team's squad
   *  - Captain and VC must be in the XI
   *  - Both C and VC must be different
   *
   * @param {string}   roomCode
   * @param {string}   userId
   * @param {string[]} playingXIPlayerIds   — 11 Player ObjectId strings
   * @param {string}   captainId
   * @param {string}   viceCaptainId
   * @returns {{ success, teamStrength, breakdown }}
   */
  async submitPlayingXI(roomCode, userId, playingXIPlayerIds, captainId, viceCaptainId) {
    if (!Array.isArray(playingXIPlayerIds) || playingXIPlayerIds.length !== 11) {
      throw new Error("Exactly 11 players must be selected for the Playing XI");
    }
    if (new Set(playingXIPlayerIds).size !== 11) {
      throw new Error("Playing XI cannot contain duplicate players");
    }
    if (!captainId || !viceCaptainId) {
      throw new Error("Captain and Vice-Captain must be selected");
    }
    if (captainId === viceCaptainId) {
      throw new Error("Captain and Vice-Captain must be different players");
    }
    if (!playingXIPlayerIds.includes(captainId)) {
      throw new Error("Captain must be in the Playing XI");
    }
    if (!playingXIPlayerIds.includes(viceCaptainId)) {
      throw new Error("Vice-Captain must be in the Playing XI");
    }

    const room = await Room.findOne({ roomCode }).populate({
      path: "joinedTeams.squad.player joinedTeams.squad.leaguePlayer",
    });
    if (!room) throw new Error("Room not found");

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (!team) throw new Error("Team not found for this user");

    // Validate all selected ids are in the squad
    const squadPlayerIds = new Set(
      team.squad.map((e) => e?.player?._id?.toString() || e?.player?.toString())
    );
    for (const pid of playingXIPlayerIds) {
      if (!squadPlayerIds.has(pid)) {
        throw new Error(`Player ${pid} is not in your squad`);
      }
    }

    // Enrich squad for strength calculation
    const enriched = this._enrichSquad(team.squad);
    const xiEntries = enriched.filter((e) => {
      const pid = this._playerId(e);
      return playingXIPlayerIds.includes(pid);
    });
    const xiEntriesOrdered = playingXIPlayerIds
      .map((pid) => xiEntries.find((entry) => this._playerId(entry) === pid))
      .filter(Boolean);

    if (xiEntriesOrdered.length !== 11) {
      throw new Error("Unable to build the ordered Playing XI");
    }

    const xiValidation = validatePlayingXI(xiEntriesOrdered, room.playersPerTeam || 25);
    const hardBlocker = xiValidation.penalties.find((penalty) => penalty.type === "TOO_MANY_OVERSEAS_XI");
    if (hardBlocker) {
      throw new Error(hardBlocker.message);
    }

    // Load or init match state
    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction state not found");

    const existingMatchData = auctionState.teamMatchData?.get(team.teamName) || {};
    const fatigueMap = existingMatchData.fatigueMap
      ? Object.fromEntries(Object.entries(existingMatchData.fatigueMap))
      : {};

    const strength = calculateTeamStrength({
      squadEntries: enriched,
      playingXI: xiEntriesOrdered,
      captainId,
      viceCaptainId,
      playersPerTeam: room.playersPerTeam || 25,
      fatigueMap,
    });

    // Persist
    const updated = {
      ...existingMatchData,
      playingXI: playingXIPlayerIds,
      captainId,
      viceCaptainId,
      teamStrength: strength.total,
      strengthBreakdown: strength,
      fatigueMap: new Map(Object.entries(fatigueMap)),
      injuredIds: existingMatchData.injuredIds || [],
      matchesPlayed: existingMatchData.matchesPlayed || 0,
      xiConfirmed: true,
    };

    if (!auctionState.teamMatchData) {
      auctionState.teamMatchData = new Map();
    }
    auctionState.teamMatchData.set(team.teamName, updated);
    auctionState.markModified("teamMatchData");
    await auctionState.save();

    return {
      success: true,
      teamName: team.teamName,
      teamStrength: strength.total,
      xiConfirmed: true,
      playingXI: playingXIPlayerIds,
      breakdown: strength,
    };
  }

  /**
   * simulateMatch — run the Python-backed full league simulator.
   * Uses each team's saved Playing XI from auction/match setup and returns
   * season standings, playoffs, awards, and a lightweight leaderboard summary.
   */
  async simulateMatch(roomCode, userId = null) {
    const room = await Room.findOne({ roomCode }).populate({
      path: "joinedTeams.squad.player joinedTeams.squad.leaguePlayer",
    });
    if (!room) throw new Error("Room not found");
    if (room.status !== "completed") throw new Error("Auction must be completed before simulating");
    if (userId && room.host?.userId !== userId) {
      throw new Error("Only the host can simulate the league");
    }

    const auctionState = await AuctionState.findOne({ room: room._id });
    if (!auctionState) throw new Error("Auction state not found");
    if (auctionState.seasonSimulation?.output) {
      throw new Error("League simulation has already been completed for this room");
    }
    const unconfirmedTeams = (room.joinedTeams || [])
      .filter((team) => {
        const matchData = this._getMatchData(auctionState, team.teamName);
        const savedXIIds = Array.isArray(matchData.playingXI)
          ? matchData.playingXI.map((id) => id?.toString()).filter(Boolean)
          : [];
        return !matchData.xiConfirmed || savedXIIds.length !== 11;
      })
      .map((team) => team.teamName);
    if (unconfirmedTeams.length > 0) {
      throw new Error(`Waiting for Playing XI confirmation from: ${unconfirmedTeams.join(", ")}`);
    }

    const leagueTeamsPayload = this._buildLeagueTeamsPayload(room, auctionState);
    const seasonSeed = Date.now();
    const leagueResult = await this._runPythonLeagueSimulation(leagueTeamsPayload, seasonSeed);

    const teamMetaMap = Object.fromEntries(
      room.joinedTeams.map((team) => [
        team.teamName,
        {
          teamShortName: team.teamShortName,
          userName: team.userName,
          remainingPurse: team.remainingPurse,
        },
      ])
    );

    const standings = (leagueResult.points_table || []).map((row) => ({
      position: row.position,
      teamName: row.team,
      teamShortName: teamMetaMap[row.team]?.teamShortName || row.team,
      userName: teamMetaMap[row.team]?.userName || "",
      played: row.played,
      won: row.won,
      lost: row.lost,
      points: row.points,
      nrr: row.nrr,
      venue: row.home_venue,
    }));

    const lightweightResults = standings.map((row) => ({
      teamName: row.teamName,
      teamShortName: row.teamShortName,
      userName: row.userName,
      teamStrength: row.points * 100 + Number(row.nrr || 0) * 10,
      breakdown: {
        playingXIPoints: row.points * 100,
        teamFairplay: Number(row.nrr || 0),
        seasonRecord: `${row.won}-${row.lost}`,
      },
      points: row.points,
      nrr: row.nrr,
      played: row.played,
      won: row.won,
      lost: row.lost,
    }));

    auctionState.seasonSimulation = {
      generatedAt: new Date(),
      seed: seasonSeed,
      input: leagueTeamsPayload,
      output: leagueResult,
    };
    auctionState.markModified("seasonSimulation");
    await auctionState.save();

    return {
      simulationType: "league",
      matchNumber: 1,
      results: lightweightResults,
      standings,
      season: leagueResult,
    };
  }

  /**
   * getAllTeamStrengths — quick bulk strength summary for all teams in a room.
   * Used on the results page.
   */
  async getAllTeamStrengths(roomCode) {
    const room = await Room.findOne({ roomCode }).populate({
      path: "joinedTeams.squad.player joinedTeams.squad.leaguePlayer",
    });
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id }).lean();

    return Promise.all(
      room.joinedTeams.map(async (team) => {
        const matchData = this._getMatchData(auctionState, team.teamName);
        const fatigueMap = matchData.fatigueMap
          ? Object.fromEntries(Object.entries(matchData.fatigueMap))
          : {};
        const enriched = this._enrichSquad(team.squad);
        const savedXIIds = Array.isArray(matchData.playingXI)
          ? matchData.playingXI.map((id) => id?.toString()).filter(Boolean)
          : [];
        const savedXIEntries = savedXIIds
          .map((id) => enriched.find((entry) => this._playerId(entry) === id))
          .filter(Boolean);
        const bestXI = savedXIEntries.length === 11 ? savedXIEntries : selectBestXI(enriched);
        const validation = validateTeam(enriched);
        const xiValidation = validatePlayingXI(bestXI, room.playersPerTeam || 25);

        const strength = calculateTeamStrength({
          squadEntries: enriched,
          playingXI: bestXI,
          captainId: matchData.captainId || null,
          viceCaptainId: matchData.viceCaptainId || null,
          playersPerTeam: room.playersPerTeam || 25,
          fatigueMap,
        });

        return {
          teamName: team.teamName,
          teamShortName: team.teamShortName,
          userName: team.userName,
          squadSize: team.squad.length,
          remainingPurse: team.remainingPurse,
          total: strength.total,
          teamStrength: strength.total,
          fairplayScore: strength.teamFairplay,
          breakdown: strength,
          validation: { isValid: validation.isValid, penalties: validation.penalties, warnings: validation.warnings, roleCounts: validation.roleCounts },
          xiValidation,
          savedPlayingXI: savedXIIds,
          savedCaptainId: matchData.captainId || null,
          savedViceCaptainId: matchData.viceCaptainId || null,
          xiConfirmed: Boolean(matchData.xiConfirmed),
          playerProfiles: enriched.map((e) => ({
            playerId: this._playerId(e),
            name: e?.player?.name,
            role: e?.player?.role,
            nationality: e?.player?.nationality,
            isOverseas: Boolean(e?.player?.isOverseas || e?.isOverseas),
            skills: e?.player?.skills || [],
            overallRating: e.ratingData?.overallRating,
            fairPoint: e.ratingData?.fairPoint || 0,
            battingScore: e.ratingData?.battingScore,
            bowlingScore: e.ratingData?.bowlingScore,
            consistency: e.ratingData?.consistency,
            fairPlayScore: e.ratingData?.fairPlayScore,
            valueLabel: e.ratingData?.valueLabel,
            hasRealStats: e.ratingData?.stats?.hasRealStats,
            price: e.price,
            context: e.ratingData?.context || null,
          })),
        };
      })
    );
  }

  async getSeasonSimulation(roomCode) {
    const room = await Room.findOne({ roomCode }).lean();
    if (!room) throw new Error("Room not found");

    const auctionState = await AuctionState.findOne({ room: room._id }).lean();
    if (!auctionState?.seasonSimulation?.output) {
      throw new Error("No season simulation found for this room");
    }

    const teamMetaMap = Object.fromEntries(
      (room.joinedTeams || []).map((team) => [
        team.teamName,
        {
          teamShortName: team.teamShortName,
          userName: team.userName,
        },
      ])
    );

    return {
      simulationType: "league",
      standings: (auctionState.seasonSimulation.output.points_table || []).map((row) => ({
        position: row.position,
        teamName: row.team,
        teamShortName: teamMetaMap[row.team]?.teamShortName || row.team,
        userName: teamMetaMap[row.team]?.userName || "",
        played: row.played,
        won: row.won,
        lost: row.lost,
        points: row.points,
        nrr: row.nrr,
        venue: row.home_venue,
      })),
      season: auctionState.seasonSimulation.output,
      generatedAt: auctionState.seasonSimulation.generatedAt,
      seed: auctionState.seasonSimulation.seed,
    };
  }
}

module.exports = new MatchService();
