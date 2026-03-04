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
        "completed",   // auction finished
      ],
      default: "waiting",
    },

    joinedTeams: [joinedTeamSchema],

    maxTeams: { type: Number, required: true },

    // Users kicked from this room (cannot rejoin)
    kickedUsers: { type: [String], default: [] },

    // Auction configuration overrides
    auctionConfig: {
      timerSeconds: { type: Number, default: 15 },
      bidIncrement: { type: Number, default: 25 },
    },
  },
  { timestamps: true }
);

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
