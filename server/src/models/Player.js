const mongoose = require("mongoose");

/**
 * Player — global player master data (name, nationality, skills)
 * This is league-agnostic. League-specific stats go in LeaguePlayer.
 */
const playerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    nationality: { type: String, required: true, trim: true },
    isOverseas: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ["Batsman", "Bowler", "All-Rounder", "Wicket-Keeper"],
      required: true,
    },
    battingStyle: {
      type: String,
      enum: ["Right-Hand", "Left-Hand"],
      default: "Right-Hand",
    },
    bowlingStyle: {
      type: String,
      default: "",
      // e.g. "Right-Arm Fast", "Left-Arm Spin", etc.
    },
    image: {
      type: String,
      default: "",
    },
    jerseyNumber:{type:Number},
    skills: {
      type: [String],
      default: [],
    },
    isCapped: { type: Boolean, default: true },
  },
  { timestamps: true }
);

playerSchema.index({ name: 1, nationality: 1 });

module.exports = mongoose.model("Player", playerSchema);
