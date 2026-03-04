const mongoose = require("mongoose");
const Player = require("../models/Player.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") }); // Adjust path to find your .env file

const loadPlayersFromJson = async (filePath) => {
  try {
    // 1. Use the URI from your .env file
    const DB_URI = process.env.MONGO_URI || process.env.MONGODB_URL;
    
    if (!DB_URI) {
      throw new Error("MONGO_URI not found in .env file");
    }

    await mongoose.connect(DB_URI);
    console.log(`Connected to: ${mongoose.connection.name}`);

    const absolutePath = path.resolve(__dirname, filePath);
    const rawData = JSON.parse(fs.readFileSync(absolutePath, "utf-8"));
    const dataArray = Array.isArray(rawData) ? rawData : [rawData];

    const formattedData = dataArray.map((p) => ({
      name: p.fullName,
      nationality: p.nationality,
      isOverseas: p.nationality.toLowerCase() !== "india",
      role: p.role,
      battingStyle: p.battingStyle.toLowerCase().includes("right") 
        ? "Right-Hand" 
        : "Left-Hand",
      bowlingStyle: p.bowlingStyle || "",
      jerseyNumber: Number(p.jerseyNumber),
      skills: p.skillTags || [],
      isCapped: true
    }));

    // 2. Insert into the ENV database
    const result = await Player.insertMany(formattedData, { ordered: false });
    console.log(`✅ Successfully loaded ${result.length} players into ${mongoose.connection.name}`);

  } catch (error) {
    if (error.code === 11000) {
      console.warn("⚠️ Duplicate players found in this DB; skipping those entries.");
    } else {
      console.error("❌ Error:", error.message);
    }
  } finally {
    await mongoose.connection.close();
    process.exit();
  }
};

// Make sure the path to players.json is relative to THIS script
loadPlayersFromJson("./players.json");