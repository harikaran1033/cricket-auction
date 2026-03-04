const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

const Player = require("../models/Player.js"); 
const LeaguePlayer = require("../models/LeaguePlayer.js");
const League = require("../models/League.js");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const filePath = path.join(__dirname, "playersBaseprice.json");

// Team Name Mapping
const teamFullNameMap = {
  "CSK": "Chennai Super Kings",
  "RCB": "Royal Challengers Bengaluru",
  "MI": "Mumbai Indians",
  "KKR": "Kolkata Knight Riders",
  "SRH": "Sunrisers Hyderabad",
  "LSG": "Lucknow Super Giants",
  "GT": "Gujarat Titans",
  "DC": "Delhi Capitals",
  "PBKS": "Punjab Kings",
  "RR": "Rajasthan Royals"
};

const normalizeName = (name) => {
  if (!name) return "";
  return name.toString().toLowerCase().replace(/\s+/g, " ").trim();
};

/**
 * Converts absolute currency (e.g. 20,000,000) to Lakhs (e.g. 200)
 */
const convertToLakhs = (val) => {
  if (!val || isNaN(val)) return 0;
  return Math.floor(Number(val) / 100000); 
};

async function seedLeaguePlayers() {
  try {
    const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/cricket-auction";
    await mongoose.connect(DB_URI);
    console.log(`📡 Connected to: ${mongoose.connection.name}`);

    const league = await League.findOne({ code: "IPL" }); 
    if (!league) {
      console.error("❌ League 'IPL' not found.");
      process.exit(1);
    }

    const allMasterPlayers = await Player.find({}).lean();
    const playerMap = new Map();
    allMasterPlayers.forEach((p) => {
      const nameKey = p.fullName || p.name; 
      if (nameKey) playerMap.set(normalizeName(nameKey), p._id);
    });

    const playersData = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const toInsert = playersData.map((item) => {
      const jsonName = normalizeName(item.name);
      const playerId = playerMap.get(jsonName);

      if (!playerId) return null;

      // Handle Team Name
      const rawFranchise = item.franchiseName || "";
      const fullTeamName = teamFullNameMap[rawFranchise.toUpperCase()] || rawFranchise || "None";

      return {
        player: playerId, 
        league: league._id,
        // CONVERSION LOGIC: 2 Cr -> 200, 16 Cr -> 1600
        basePrice: convertToLakhs(item.basePrice),
        franchisePrice: convertToLakhs(item.franchisePrice),
        previousTeam: fullTeamName,
        stats: {}, 
        set: "",
        // Store isCapped info for updating Player model
        _isCapped: item.isCapped,
        _playerId: playerId,
      };
    }).filter(Boolean);

    console.log(`✅ Prepared ${toInsert.length} records.`);

    // Update Player model isCapped field from baseprice data
    const cappedUpdates = toInsert
      .filter((item) => item._isCapped !== undefined && item._isCapped !== null)
      .map((item) => ({
        updateOne: {
          filter: { _id: item._playerId },
          update: { $set: { isCapped: item._isCapped === true } },
        },
      }));

    // For overseas players (isCapped === null), keep isCapped as true since they're international
    const overseasUpdates = toInsert
      .filter((item) => item._isCapped === null)
      .map((item) => ({
        updateOne: {
          filter: { _id: item._playerId },
          update: { $set: { isCapped: true, isOverseas: true } },
        },
      }));

    if (cappedUpdates.length > 0) {
      await Player.bulkWrite(cappedUpdates);
      console.log(`📝 Updated isCapped for ${cappedUpdates.length} players.`);
    }
    if (overseasUpdates.length > 0) {
      await Player.bulkWrite(overseasUpdates);
      console.log(`📝 Updated ${overseasUpdates.length} overseas players.`);
    }

    // Clean up internal fields before inserting
    const cleanInsert = toInsert.map(({ _isCapped, _playerId, ...rest }) => rest);

    // Drop old conflicting index
    try {
      await mongoose.connection.collection('leagueplayers').dropIndex("leagueId_1_playerId_1");
    } catch (e) { /* ignore */ }

    // Clear and Insert
    await LeaguePlayer.deleteMany({ league: league._id });
    const result = await LeaguePlayer.insertMany(cleanInsert);
    
    console.log(`🎉 Success! Seeded ${result.length} League Players into ${mongoose.connection.name}.`);

  } catch (err) {
    console.error("🔥 Error:", err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedLeaguePlayers();