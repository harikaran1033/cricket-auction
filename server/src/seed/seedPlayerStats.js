/**
 * Seed Player Stats & Fair Points
 * ────────────────────────────────
 * Reads 4 CSV files (2024 & 2025 batting + bowling), matches players
 * to existing LeaguePlayer documents, populates stats2024/stats2025,
 * and calculates the Fair Point rating.
 *
 * Position is taken from 2024 data only.
 * Stats (runs, matches, avg, SR) from 2025.
 * Fair Point = 70% × 2025 score + 30% × 2024 score (0.8x damping if no 2024 data).
 *
 * Usage:  node src/seed/seedPlayerStats.js
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

const Player = require("../models/Player.js");
const LeaguePlayer = require("../models/LeaguePlayer.js");
const League = require("../models/League.js");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── CSV Paths ───
const CSV_DIR = path.resolve(__dirname, "../../../"); // project root with CSVs
const BATSMAN_2025 = path.join(CSV_DIR, "Batsman.csv");
const BOWLER_2025 = path.join(CSV_DIR, "IPL_2025 Bowlers.csv");
const BATSMAN_2024 = path.join(CSV_DIR, "seasonbatsman2024.csv");
const BOWLER_2024 = path.join(CSV_DIR, "seasonbowler2024.csv");

// ─── Helpers ───

/**
 * Parse a CSV file into rows of objects keyed by lower-cased, trimmed headers.
 */
function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? "";
    });
    rows.push(obj);
  }
  return rows;
}

/**
 * Parse a numeric value, returning 0 for "-", "*" or empty.
 */
