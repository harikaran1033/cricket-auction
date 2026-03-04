const mongoose = require("mongoose");

/**
 * ChatMessage — room-scoped realtime chat messages.
 */
const chatMessageSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    teamName: { type: String, default: "" },
    message: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: true }
);

chatMessageSchema.index({ room: 1, createdAt: -1 });

module.exports = mongoose.model("ChatMessage", chatMessageSchema);
