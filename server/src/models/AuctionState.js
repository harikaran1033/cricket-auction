const mongoose = require("mongoose");

/**
 * AuctionState — server-authoritative state for a live auction.
 * One per room. This is the single source of truth for the auction engine.
 *
 * STATE MACHINE:
 *   WAITING -> NOMINATING -> BIDDING -> SOLD/UNSOLD -> NOMINATING -> ... -> COMPLETED
 */

const bidEntrySchema = new mongoose.Schema(
  {
    teamName: { type: String, required: true },
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    isRtm: { type: Boolean, default: false },
  },
  { _id: false }
);

const soldPlayerSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
    },
    leaguePlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaguePlayer",
    },
    soldTo: { type: String, default: null }, // teamName or null if unsold
    soldPrice: { type: Number, default: 0 },
    acquiredVia: {
      type: String,
      enum: ["auction", "rtm", "unsold"],
      default: "auction",
    },
    bidHistory: [bidEntrySchema],
  },
  { _id: false }
);

const auctionStateSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: [
        "WAITING",      // auction created but not started
        "NOMINATING",   // host selecting next player
        "BIDDING",      // bidding in progress
        "SOLD",         // current player just sold (brief state)
        "UNSOLD",       // current player unsold (brief state)
        "RTM_PENDING",  // RTM decision pending
        "PAUSED",       // auction paused by host
        "COMPLETED",    // all players done
      ],
      default: "WAITING",
    },

    // Current player being auctioned
    currentPlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      default: null,
    },
    currentLeaguePlayer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaguePlayer",
      default: null,
    },
    currentBasePrice: { type: Number, default: 0 },
    currentBid: { type: Number, default: 0 },
    currentBidTeam: { type: String, default: null },
    currentBidUserId: { type: String, default: null },
    currentBidHistory: [bidEntrySchema],
    currentPlayerPhase: {
      type: String,
      enum: ["scout", "bid", "revealed", null],
      default: null,
    },

    // RTM state
    rtmEligibleTeam: { type: String, default: null },
    rtmActive: { type: Boolean, default: false },

    // Timer
    timerEndsAt: { type: Date, default: null },
    timerDurationMs: { type: Number, default: 15000 },

    // Player queues
    playerPool: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeaguePlayer",
      },
    ],
    nominationIndex: { type: Number, default: 0 },
    currentSet: { type: String, default: "M1" },

    // Set-based auction flow
    setOrder: {
      type: [String],        // ordered array of set codes: ["M1","M2","BA1",...]
      default: [],
    },
    currentSetIndex: { type: Number, default: 0 },
    setPool: [                // players for the CURRENT set only
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeaguePlayer",
      },
    ],
    completedSets: {
      type: [String],         // set codes that are fully done
      default: [],
    },

    // Results
    soldPlayers: [soldPlayerSchema],
    unsoldPlayers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LeaguePlayer",
      },
    ],

    // Stats
    totalPlayersSold: { type: Number, default: 0 },
    totalPlayersUnsold: { type: Number, default: 0 },
    totalPurseSpent: { type: Number, default: 0 },

    // Round tracking
    round: { type: Number, default: 1 },
    isAccelerated: { type: Boolean, default: false },

    // ── Match data (populated after auction, before match simulation) ──
    // Keyed by teamName; stores Playing XI selections, C/VC, fatigue, ratings
    teamMatchData: {
      type: Map,
      of: new mongoose.Schema(
        {
          // Array of Player ObjectIds for the Playing XI (exactly 11)
          playingXI:     { type: [mongoose.Schema.Types.ObjectId], ref: "Player", default: [] },
          captainId:     { type: String, default: null },
          viceCaptainId: { type: String, default: null },
          // Per-player fatigue: { [playerId]: 0–0.5 }
          fatigueMap:    { type: Map, of: Number, default: {} },
          // Injured player ids for this match
          injuredIds:    { type: [String], default: [] },
          // Computed team strength (full breakdown stored as JSON)
          teamStrength:  { type: Number, default: 0 },
          strengthBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
          matchesPlayed: { type: Number, default: 0 },
          // Whether the team has submitted its XI for current match
          xiConfirmed:   { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: {},
    },

    // Persisted season/league simulation output from the Python engine
    seasonSimulation: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model("AuctionState", auctionStateSchema);
