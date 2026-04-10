const mongoose = require("mongoose");

/**
 * Room — the central entity for an auction session.
 * Contains joined teams, retention config, room state, and links to league.
 */

const squadPlayerSchema = new mongoose.Schema(
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
    acquiredFrom: {
      type: String,
      enum: ["retention", "auction", "rtm"],
      required: true,
    },
    price: { type: Number, required: true }, // price paid in lakhs
    isOverseas: { type: Boolean, default: false },
  },
  { _id: false }
);

const joinedTeamSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true }, // UUID
    userName: { type: String, required: true },
    teamName: { type: String, required: true },
    teamShortName: { type: String, required: true },
    totalPurse: { type: Number, required: true },
    remainingPurse: { type: Number, required: true },
    squad: [squadPlayerSchema],
    retentions: [squadPlayerSchema],
    rtmCardsUsed: { type: Number, default: 0 },
    maxRtmCards: { type: Number, default: 0 },
    isReady: { type: Boolean, default: false },
    isConnected: { type: Boolean, default: true },
    // Optional franchise branding fields (set during room-join or team creation)
    teamColor: { type: String, default: "" },  // hex color e.g. "#1E3A5F"
    teamLogo:  { type: String, default: "" },  // URL or base64 image
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    roomName: { type: String, required: true, trim: true },
    league: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "League",
      required: true,
    },
    host: {
      userId: { type: String, required: true },
      userName: { type: String, required: true },
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    retentionEnabled: { type: Boolean, default: false },

    status: {
      type: String,
      enum: [
        "waiting",     // room created, waiting for players
        "retention",   // retention phase active
        "lobby",       // all in lobby, ready to start
        "auction",     // auction is live
        "paused",      // auction paused
        "inactive",    // stale / abandoned room
        "completed",   // auction finished
      ],
      default: "waiting",
    },

    joinedTeams: [joinedTeamSchema],

    maxTeams: { type: Number, required: true },

    // Users kicked from this room (cannot rejoin)
    kickedUsers: { type: [String], default: [] },

    // Squad size configuration (set at room creation; drives overseas limits)
    // 11 → overseasLimit 4 | 15 → 6 | 25 → 8
    playersPerTeam: {
      type: Number,
      enum: [11, 15, 25],
      default: 25,
    },
    overseasLimit: {
      type: Number,
      default: 8, // derived from playersPerTeam on save
    },

    // Auction configuration overrides
    auctionConfig: {
      timerSeconds: { type: Number, default: 15 },
      bidIncrement: { type: Number, default: 25 },
    },

    // Per-team match data (populated after auction completes)
    matchData: {
      type: Map,
      of: new mongoose.Schema(
        {
          playingXI:    { type: [mongoose.Schema.Types.ObjectId], ref: "Player", default: [] },
          captainId:    { type: String, default: null },
          viceCaptainId:{ type: String, default: null },
          fatigueMap:   { type: Map, of: Number, default: {} },
          injuredIds:   { type: [String], default: [] },
          teamStrength: { type: Number, default: 0 },
          matchesPlayed:{ type: Number, default: 0 },
        },
        { _id: false }
      ),
      default: {},
    },

    inactiveAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Auto-derive overseasLimit from playersPerTeam on every save
const OVERSEAS_MAP = { 11: 4, 15: 6, 25: 8 };
roomSchema.pre("save", function (next) {
  this.overseasLimit = OVERSEAS_MAP[this.playersPerTeam] || 8;
  next();
});

// Generate unique 6-char room code
roomSchema.statics.generateRoomCode = function () {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

roomSchema.index({ status: 1, visibility: 1 });

module.exports = mongoose.model("Room", roomSchema);
