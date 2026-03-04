const mongoose = require("mongoose");

/**
 * League — defines the rules for an auction format (IPL, PSL, SA20 etc.)
 * This is the source of truth for purse, team count, retention rules, etc.
 */
const leagueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // e.g. "IPL", "PSL", "SA20", "BBL"
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    totalTeams: { type: Number, required: true },
    purse: { type: Number, required: true }, // in lakhs
    maxSquadSize: { type: Number, required: true, default: 25 },
    minSquadSize: { type: Number, required: true, default: 18 },
    maxOverseas: { type: Number, required: true, default: 8 },
    teams: [
      {
        name: { type: String, required: true },
        shortName: { type: String, required: true },
        logo: { type: String, default: "" },
      },
    ],

    // Retention slot configuration
    retention: {
      maxRetentions: { type: Number, default: 6 },
      slots: [
        {
          slot: Number,
          cost: Number, // in lakhs deducted from purse
          type: { type: String, enum: ["capped", "uncapped"], default: "capped" },
        },
      ],
    },

    // Auction base prices
    basePrices: {
      type: [Number],
      default: [200, 150, 100, 75, 50, 30, 20], // in lakhs
    },

    // Bid increment brackets
    bidIncrements: {
      type: [
        {
          upTo: Number, // up to this bid amount
          increment: Number, // increment by this
        },
      ],
      default: [
        { upTo: 100, increment: 5 },
        { upTo: 200, increment: 10 },
        { upTo: 500, increment: 15 },
        { upTo: 1000, increment: 20 },
        { upTo: Infinity, increment: 25 },
      ],
    },

    // IPL-style auction set configuration
    auctionSets: {
      type: [
        {
          code: { type: String, required: true },     // e.g. "M1", "BA1", "SP2"
          name: { type: String, required: true },     // e.g. "Marquee Set 1"
          phase: {
            type: String,
            enum: ["marquee", "primary", "uncapped", "depth", "accelerated"],
            default: "primary",
          },
          roleFilter: {
            type: String,
            default: "",  // empty = any role; values: Batsman, Bowler, All-Rounder, Wicket-Keeper
          },
          cappedOnly: { type: Boolean, default: null },  // true=capped, false=uncapped, null=any
          order: { type: Number, required: true },        // display/progression order
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("League", leagueSchema);
