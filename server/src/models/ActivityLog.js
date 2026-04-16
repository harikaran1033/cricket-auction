const mongoose = require("mongoose");

/**
 * ActivityLog — immutable, append-only log for every room event.
 * Powers the activity feed in the UI.
 */
const activityLogSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "ROOM_CREATED",
        "TEAM_JOINED",
        "TEAM_LEFT",
        "TEAM_KICKED",
        "RETENTION_MADE",
        "AUCTION_STARTED",
        "PLAYER_NOMINATED",
        "BID_PLACED",
        "PLAYER_SOLD",
        "PLAYER_UNSOLD",
        "RTM_USED",
        "RTM_PASSED",
        "AUCTION_PAUSED",
        "AUCTION_RESUMED",
        "AUCTION_COMPLETED",
        "SET_CHANGED",
        "CHAT_MESSAGE",
        "HOST_REASSIGNED",
      ],
      required: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // e.g. { playerName: "Virat", teamName: "RCB", amount: 1500 }
    userId: { type: String },
    userName: { type: String },
  },
  { timestamps: true }
);

activityLogSchema.index({ room: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
