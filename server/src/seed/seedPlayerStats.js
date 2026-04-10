/**
 * Seed Player Stats & Fair Points
 * ────────────────────────────────
 * Reads legacy 2024/2025 CSVs plus the current-form CSV, matches players
 * to LeaguePlayer documents, auto-adds missing players when needed, populates
 * stats2024/stats2025/stats2026, and calculates Fair Point rating.
 *
 * Position is still taken from 2024 positional tables.
 * Current form (latest season in current-form CSV) is stored in stats2026.
 * Fair Point is weighted by latest/current form first, then prior seasons.
 *
 * Usage:  node src/seed/seedPlayerStats.js
 */

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { getDataPath, getSeedPath } = require("../store");

const Player = require("../models/Player.js");
const LeaguePlayer = require("../models/LeaguePlayer.js");
const League = require("../models/League.js");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ─── CSV Paths ───
const BATSMAN_2025 = getDataPath("Batsman.csv");
const BOWLER_2025 = getDataPath("IPL_2025 Bowlers.csv");
const BATSMAN_2024 = getDataPath("seasonbatsman2024.csv");
const BOWLER_2024 = getDataPath("seasonbowler2024.csv");
const CURRENT_FORM_CSV = getDataPath("cricket_data_2026.csv");

const TEAM_FULL_NAME_MAP = {
  CSK: "Chennai Super Kings",
  RCB: "Royal Challengers Bengaluru",
  MI: "Mumbai Indians",
  KKR: "Kolkata Knight Riders",
  SRH: "Sunrisers Hyderabad",
  LSG: "Lucknow Super Giants",
  GT: "Gujarat Titans",
  DC: "Delhi Capitals",
  PBKS: "Punjab Kings",
  RR: "Rajasthan Royals",
};

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
  const cleaned = String(val).replace(/\*$/, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function convertToLakhs(value) {
  if (!value || isNaN(value)) return 20;
  return Math.max(20, Math.floor(Number(value) / 100000));
}

function normalizeRole(role) {
  const value = String(role || "").trim();
  const map = {
    "Wicketkeeper-Batsman": "Wicket-Keeper",
    "Wicketkeeper Batter": "Wicket-Keeper",
    Wicketkeeper: "Wicket-Keeper",
    "Wicket Keeper": "Wicket-Keeper",
  };
  return map[value] || value;
}

function inferRoleFromForm(row = {}) {
  const runs = Number(row.runs || 0);
  const wickets = Number(row.wickets || 0);
  const stumpings = Number(row.stumpings || 0);
  const ballsBowled = Number(row.ballsBowled || 0);

  if (stumpings > 0) return "Wicket-Keeper";
  if (wickets >= 8 && runs < 140) return "Bowler";
  if (wickets >= 4 && runs >= 120) return "All-Rounder";
  if (ballsBowled > 60 && wickets >= 5 && runs < 120) return "Bowler";
  return "Batsman";
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

function buildCurrentFormMaps(rows) {
  const byPlayer = new Map();

  for (const row of rows) {
    const rawName = row.player_name || row.player || "";
    const name = normalizeName(rawName);
    const year = Number(row.year);
    if (!name || !Number.isFinite(year)) continue;

    const batting = {
      matches: num(row.matches_batted),
      innings: num(row.matches_batted),
      runs: num(row.runs_scored),
      average: num(row.batting_average),
      strikeRate: num(row.batting_strike_rate),
      fifties: num(row.half_centuries),
      centuries: num(row.centuries),
      fours: num(row.fours),
      sixes: num(row.sixes),
      highScore: row.highest_score || "",
      notOuts: num(row.not_outs),
      ballsFaced: num(row.balls_faced),
      position: 0,
    };
    const bowling = {
      matches: num(row.matches_bowled),
      innings: num(row.matches_bowled),
      wickets: num(row.wickets_taken),
      average: num(row.bowling_average),
      economy: num(row.economy_rate),
      strikeRate: num(row.bowling_strike_rate),
      overs: num(row.balls_bowled) / 6,
      runsConceded: num(row.runs_conceded),
      bestBowling: row.best_bowling_match || "",
      fourWickets: num(row.four_wicket_hauls),
      fiveWickets: num(row.five_wicket_hauls),
      position: 0,
    };

    const existing = byPlayer.get(name) || {};
    const years = existing.years || new Map();
    years.set(year, { batting, bowling, year, rawName });
    byPlayer.set(name, { ...existing, years, rawName });
  }

  const latestMap = new Map();
  const previousMap = new Map();
  const latestYearByName = new Map();

  for (const [name, info] of byPlayer.entries()) {
    const yearEntries = [...info.years.entries()].sort((a, b) => b[0] - a[0]);
    if (!yearEntries.length) continue;
    const latest = yearEntries[0][1];
    const previous = yearEntries[1]?.[1] || null;

    latestMap.set(name, latest);
    if (previous) previousMap.set(name, previous);
    latestYearByName.set(name, latest.year);
  }

  return { latestMap, previousMap, latestYearByName, byPlayer };
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

    // ─── Parse CSVs ───
    console.log("\n📂 Parsing CSV files...");
    const bat2025Rows = parseCSV(BATSMAN_2025);
    const bowl2025Rows = parseCSV(BOWLER_2025);
    const bat2024Rows = parseCSV(BATSMAN_2024);
    const bowl2024Rows = parseCSV(BOWLER_2024);
    const currentFormRows = parseCSV(CURRENT_FORM_CSV);
    console.log(`  Batsman 2025: ${bat2025Rows.length} rows`);
    console.log(`  Bowler 2025:  ${bowl2025Rows.length} rows`);
    console.log(`  Batsman 2024: ${bat2024Rows.length} rows`);
    console.log(`  Bowler 2024:  ${bowl2024Rows.length} rows`);
    console.log(`  Current form CSV: ${currentFormRows.length} rows`);
    const { latestMap: currentFormLatestMap, previousMap: currentFormPreviousMap } =
      buildCurrentFormMaps(currentFormRows);

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

    const rebuildLeagueMaps = async () => {
      const leaguePlayers = await LeaguePlayer.find({ league: league._id }).populate("player").lean();
      const lpMap = new Map();
      leaguePlayers.forEach((lp) => {
        if (!lp.player?.name) return;
        for (const variant of nameVariants(lp.player.name)) {
          if (!lpMap.has(variant)) lpMap.set(variant, lp);
        }
      });
      return { leaguePlayers, lpMap };
    };

    let { leaguePlayers, lpMap } = await rebuildLeagueMaps();
    console.log(`📋 Found ${leaguePlayers.length} league players.`);

    // Auto-add current-form players that are missing in Player/LeaguePlayer so simulation can use them.
    const seedPlayersPath = getSeedPath("players.json");
    const seedBasePath = getSeedPath("playersBaseprice.json");
    const seedPlayers = fs.existsSync(seedPlayersPath)
      ? JSON.parse(fs.readFileSync(seedPlayersPath, "utf-8"))
      : [];
    const basePriceRows = fs.existsSync(seedBasePath)
      ? JSON.parse(fs.readFileSync(seedBasePath, "utf-8"))
      : [];
    const seedPlayerByName = new Map(
      seedPlayers.map((p) => [normalizeName(p.fullName || p.name || ""), p])
    );
    const baseByName = new Map(
      basePriceRows.map((p) => [normalizeName(p.name || ""), p])
    );

    const allPlayers = await Player.find({}).lean();
    const playerByName = new Map();
    allPlayers.forEach((p) => {
      for (const variant of nameVariants(p.name)) {
        if (!playerByName.has(variant)) playerByName.set(variant, p);
      }
    });

    let addedPlayers = 0;
    let addedLeaguePlayers = 0;
    for (const [nameKey, formRow] of currentFormLatestMap.entries()) {
      const hasCurrentStats =
        Number(formRow?.batting?.matches || 0) > 0 || Number(formRow?.bowling?.matches || 0) > 0;
      if (!hasCurrentStats || Number(formRow?.year || 0) < 2024) continue;
      if (findInMap(lpMap, nameKey)) continue;

      let player = findInMap(playerByName, nameKey);
      const seedMeta = seedPlayerByName.get(nameKey);
      const baseMeta = baseByName.get(nameKey);

      if (!player) {
        const role = normalizeRole(seedMeta?.role) || inferRoleFromForm({
          runs: formRow?.batting?.runs || 0,
          wickets: formRow?.bowling?.wickets || 0,
          stumpings: 0,
          ballsBowled: (formRow?.bowling?.overs || 0) * 6,
        });
        player = await Player.create({
          name: formRow.rawName || nameKey,
          nationality: seedMeta?.nationality || "India",
          isOverseas:
            typeof seedMeta?.nationality === "string"
              ? seedMeta.nationality.toLowerCase() !== "india"
              : false,
          role,
          battingStyle:
            String(seedMeta?.battingStyle || "").toLowerCase().includes("left")
              ? "Left-Hand"
              : "Right-Hand",
          bowlingStyle: seedMeta?.bowlingStyle || "",
          image: seedMeta?.image || "",
          jerseyNumber: Number(seedMeta?.jerseyNumber) || undefined,
          skills: seedMeta?.skillTags || [],
          isCapped:
            typeof baseMeta?.isCapped === "boolean" ? baseMeta.isCapped : true,
        });
        addedPlayers += 1;
      }

      await LeaguePlayer.updateOne(
        { player: player._id, league: league._id },
        {
          $setOnInsert: {
            player: player._id,
            league: league._id,
            basePrice: convertToLakhs(baseMeta?.basePrice),
            franchisePrice: convertToLakhs(baseMeta?.franchisePrice || 0),
            previousTeam: TEAM_FULL_NAME_MAP[String(baseMeta?.franchiseName || "").toUpperCase()] || "",
            stats: {},
            fairPoint: 0,
            set: "",
          },
        },
        { upsert: true }
      );
      addedLeaguePlayers += 1;
    }

    if (addedPlayers || addedLeaguePlayers) {
      console.log(
        `➕ Added missing players from current-form table: players=${addedPlayers}, leaguePlayers=${addedLeaguePlayers}`
      );
      ({ leaguePlayers, lpMap } = await rebuildLeagueMaps());
      console.log(`📋 League players after sync: ${leaguePlayers.length}`);
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

    // Latest-form map from cricket_data_2026.csv (latest available season per player)
    const currentFormLatestBatMap = new Map();
    const currentFormLatestBowlMap = new Map();
    const currentFormPrevBatMap = new Map();
    const currentFormPrevBowlMap = new Map();

    for (const [nameKey, row] of currentFormLatestMap.entries()) {
      setWithVariants(currentFormLatestBatMap, nameKey, row.batting);
      setWithVariants(currentFormLatestBowlMap, nameKey, row.bowling);
    }
    for (const [nameKey, row] of currentFormPreviousMap.entries()) {
      setWithVariants(currentFormPrevBatMap, nameKey, row.batting);
      setWithVariants(currentFormPrevBowlMap, nameKey, row.bowling);
    }

    // ─── PASS 1: Compute raw fair points ───
    console.log("\n⚡ Pass 1: Computing raw Fair Points...");

    const { calculateRawFairPoint, normalizeTo100 } = require("../utils/fairPoint.js");
    const playerEntries = []; // { lp, stats2026, stats2025, stats2024, rawFP, legacyStats }
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
      const b26 = findInMap(currentFormLatestBatMap, nameKey);
      const w26 = findInMap(currentFormLatestBowlMap, nameKey);
      const b25 = findInMap(bat2025Map, nameKey);
      const w25 = findInMap(bowl2025Map, nameKey);
      const b25Fallback = findInMap(currentFormPrevBatMap, nameKey);
      const w25Fallback = findInMap(currentFormPrevBowlMap, nameKey);
      const b24 = findInMap(bat2024Map, nameKey);
      const w24 = findInMap(bowl2024Map, nameKey);
      const b25Resolved = b25 || b25Fallback;
      const w25Resolved = w25 || w25Fallback;

      // Build stats2026 (latest-form season)
      const stats2026 = {
        batting: b26
          ? {
              matches: b26.matches, innings: b26.innings, runs: b26.runs,
              average: b26.average, strikeRate: b26.strikeRate, fifties: b26.fifties,
              centuries: b26.centuries, fours: b26.fours, sixes: b26.sixes,
              highScore: b26.highScore, notOuts: b26.notOuts, ballsFaced: b26.ballsFaced,
              position: 0,
            }
          : {},
        bowling: w26
          ? {
              matches: w26.matches, innings: w26.innings, wickets: w26.wickets,
              average: w26.average, economy: w26.economy, strikeRate: w26.strikeRate,
              overs: w26.overs, runsConceded: w26.runsConceded, bestBowling: w26.bestBowling,
              fourWickets: w26.fourWickets, fiveWickets: w26.fiveWickets, position: 0,
            }
          : {},
      };

      // Build stats2025
      const stats2025 = {
        batting: b25Resolved
          ? {
              matches: b25Resolved.matches, innings: b25Resolved.innings, runs: b25Resolved.runs,
              average: b25Resolved.average, strikeRate: b25Resolved.strikeRate, fifties: b25Resolved.fifties,
              centuries: b25Resolved.centuries, fours: b25Resolved.fours, sixes: b25Resolved.sixes,
              highScore: b25Resolved.highScore, notOuts: b25Resolved.notOuts, ballsFaced: b25Resolved.ballsFaced,
              position: 0,
            }
          : {},
        bowling: w25Resolved
          ? {
              matches: w25Resolved.matches, innings: w25Resolved.innings, wickets: w25Resolved.wickets,
              average: w25Resolved.average, economy: w25Resolved.economy, strikeRate: w25Resolved.strikeRate,
              overs: w25Resolved.overs, runsConceded: w25Resolved.runsConceded, bestBowling: w25Resolved.bestBowling,
              fourWickets: w25Resolved.fourWickets, fiveWickets: w25Resolved.fiveWickets, position: 0,
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

      const hasAnyData = !!(b26 || w26 || b25Resolved || w25Resolved || b24 || w24);
      if (hasAnyData) matched++;
      else unmatched++;

      // Compute raw fair point
      const rawFP = hasAnyData ? calculateRawFairPoint(role, stats2026, stats2025, stats2024) : 0;

      const legacyStats = {
        matches: b26?.matches || w26?.matches || b25Resolved?.matches || w25Resolved?.matches || 0,
        runs: b26?.runs || b25Resolved?.runs || 0,
        wickets: w26?.wickets || w25Resolved?.wickets || 0,
        average: b26?.average || b25Resolved?.average || 0,
        strikeRate: b26?.strikeRate || b25Resolved?.strikeRate || 0,
        economy: w26?.economy || w25Resolved?.economy || 0,
      };

      playerEntries.push({ lp, stats2026, stats2024, stats2025, rawFP, legacyStats });
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
              stats2026: entry.stats2026,
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
