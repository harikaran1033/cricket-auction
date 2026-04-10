const mongoose = require("mongoose");

/**
 * LeaguePlayer — league-specific projection of a player.
 * Links a Player to a League with league stats & base price.
 */
/**
 * Reusable sub-schema for per-season stats (batting + bowling).
 */
const seasonStatsSchema = {
  batting: {
    matches: { type: Number, default: 0 },
    innings: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    average: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    fifties: { type: Number, default: 0 },
    centuries: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    highScore: { type: String, default: "" },
    notOuts: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    position: { type: Number, default: 0 }, // ranking position
  },
  bowling: {
    matches: { type: Number, default: 0 },
    innings: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    average: { type: Number, default: 0 },
    economy: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    overs: { type: Number, default: 0 },
    runsConceded: { type: Number, default: 0 },
    bestBowling: { type: String, default: "" },
    fourWickets: { type: Number, default: 0 },
    fiveWickets: { type: Number, default: 0 },
    position: { type: Number, default: 0 }, // ranking position
  },
};

const leaguePlayerSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
    league: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "League",
      required: true,
    },
    basePrice: { type: Number, required: true }, // in lakhs
    franchisePrice: { type: Number, default: 0 }, // retention price in lakhs
    previousTeam: { type: String, default: "" },

    // Legacy flat stats (kept for backward compat)
    stats: {
      matches: { type: Number, default: 0 },
      runs: { type: Number, default: 0 },
      wickets: { type: Number, default: 0 },
      average: { type: Number, default: 0 },
      strikeRate: { type: Number, default: 0 },
      economy: { type: Number, default: 0 },
    },

    // Per-season detailed stats for Fair Point calculation
    stats2024: seasonStatsSchema,
    stats2025: seasonStatsSchema,
    stats2026: seasonStatsSchema,

    // Fair Point rating (computed from formulas)
    fairPoint: { type: Number, default: 0 },

    set: { type: String, default: "A" }, // Auction set grouping
  },
  { timestamps: true }
);

leaguePlayerSchema.index({ league: 1 });
leaguePlayerSchema.index({ player: 1, league: 1 }, { unique: true });

module.exports = mongoose.model("LeaguePlayer", leaguePlayerSchema);
