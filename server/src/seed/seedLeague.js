require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { League } = require("../models");

const iplTeams = [
  { name: "Chennai Super Kings", shortName: "CSK", logo: "" },
  { name: "Mumbai Indians", shortName: "MI", logo: "" },
  { name: "Royal Challengers Bengaluru", shortName: "RCB", logo: "" },
  { name: "Kolkata Knight Riders", shortName: "KKR", logo: "" },
  { name: "Sunrisers Hyderabad", shortName: "SRH", logo: "" },
  { name: "Rajasthan Royals", shortName: "RR", logo: "" },
  { name: "Delhi Capitals", shortName: "DC", logo: "" },
  { name: "Punjab Kings", shortName: "PBKS", logo: "" },
  { name: "Lucknow Super Giants", shortName: "LSG", logo: "" },
  { name: "Gujarat Titans", shortName: "GT", logo: "" },
];

/**
 * IPL-style auction sets — minimal placeholder.
 * The actual set structure is built dynamically by AuctionEngine._buildDynamicSets()
 * at auction initialization time based on player pool attributes (base price, role, capped status).
 * This placeholder ensures the schema is valid; it gets overwritten when the auction starts.
 */
const auctionSets = [
  { code: "M1",  name: "Marquee Set 1",      phase: "marquee",     roleFilter: "", cappedOnly: null, order: 1 },
  { code: "ACC", name: "Accelerated Round",   phase: "accelerated", roleFilter: "", cappedOnly: null, order: 99 },
];

const iplLeague = {
  name: "Indian Premier League",
  code: "IPL",
  totalTeams: 10,
  purse: 12000, // 120 Cr = 12000 lakhs
  maxSquadSize: 25,
  minSquadSize: 18,
  maxOverseas: 8,
  teams: iplTeams,
  retention: {
    maxRetentions: 4,
    slots: [
      { slot: 1, cost: 0, type: "capped" },
      { slot: 2, cost: 0, type: "capped" },
      { slot: 3, cost: 0, type: "capped" },
      { slot: 4, cost: 0, type: "uncapped" },
    ],
  },
  basePrices: [200, 150, 100, 75, 50, 30, 20],
  bidIncrements: [
    { upTo: 100, increment: 5 },
    { upTo: 200, increment: 10 },
    { upTo: 500, increment: 15 },
    { upTo: 1000, increment: 20 },
    { upTo: 100000, increment: 25 },
  ],
  auctionSets,
};

async function seedLeague() {
  await connectDB();

  console.log("[SeedLeague] Clearing existing leagues...");
  await League.deleteMany({});

  console.log("[SeedLeague] Creating IPL league...");
  const league = await League.create(iplLeague);

  console.log(`[SeedLeague] Done! Created league:`);
  console.log(`  - Name: ${league.name} (${league.code})`);
  console.log(`  - Teams: ${league.teams.length}`);
  console.log(`  - Purse: ${league.purse}L (${league.purse / 100} Cr)`);
  console.log(`  - Max Squad: ${league.maxSquadSize}`);
  console.log(`  - Retentions: ${league.retention.maxRetentions}`);
  console.log(`  - League ID: ${league._id}`);

  await mongoose.disconnect();
  process.exit(0);
}

seedLeague().catch((err) => {
  console.error("[SeedLeague] Error:", err);
  process.exit(1);
});