function num(val) {
  if (!val || val === "-" || val === "*" || val === "") return 0;
  const cleaned = val.replace(/\*$/, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Normalize a player name for matching.
 * Collapses spaces, lowercases, strips dots/hyphens for consistency.
 */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toString()
    .toLowerCase()
    .replace(/\./g, "")       // "R. Ashwin" → "R Ashwin"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate multiple key variants for a name to improve fuzzy matching.
 * E.g. "K L Rahul" → ["k l rahul", "kl rahul", "klrahul"]
 */
function nameVariants(name) {
  const base = normalizeName(name);
  if (!base) return [];
  const variants = [base];
  // Collapse single-letter initials: "k l rahul" → "kl rahul"
  const collapsed = base.replace(/\b([a-z])\s+(?=[a-z]\b)/g, "$1");
  if (collapsed !== base) variants.push(collapsed);
  // Remove all spaces between short token groups: "kl rahul" stays
  // Also try removing hyphens: "naveen-ul-haq" → "naveen ul haq"
  const noHyphen = base.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (noHyphen !== base) variants.push(noHyphen);
  return [...new Set(variants)];
}

/**
 * Known name aliases: CSV name → DB name (both normalized lowercase).
 * Handles cases where CSV and DB use different spellings.
 */
/**
 * Known name aliases (bidirectional): maps one spelling to another.
 * Used both when storing CSV data (CSV name → DB name) and looking up (DB name → CSV name).
 */
const NAME_ALIASES = {
  "surya kumar yadav": "suryakumar yadav",
  "k l rahul": "kl rahul",
  "anrich nortje": "anrich nortje",
  "du plessis": "faf du plessis",
  "devdutt padikkal": "devdutt padikkal",
  "r ashwin": "ravichandran ashwin",
  // CSV ↔ DB spelling variations
  "varun chakaravarthy": "varun chakravarthy",
  "varun chakravarthy": "varun chakaravarthy",
  "lungisani ngidi": "lungi ngidi",
  "lungi ngidi": "lungisani ngidi",
  "sai kishore": "r sai kishore",
  "r sai kishore": "sai kishore",
  "mohammad shami": "mohammed shami",
  "mohammed shami": "mohammad shami",
  "mohammad siraj": "mohammed siraj",
  "mohammed siraj": "mohammad siraj",
};

/**
 * Strip team abbreviation from 2024 player names like "Virat Kohli RCB".
 */
const TEAM_CODES = ["CSK", "RCB", "MI", "KKR", "SRH", "LSG", "GT", "DC", "PBKS", "RR"];
function stripTeam(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toUpperCase();
    if (TEAM_CODES.includes(last)) {
      return parts.slice(0, -1).join(" ");
    }
  }
  return name;
}

/**
 * Look up a CSV name in the DB player map, trying multiple strategies.
 */
function findInMap(map, csvName) {
  // Direct match
  const direct = map.get(csvName);
  if (direct) return direct;

  // Try alias
  const alias = NAME_ALIASES[csvName];
  if (alias) {
    const aliased = map.get(alias);
    if (aliased) return aliased;
  }

  // Try collapsed initials
  for (const variant of nameVariants(csvName)) {
    const v = map.get(variant);
    if (v) return v;
  }

  return null;
}

// ─── Main ───

async function seedPlayerStats() {
  try {
    const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/cricket-auction";
    await mongoose.connect(DB_URI);
    console.log(`📡 Connected to: ${mongoose.connection.name}`);

    // Find IPL league
    const league = await League.findOne({ code: "IPL" });
    if (!league) {
      console.error("❌ League 'IPL' not found. Run league seed first.");
      process.exit(1);
    }

    // Load all league players with populated player master data
    const leaguePlayers = await LeaguePlayer.find({ league: league._id }).populate("player").lean();
    console.log(`📋 Found ${leaguePlayers.length} league players.`);

    // Build lookup: normalized name → leaguePlayer (multiple keys per player for fuzzy match)
    const lpMap = new Map();
    leaguePlayers.forEach((lp) => {
      if (lp.player?.name) {
        for (const variant of nameVariants(lp.player.name)) {
          if (!lpMap.has(variant)) lpMap.set(variant, lp);
        }
      }
    });

    // ─── Parse CSVs ───
    console.log("\n📂 Parsing CSV files...");
    const bat2025Rows = parseCSV(BATSMAN_2025);
    const bowl2025Rows = parseCSV(BOWLER_2025);
    const bat2024Rows = parseCSV(BATSMAN_2024);
    const bowl2024Rows = parseCSV(BOWLER_2024);
    console.log(`  Batsman 2025: ${bat2025Rows.length} rows`);
    console.log(`  Bowler 2025:  ${bowl2025Rows.length} rows`);
    console.log(`  Batsman 2024: ${bat2024Rows.length} rows`);
    console.log(`  Bowler 2024:  ${bowl2024Rows.length} rows`);

    // ─── Build stat maps by normalized name (with variants) ───

    function setWithVariants(map, rawName, data, strip = false) {
      const cleaned = strip ? stripTeam(rawName) : rawName;
      for (const variant of nameVariants(cleaned)) {
        if (!map.has(variant)) map.set(variant, data);
      }
      // Also store alias if it exists
      const norm = normalizeName(cleaned);
      const alias = NAME_ALIASES[norm];
      if (alias && !map.has(alias)) map.set(alias, data);
    }

    // 2025 Batting
    const bat2025Map = new Map();
    bat2025Rows.forEach((r) => {
      const name = r.player || "";
      if (!name) return;
      const data = {
        position: num(r.no),
        matches: num(r.mat),
        innings: num(r.inns),
        runs: num(r.runs),
        notOuts: num(r.no),
        highScore: r.hs || "",
        average: num(r.avg),
        ballsFaced: num(r.bf),
        strikeRate: num(r.sr),
        centuries: num(r["100"]),
        fifties: num(r["50"]),
        fours: num(r["4s"]),
        sixes: num(r["6s"]),
      };
      setWithVariants(bat2025Map, name, data);
    });

    // 2025 Bowling
    const bowl2025Map = new Map();
    bowl2025Rows.forEach((r) => {
      const name = r.player || "";
      if (!name) return;
      const data = {
        position: num(r.no),
        matches: num(r.mat),
        innings: num(r.inns),
        wickets: num(r.wkts),
        overs: num(r.ov),
        runsConceded: num(r.runs),
        bestBowling: r.bbi || "",
        average: num(r.avg),
        economy: num(r.econ),
        strikeRate: num(r.sr),
        fourWickets: num(r["4w"]),
        fiveWickets: num(r["5w"]),
      };
      setWithVariants(bowl2025Map, name, data);
    });

    // 2024 Batting
    const bat2024Map = new Map();
    bat2024Rows.forEach((r) => {
      const rawName = r.player || "";
      if (!rawName) return;
      const data = {
        position: num(r.no),
        matches: num(r.mat),
        innings: num(r.inns),
        runs: num(r.runs),
        notOuts: num(r.no),
        highScore: r.hs || "",
        average: num(r.avg),
        ballsFaced: num(r.bf),
        strikeRate: num(r.sr),
        centuries: num(r.centuries),
        fifties: num(r.halfcenturies),
        fours: num(r.fours),
        sixes: num(r.sixes),
      };
      setWithVariants(bat2024Map, rawName, data, true);
    });

    // 2024 Bowling
    const bowl2024Map = new Map();
    bowl2024Rows.forEach((r) => {
      const rawName = r.player || "";
      if (!rawName) return;
      const data = {
        position: num(r.no),
        matches: num(r.mat),
        innings: num(r.inns),
        wickets: num(r.wkts),
        overs: num(r.ov),
        runsConceded: num(r.runs),
        bestBowling: r.bbi || "",
        average: num(r.avg),
        economy: num(r.econ),
        strikeRate: num(r.sr),
        fourWickets: num(r["4w"]),
        fiveWickets: num(r["5w"]),
      };
      setWithVariants(bowl2024Map, rawName, data, true);
    });

    // ─── PASS 1: Compute raw fair points ───
    console.log("\n⚡ Pass 1: Computing raw Fair Points...");

    const { calculateRawFairPoint, normalizeTo100 } = require("../utils/fairPoint.js");
    const playerEntries = []; // { lp, stats2024, stats2025, rawFP, legacyStats }
    let matched = 0;
    let unmatched = 0;
    const seenIds = new Set();

    for (const lp of leaguePlayers) {
      if (!lp.player?.name) continue;
      if (seenIds.has(lp._id.toString())) continue;
      seenIds.add(lp._id.toString());

      const nameKey = normalizeName(lp.player.name);
      const role = lp.player?.role || "Batsman";

      // Look up stats using fuzzy matching
      const b25 = findInMap(bat2025Map, nameKey);
      const w25 = findInMap(bowl2025Map, nameKey);
      const b24 = findInMap(bat2024Map, nameKey);
      const w24 = findInMap(bowl2024Map, nameKey);

      // Build stats2025
      const stats2025 = {
        batting: b25
          ? {
              matches: b25.matches, innings: b25.innings, runs: b25.runs,
              average: b25.average, strikeRate: b25.strikeRate, fifties: b25.fifties,
              centuries: b25.centuries, fours: b25.fours, sixes: b25.sixes,
              highScore: b25.highScore, notOuts: b25.notOuts, ballsFaced: b25.ballsFaced,
              position: 0,
            }
          : {},
        bowling: w25
          ? {
              matches: w25.matches, innings: w25.innings, wickets: w25.wickets,
              average: w25.average, economy: w25.economy, strikeRate: w25.strikeRate,
              overs: w25.overs, runsConceded: w25.runsConceded, bestBowling: w25.bestBowling,
              fourWickets: w25.fourWickets, fiveWickets: w25.fiveWickets, position: 0,
            }
          : {},
      };

      // Build stats2024 — position comes from here
      const stats2024 = {
        batting: b24
          ? {
              matches: b24.matches, innings: b24.innings, runs: b24.runs,
              average: b24.average, strikeRate: b24.strikeRate, fifties: b24.fifties,
              centuries: b24.centuries, fours: b24.fours, sixes: b24.sixes,
              highScore: b24.highScore, notOuts: b24.notOuts, ballsFaced: b24.ballsFaced,
              position: b24.position,
            }
          : {},
        bowling: w24
          ? {
              matches: w24.matches, innings: w24.innings, wickets: w24.wickets,
              average: w24.average, economy: w24.economy, strikeRate: w24.strikeRate,
              overs: w24.overs, runsConceded: w24.runsConceded, bestBowling: w24.bestBowling,
              fourWickets: w24.fourWickets, fiveWickets: w24.fiveWickets, position: w24.position,
            }
          : {},
      };

      const hasAnyData = !!(b25 || w25 || b24 || w24);
      if (hasAnyData) matched++;
      else unmatched++;

      // Compute raw fair point
      const rawFP = hasAnyData ? calculateRawFairPoint(role, stats2025, stats2024) : 0;

      const legacyStats = {
        matches: b25?.matches || w25?.matches || 0,
        runs: b25?.runs || 0,
        wickets: w25?.wickets || 0,
        average: b25?.average || 0,
        strikeRate: b25?.strikeRate || 0,
        economy: w25?.economy || 0,
      };

      playerEntries.push({ lp, stats2024, stats2025, rawFP, legacyStats });
    }

    // ─── PASS 2: Normalize to 0-100 ───
    console.log("⚡ Pass 2: Normalizing Fair Points to 0-100...");
    const rawScores = playerEntries.map((e) => e.rawFP);
    const normalized = normalizeTo100(rawScores);

    // Build bulk operations
    const bulkOps = playerEntries.map((entry, i) => {
      let fp = normalized[i];

      // Absent players (no CSV data) — assign a small baseline FP instead of 0
      if (entry.rawFP === 0) {
        const isOverseas = entry.lp.player?.isOverseas || false;
        if (isOverseas) {
          // Overseas not in CSV: 8–10
          fp = Math.round((8 + Math.random() * 2) * 10) / 10;
        } else {
          // Domestic uncapped not in CSV: 6–8
          fp = Math.round((6 + Math.random() * 2) * 10) / 10;
        }
      }

      return {
        updateOne: {
          filter: { _id: entry.lp._id },
          update: {
            $set: {
              stats2024: entry.stats2024,
              stats2025: entry.stats2025,
              fairPoint: fp,
              stats: entry.legacyStats,
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      const result = await LeaguePlayer.bulkWrite(bulkOps);
      console.log(`\n✅ Updated ${result.modifiedCount} league players.`);
    }

    console.log(`📊 Matched: ${matched} | Unmatched (no CSV data): ${unmatched}`);
    console.log(`📏 FP Range: 0–100 (${playerEntries.filter(e => e.rawFP > 0).length} players with data)`);

    // Print top 10 Fair Points
    const topPlayers = await LeaguePlayer.find({ league: league._id, fairPoint: { $gt: 0 } })
      .populate("player", "name role")
      .sort({ fairPoint: -1 })
      .limit(15)
      .lean();

    console.log("\n🏆 Top 15 Fair Points (0-100 scale):");
    topPlayers.forEach((p, i) => {
      console.log(
        `  ${i + 1}. ${p.player?.name || "?"} (${p.player?.role}) — ${p.fairPoint.toFixed(1)}`
      );
    });
  } catch (err) {
    console.error("🔥 Error:", err.message, err.stack);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedPlayerStats();
