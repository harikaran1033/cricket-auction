/**
 * matchEngine.js — Production-ready match simulation & rating system.
 *
 * Pipeline:
 *   1. estimateMissingStats  — fill gaps with role/tier realistic defaults
 *   2. calculateRating       — batting/bowling/overall scores (0–100)
 *   3. classifyRole          — auto-detect role from scores
 *   4. calculateConsistency  — 2-year variance → 0–1 score
 *   5. calculateFairPlay     — 0–10 fairplay score per player
 *   6. simulatePlayerPoints  — stat-driven point simulation
 *   7. validateTeam          — role constraints + penalties
 *   8. selectBestXI          — optimal 11 from squad
 *   9. calculateTeamStrength — full composite team score
 *
 * No pure randomness — stats dominate; variance is bounded and consistency-gated.
 */

// ─── Dependencies ─────────────────────────────────────────────────────────────

const pvp = require("./playerValueProfiles");
const { buildPlayerContext, buildSquadHealth } = require("./playerContext");

// ─── Constants ────────────────────────────────────────────────────────────────

const OVERSEAS_LIMITS = { 11: 4, 15: 6, 25: 8 };

// Normalization ceilings (domain knowledge from T20 cricket)
const NORM = {
  RUNS_MAX: 1200,      // high-end 2-year aggregate T20 runs
  WICKETS_MAX: 60,     // high-end 2-year aggregate T20 wickets
  AVG_MAX: 60,         // batting average ceiling
  SR_MAX: 200,         // strike rate ceiling
  ECONOMY_MIN: 5,      // best economy possible
  ECONOMY_MAX: 14,     // worst tolerable economy
};

// Minimum squad composition (applies regardless of squad size)
const SQUAD_MIN = {
  Batsman: 3,
  Bowler: 3,
  "All-Rounder": 1,
  "Wicket-Keeper": 1,
};

const XI_MIN = {
  Batsman: 3,
  Bowler: 3,
  "All-Rounder": 2,
  "Wicket-Keeper": 1,
};

// ─── Tier defaults for stat estimation ────────────────────────────────────────

const STAT_DEFAULTS = {
  Batsman: {
    star:     { runs: 800, avg: 44, sr: 148, wickets: 0,  economy: 0  },
    mid:      { runs: 480, avg: 32, sr: 135, wickets: 0,  economy: 0  },
    emerging: { runs: 280, avg: 22, sr: 122, wickets: 0,  economy: 0  },
  },
  Bowler: {
    star:     { runs: 60,  avg: 12, sr: 40,  wickets: 40, economy: 7.2 },
    mid:      { runs: 30,  avg: 8,  sr: 25,  wickets: 26, economy: 8.0 },
    emerging: { runs: 15,  avg: 5,  sr: 18,  wickets: 14, economy: 8.8 },
  },
  "All-Rounder": {
    star:     { runs: 480, avg: 32, sr: 138, wickets: 22, economy: 7.8 },
    mid:      { runs: 280, avg: 24, sr: 126, wickets: 14, economy: 8.4 },
    emerging: { runs: 150, avg: 18, sr: 116, wickets: 8,  economy: 9.2 },
  },
  "Wicket-Keeper": {
    star:     { runs: 650, avg: 38, sr: 144, wickets: 0,  economy: 0  },
    mid:      { runs: 390, avg: 28, sr: 132, wickets: 0,  economy: 0  },
    emerging: { runs: 200, avg: 20, sr: 118, wickets: 0,  economy: 0  },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function normalize(val, max, min = 0) {
  if (max === min) return 0;
  return clamp((val - min) / (max - min), 0, 1);
}

function playerIdOf(entry) {
  return entry?.player?._id?.toString() || entry?.player?.toString() || "";
}

function playerRoleOf(entry) {
  return entry?.player?.role || entry?.role || "Batsman";
}

function collectSkillTags(entry = {}) {
  const name = entry?.player?.name || "";
  // Tags from player_value_profiles.json take precedence over the seeded skills
  const profileTags = pvp.getPlayerTags(name);
  if (profileTags.length > 0) {
    return profileTags.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, "_"));
  }
  // Fallback: use skills stored on the Player document
  const playerSkills = Array.isArray(entry?.player?.skills) ? entry.player.skills : [];
  const entrySkills  = Array.isArray(entry?.skills) ? entry.skills : [];
  return [...playerSkills, ...entrySkills]
    .filter(Boolean)
    .map((skill) => String(skill).trim().toLowerCase().replace(/\s+/g, "_"));
}

function battingPositionHint(entry) {
  // ── 1. best_position from player_value_profiles.json (highest confidence) ──
  const name = entry?.player?.name || "";
  const profile = pvp.getPlayerProfile(name);
  if (profile?.best_position && profile.best_position !== "unknown") {
    const m = /^(\d+)_down$/.exec(profile.best_position);
    if (m) {
      const slot = parseInt(m[1], 10) + 1; // "5_down" → batting slot 6
      if (slot <= 2) return "top-order";
      if (slot <= 4) return "middle-order";
      return "finisher";
    }
  }

  // ── 2. Season batting position fallback ──
  const battingPos =
    entry?.leaguePlayer?.stats2026?.batting?.position ||
    entry?.leaguePlayer?.stats2025?.batting?.position ||
    entry?.leaguePlayer?.stats2024?.batting?.position ||
    entry?.stats2026?.batting?.position ||
    entry?.stats2025?.batting?.position ||
    entry?.stats2024?.batting?.position ||
    0;

  if (battingPos >= 1 && battingPos <= 2) return "top-order";
  if (battingPos >= 3 && battingPos <= 5) return "middle-order";
  if (battingPos >= 6) return "finisher";

  // ── 3. Skill-tag hints ──
  const skills = collectSkillTags(entry);
  if (skills.some((s) => ["opener", "top_order", "powerplay_batter"].includes(s))) return "top-order";
  if (skills.some((s) => ["middle_order", "anchor", "wicket_keeper"].includes(s))) return "middle-order";
  if (skills.some((s) => ["finisher", "power_hitter"].includes(s))) return "finisher";

  // ── 4. Role defaults ──
  const role = playerRoleOf(entry);
  if (role === "Wicket-Keeper") return "middle-order";
  if (role === "All-Rounder") return "middle-order";
  if (role === "Bowler") return "tail";
  return "top-order";
}

function idealPositionRange(entry) {
  const role = playerRoleOf(entry);
  const hint = battingPositionHint(entry);
  const skills = collectSkillTags(entry);

  if (role === "Bowler") {
    if (skills.includes("powerplay_bowler")) return [8, 10];
    if (skills.includes("middle_overs_bowler") || skills.includes("spinner")) return [7, 10];
    if (skills.includes("death_bowler")) return [9, 11];
    return [8, 11];
  }

  if (role === "Wicket-Keeper") {
    if (hint === "finisher") return [5, 7];
    if (hint === "top-order") return [1, 4];
    return [3, 6];
  }

  if (role === "All-Rounder") {
    if (skills.includes("batting_allrounder")) {
      return hint === "finisher" ? [5, 7] : [4, 6];
    }
    if (skills.includes("bowling_allrounder")) return [6, 8];
    return [5, 7];
  }

  if (hint === "top-order") return [1, 3];
  if (hint === "middle-order") return [3, 5];
  if (hint === "finisher") return [5, 7];
  return [2, 4];
}

function positionSuitability(entry, slotNumber) {
  const role = playerRoleOf(entry);
  const [start, end] = idealPositionRange(entry);

  // For non-bowlers, prefer the data-driven position weight from player_value_profiles.json.
  // (The JSON positions map is batting-centric, so bowlers use the heuristic below.)
  if (role !== "Bowler") {
    const name = entry?.player?.name || "";
    const profileWeight = pvp.getPositionMultiplier(name, slotNumber);
    if (profileWeight !== null) {
      const factor = Math.max(0.60, profileWeight);
      const category = factor >= 0.90 ? "ideal" : factor >= 0.75 ? "near" : "mismatch";
      return {
        factor,
        category,
        message: `Position fit at #${slotNumber} (profile weight: ${profileWeight.toFixed(2)})`,
      };
    }
  }

  // ── Heuristic fallback (original logic) ──
  if (slotNumber >= start && slotNumber <= end) {
    return {
      factor: 1,
      category: "ideal",
      message: `Ideal fit at #${slotNumber}`,
    };
  }

  const nearMiss = slotNumber >= start - 1 && slotNumber <= end + 1;
  if (nearMiss) {
    return {
      factor: role === "Bowler" ? 0.95 : 0.9,
      category: "near",
      message: `Slightly off ideal role slot at #${slotNumber}`,
    };
  }

  if (role === "Bowler") {
    return {
      factor: 0.9,
      category: "mismatch",
      message: `Bowler used away from ideal bowling slot at #${slotNumber}`,
    };
  }

  return {
    factor: 0.75,
    category: "mismatch",
    message: `Wrong role fit at #${slotNumber}`,
  };
}

/**
 * Determine reputation tier from basePrice.
 * ≥ 200 lakh → star, ≥ 75 lakh → mid, else → emerging
 */
function reputationTier(basePrice = 0) {
  if (basePrice >= 200) return "star";
  if (basePrice >= 75)  return "mid";
  return "emerging";
}

// ─── 1. Stat Estimation ───────────────────────────────────────────────────────

/**
 * estimateMissingStats — returns a complete flat stats object.
 * Merges real stats (from LeaguePlayer.stats / stats2026 / stats2025 / stats2024) with
 * role-tier defaults wherever data is absent or zero.
 *
 * @param {object} leaguePlayer  — LeaguePlayer document (plain object or mongoose doc)
 * @param {object} player        — Player document (plain object or mongoose doc)
 * @returns {{ totalRuns, totalWickets, battingAverage, strikeRate, economyRate, hasRealStats }}
 */
function estimateMissingStats(leaguePlayer, player) {
  const role      = player?.role || "Batsman";
  const basePrice = leaguePlayer?.basePrice || 0;
  const tier      = reputationTier(basePrice);
  const defaults  = (STAT_DEFAULTS[role] || STAT_DEFAULTS["Batsman"])[tier];

  // Prefer latest-form + historical seasons when available
  const s26 = leaguePlayer?.stats2026 || {};
  const s25 = leaguePlayer?.stats2025 || {};
  const s24 = leaguePlayer?.stats2024 || {};
  const flat = leaguePlayer?.stats || {};

  const runs26     = (s26.batting?.runs      || 0);
  const runs25     = (s25.batting?.runs      || 0);
  const runs24     = (s24.batting?.runs      || 0);
  const wkts26     = (s26.bowling?.wickets   || 0);
  const wkts25     = (s25.bowling?.wickets   || 0);
  const wkts24     = (s24.bowling?.wickets   || 0);
  const avg26      = (s26.batting?.average   || 0);
  const avg25      = (s25.batting?.average   || 0);
  const avg24      = (s24.batting?.average   || 0);
  const sr26       = (s26.batting?.strikeRate|| 0);
  const sr25       = (s25.batting?.strikeRate|| 0);
  const sr24       = (s24.batting?.strikeRate|| 0);
  const eco26      = (s26.bowling?.economy   || 0);
  const eco25      = (s25.bowling?.economy   || 0);
  const eco24      = (s24.bowling?.economy   || 0);

  // Weighted 3-season aggregation (latest form first)
  const weightedAvg =
    avg26 ? (avg26 * 0.55 + (avg25 || avg26) * 0.30 + (avg24 || avg25 || avg26) * 0.15) :
    avg25 ? (avg25 * 0.70 + (avg24 || avg25) * 0.30) :
    avg24 || 0;

  const weightedSR =
    sr26 ? (sr26 * 0.55 + (sr25 || sr26) * 0.30 + (sr24 || sr25 || sr26) * 0.15) :
    sr25 ? (sr25 * 0.70 + (sr24 || sr25) * 0.30) :
    sr24 || 0;

  const weightedEco =
    eco26 ? (eco26 * 0.55 + (eco25 || eco26) * 0.30 + (eco24 || eco25 || eco26) * 0.15) :
    eco25 ? (eco25 * 0.70 + (eco24 || eco25) * 0.30) :
    eco24 || 0;

  const totalRuns    = runs26 + runs25 + runs24 || flat.runs || 0;
  const totalWickets = wkts26 + wkts25 + wkts24 || flat.wickets || 0;

  const hasReal = totalRuns > 0 || totalWickets > 0;

  return {
    totalRuns:      hasReal ? totalRuns      : defaults.runs,
    totalWickets:   hasReal ? totalWickets   : defaults.wickets,
    battingAverage: hasReal && weightedAvg   ? weightedAvg  : (flat.average    || defaults.avg),
    strikeRate:     hasReal && weightedSR    ? weightedSR   : (flat.strikeRate  || defaults.sr),
    economyRate:    hasReal && weightedEco   ? weightedEco  : (flat.economy     || defaults.economy || 8.5),
    hasRealStats:   hasReal,
    // Per-year breakdown (used for consistency calc)
    yearA: {
      runs: runs26 || runs25 || defaults.runs * 0.55,
      wickets: wkts26 || wkts25 || defaults.wickets * 0.55,
      average: avg26 || avg25 || defaults.avg,
      strikeRate: sr26 || sr25 || defaults.sr,
      economy: eco26 || eco25 || defaults.economy || 8.5,
    },
    yearB: {
      runs: runs25 || runs24 || defaults.runs * 0.45,
      wickets: wkts25 || wkts24 || defaults.wickets * 0.45,
      average: avg25 || avg24 || defaults.avg,
      strikeRate: sr25 || sr24 || defaults.sr,
      economy: eco25 || eco24 || defaults.economy || 8.5,
    },
  };
}

// ─── 2. Rating Calculation ────────────────────────────────────────────────────

/**
 * calculateRating — core stat → score transformer.
 *
 * battingScore  = (avg/avgMax × 0.4) + (sr/srMax × 0.3) + (runs/runsMax × 0.3)  → 0–100
 * bowlingScore  = (wkts/wktsMax × 0.4) + (ecoFactor × 0.3) + (impactFactor × 0.3) → 0–100
 * overallRating = weighted combo based on role
 */
function calculateRating(stats, role) {
  const { totalRuns, totalWickets, battingAverage, strikeRate, economyRate } = stats;

  // Batting score (0–100)
  const avgNorm     = normalize(battingAverage, NORM.AVG_MAX);
  const srNorm      = normalize(strikeRate, NORM.SR_MAX, 60);
  const runsNorm    = normalize(totalRuns, NORM.RUNS_MAX);
  const battingScore = clamp(
    (avgNorm * 0.4 + srNorm * 0.3 + runsNorm * 0.3) * 100,
    0, 100
  );

  // Bowling score (0–100)
  const wktsNorm    = normalize(totalWickets, NORM.WICKETS_MAX);
  // Economy factor: lower economy → higher score
  const ecoClamp    = clamp(economyRate, NORM.ECONOMY_MIN, NORM.ECONOMY_MAX);
  const ecoFactor   = 1 - normalize(ecoClamp, NORM.ECONOMY_MAX, NORM.ECONOMY_MIN);
  // Impact factor: wickets per match proxy = wickets/20 capped at 1
  const impactFactor = clamp(totalWickets / 30, 0, 1);
  const bowlingScore = clamp(
    (wktsNorm * 0.4 + ecoFactor * 0.3 + impactFactor * 0.3) * 100,
    0, 100
  );

  // Role weights
  let batWeight, bowlWeight;
  switch (role) {
    case "Bowler":
      batWeight = 0.2; bowlWeight = 0.8; break;
    case "All-Rounder":
      batWeight = 0.5; bowlWeight = 0.5; break;
    case "Wicket-Keeper":
      batWeight = 0.75; bowlWeight = 0.25; break;
    default: // Batsman
      batWeight = 0.8; bowlWeight = 0.2;
  }

  const overallRating = clamp(
    battingScore * batWeight + bowlingScore * bowlWeight,
    0, 100
  );

  return {
    battingScore:  Math.round(battingScore  * 10) / 10,
    bowlingScore:  Math.round(bowlingScore  * 10) / 10,
    overallRating: Math.round(overallRating * 10) / 10,
  };
}

// ─── 3. Role Classification ───────────────────────────────────────────────────

/**
 * classifyRole — derive role from computed scores when original is missing.
 * Respects existing WK tag; otherwise infers from score gap.
 */
function classifyRole(player, battingScore, bowlingScore) {
  if (player?.role === "Wicket-Keeper") return "Wicket-Keeper";
  const gap = Math.abs(battingScore - bowlingScore);
  if (gap < 15) return "All-Rounder";
  return battingScore > bowlingScore ? "Batsman" : "Bowler";
}

// ─── 4. Consistency Calculation ───────────────────────────────────────────────

/**
 * calculateConsistency — 0 to 1 score using 2-year variance.
 *
 * consistency = 1 - (stdDev / mean)
 * Safe-guarded against division by zero.
 */
function calculateConsistency(yearA, yearB, role) {
  const metrics = [];

  if (role === "Batsman" || role === "Wicket-Keeper" || role === "All-Rounder") {
    const runsA = yearA.runs || 0;
    const runsB = yearB.runs || 0;
    const meanRuns = (runsA + runsB) / 2;
    if (meanRuns > 0) {
      const stdRuns = Math.sqrt(((runsA - meanRuns) ** 2 + (runsB - meanRuns) ** 2) / 2);
      metrics.push(clamp(1 - stdRuns / meanRuns, 0, 1));
    }
    const srA = yearA.strikeRate || 0;
    const srB = yearB.strikeRate || 0;
    const meanSR = (srA + srB) / 2;
    if (meanSR > 0) {
      const stdSR = Math.sqrt(((srA - meanSR) ** 2 + (srB - meanSR) ** 2) / 2);
      metrics.push(clamp(1 - stdSR / meanSR, 0, 1));
    }
  }

  if (role === "Bowler" || role === "All-Rounder") {
    const wkA = yearA.wickets || 0;
    const wkB = yearB.wickets || 0;
    const meanWk = (wkA + wkB) / 2;
    if (meanWk > 0) {
      const stdWk = Math.sqrt(((wkA - meanWk) ** 2 + (wkB - meanWk) ** 2) / 2);
      metrics.push(clamp(1 - stdWk / meanWk, 0, 1));
    }
    const ecoA = yearA.economy || 8.5;
    const ecoB = yearB.economy || 8.5;
    const meanEco = (ecoA + ecoB) / 2;
    if (meanEco > 0) {
      const stdEco = Math.sqrt(((ecoA - meanEco) ** 2 + (ecoB - meanEco) ** 2) / 2);
      // For economy, lower variance = higher consistency
      metrics.push(clamp(1 - stdEco / meanEco, 0, 1));
    }
  }

  if (metrics.length === 0) return 0.6; // default mid-consistency
  const avg = metrics.reduce((s, v) => s + v, 0) / metrics.length;
  return Math.round(avg * 100) / 100;
}

// ─── 5. Fairplay Score ────────────────────────────────────────────────────────

/**
 * calculateFairPlay (0–10) — based on discipline metrics.
 *
 * Components:
 *  - consistency contribution    (0–4 pts)
 *  - economy discipline          (0–3 pts, bowlers/AR only)
 *  - strike discipline           (0–3 pts, batters/WK only)
 *  - role contribution (all)     (0–3 pts)
 */
function calculateFairPlay(stats, ratings, consistency, role) {
  let score = 0;

  // Consistency contribution (0–4)
  score += clamp(consistency * 4, 0, 4);

  if (role === "Bowler" || role === "All-Rounder") {
    // Economy discipline: economy ≤ 7 → 3 pts, scales down
    const eco = stats.economyRate || 9;
    const ecoScore = clamp(3 * (1 - (eco - 7) / 5), 0, 3);
    score += ecoScore;
  }

  if (role === "Batsman" || role === "Wicket-Keeper" || role === "All-Rounder") {
    // Strike discipline: SR 130–160 is ideal T20 zone
    const sr = stats.strikeRate || 120;
    const idealSR = 145;
    const srDev = Math.abs(sr - idealSR);
    const srScore = clamp(3 * (1 - srDev / 70), 0, 3);
    score += srScore;
  }

  // Role contribution: overallRating/100 × 3
  score += clamp((ratings.overallRating / 100) * 3, 0, 3);

  return Math.round(clamp(score, 0, 10) * 10) / 10;
}

// ─── 6. Match Point Simulation ────────────────────────────────────────────────

/**
 * simulatePlayerPoints — stat-driven point simulation with controlled randomness.
 *
 * basePoints = overallRating × 1.2
 * variance   = (1 - consistency) × seededRandom(-0.2, +0.2)
 * finalPoints = basePoints × (1 + variance) × roleMultiplier × fatigueMultiplier
 *
 * Role multipliers apply impact bonuses per role archetype.
 *
 * @param {object} ratingData — { battingScore, bowlingScore, overallRating, consistency, fairPlayScore, stats, role }
 * @param {number} fatigue     — 0 to 1 (fatigue accumulation; 0.05 per match)
 * @param {string} captainRole — "captain" | "vice-captain" | null
 * @returns {{ basePoints, finalPoints, roleBonus, fatigueMultiplier, variance }}
 */
function simulatePlayerPoints(ratingData, fatigue = 0, captainRole = null) {
  const { overallRating, consistency, battingScore, bowlingScore, role, fairPlayScore } = ratingData;

  const base = overallRating * 1.2;

  // Seeded pseudo-randomness: deterministic per match but still varied.
  // Use a simple LCG seeded on overallRating + consistency to ensure
  // same player always gets same "luck" within a session.
  const seed    = Math.floor(overallRating * 100 + consistency * 1000);
  const pseudo  = ((seed * 1664525 + 1013904223) & 0xffffffff) / 0xffffffff;
  const randDir = (pseudo - 0.5) * 2; // -1 to +1

  const varFactor   = (1 - consistency) * randDir * 0.2; // ±20% max
  const roleBonus   = _roleBonus(battingScore, bowlingScore, role);
  const fatigueMultiplier = clamp(1 - fatigue, 0.5, 1.0);

  let pts = base * (1 + varFactor) * roleBonus * fatigueMultiplier;

  // Fair play micro-bonus
  pts += (fairPlayScore || 0) * 0.3;

  // Captain / VC multiplier
  if (captainRole === "captain") pts *= 2.0;
  else if (captainRole === "vice-captain") pts *= 1.5;

  return {
    basePoints:         Math.round(base * 10) / 10,
    finalPoints:        Math.round(pts * 10) / 10,
    roleBonus:          Math.round(roleBonus * 100) / 100,
    fatigueMultiplier:  Math.round(fatigueMultiplier * 100) / 100,
    variance:           Math.round(varFactor * 100) / 100,
  };
}

function _roleBonus(battingScore, bowlingScore, role) {
  switch (role) {
    case "Batsman": {
      // Runs + high strike rate bonus
      const strikeBonus = battingScore >= 70 ? 1.12 : battingScore >= 50 ? 1.06 : 1.0;
      return strikeBonus;
    }
    case "Bowler": {
      // Wickets + economy bonus
      const ecoBonus = bowlingScore >= 70 ? 1.12 : bowlingScore >= 50 ? 1.06 : 1.0;
      return ecoBonus;
    }
    case "All-Rounder":
      // Both skill bonus (+10%)
      return 1.10;
    case "Wicket-Keeper":
      // Catches + stumpings simulated as flat bonus
      return 1.08;
    default:
      return 1.0;
  }
}

// ─── 7. Auction Value System ──────────────────────────────────────────────────

/**
 * calculateValueScore — internal only; NOT exposed to client directly.
 *
 * valueScore = overallRating / (price / 100)   [normalized by 1 cr base]
 * Label: > 1.5 → "High Value Pick", 1–1.5 → "Balanced Pick", < 1 → "Overpriced"
 */
function calculateValueScore(overallRating, priceInLakhs) {
  if (!priceInLakhs || priceInLakhs <= 0) {
    return { valueScore: null, label: "Unpriced" };
  }
  const crores = priceInLakhs / 100;
  const vs = parseFloat((overallRating / crores).toFixed(2));
  let label;
  if (vs > 1.5)       label = "High Value Pick";
  else if (vs >= 1.0) label = "Balanced Pick";
  else                label = "Overpriced";
  return { valueScore: vs, label };
}

// ─── 8. Team Validation ───────────────────────────────────────────────────────

/**
 * validateTeam — checks squad against role minimums.
 *
 * Returns:
 *  { isValid, penalties, penaltyTotal, warnings, roleCounts }
 *
 * Penalties:
 *  - No WK            → -30% of strength
 *  - No All-Rounder   → -15%
 *  - Role imbalance   → -5% per missing
 */
function validateTeam(squadEntries) {
  const roleCounts = {
    Batsman: 0,
    Bowler: 0,
    "All-Rounder": 0,
    "Wicket-Keeper": 0,
  };

  for (const entry of squadEntries) {
    const role = entry?.player?.role || entry?.role || "Batsman";
    if (roleCounts.hasOwnProperty(role)) roleCounts[role]++;
  }

  const penalties = [];
  let penaltyTotal = 0;
  const warnings = [];

  if (roleCounts["Wicket-Keeper"] < SQUAD_MIN["Wicket-Keeper"]) {
    penalties.push({ type: "NO_WICKETKEEPER", factor: 0.30, message: "No Wicket-Keeper — heavy penalty" });
    penaltyTotal += 0.30;
  }
  if (roleCounts["All-Rounder"] < SQUAD_MIN["All-Rounder"]) {
    penalties.push({ type: "NO_ALLROUNDER", factor: 0.15, message: "No All-Rounder — medium penalty" });
    penaltyTotal += 0.15;
  }
  if (roleCounts["Batsman"] < SQUAD_MIN["Batsman"]) {
    const missing = SQUAD_MIN["Batsman"] - roleCounts["Batsman"];
    penalties.push({ type: "INSUFFICIENT_BATSMEN", factor: 0.05 * missing, message: `Insufficient Batsmen (${roleCounts["Batsman"]} / ${SQUAD_MIN["Batsman"]})` });
    penaltyTotal += 0.05 * missing;
  }
  if (roleCounts["Bowler"] < SQUAD_MIN["Bowler"]) {
    const missing = SQUAD_MIN["Bowler"] - roleCounts["Bowler"];
    penalties.push({ type: "INSUFFICIENT_BOWLERS", factor: 0.05 * missing, message: `Insufficient Bowlers (${roleCounts["Bowler"]} / ${SQUAD_MIN["Bowler"]})` });
    penaltyTotal += 0.05 * missing;
  }

  // Warning: not enough total players
  if (squadEntries.length < 11) {
    warnings.push("Squad has fewer than 11 — cannot form a Playing XI");
  }

  const isValid = penalties.length === 0 && squadEntries.length >= 11;

  return {
    isValid,
    penalties,
    penaltyTotal: Math.min(penaltyTotal, 0.60), // cap at 60%
    warnings,
    roleCounts,
  };
}

function getPositionLabel(slotNumber) {
  if (slotNumber <= 2) return "Opener";
  if (slotNumber === 3) return "One-down";
  if (slotNumber <= 5) return "Middle Order";
  if (slotNumber <= 7) return "Finisher";
  return "Lower Order";
}

function validatePlayingXI(playingXI, playersPerTeam = 11) {
  const roleCounts = {
    Batsman: 0,
    Bowler: 0,
    "All-Rounder": 0,
    "Wicket-Keeper": 0,
  };

  let overseasCount = 0;
  let positionPenaltyTotal = 0;
  const penalties = [];
  const warnings = [];
  const positions = [];

  for (let index = 0; index < playingXI.length; index++) {
    const entry = playingXI[index];
    const role = playerRoleOf(entry);
    if (roleCounts.hasOwnProperty(role)) roleCounts[role]++;
    if (entry?.player?.isOverseas || entry?.isOverseas) overseasCount++;

    const slotNumber = index + 1;
    const fit = positionSuitability(entry, slotNumber);
    positions.push({
      playerId: playerIdOf(entry),
      name: entry?.player?.name || "Unknown Player",
      role,
      slot: slotNumber,
      idealRange: idealPositionRange(entry),
      fit: fit.category,
      factor: fit.factor,
      message: fit.message,
    });
    positionPenaltyTotal += 1 - fit.factor;
  }

  if (playingXI.length !== 11) {
    warnings.push("Playing XI must contain exactly 11 players");
  }

  if (overseasCount > getOverseasLimit(11)) {
    penalties.push({
      type: "TOO_MANY_OVERSEAS_XI",
      factor: 0.2 + (overseasCount - getOverseasLimit(11)) * 0.05,
      message: `Playing XI has ${overseasCount} overseas players. Max allowed is 4.`,
    });
  }

  // Role checks are now hints/warnings, not penalties
  for (const [role, min] of Object.entries(XI_MIN)) {
    if ((roleCounts[role] || 0) < min) {
      const missing = min - (roleCounts[role] || 0);
      warnings.push(`Hint: Need ${missing} more ${role} (${roleCounts[role] || 0}/${min})`);
    }
  }

  const overloadedRoles = Object.entries(roleCounts)
    .filter(([role, count]) => (role === "Batsman" && count >= 6) || (role === "Bowler" && count >= 5));
  for (const [role, count] of overloadedRoles) {
    warnings.push(`Hint: ${role} heavy XI (${count}) — consider more balance`);
  }

  const hardMismatchCount = positions.filter((p) => p.fit === "mismatch").length;
  if (hardMismatchCount > 0) {
    warnings.push(`${hardMismatchCount} player(s) deployed away from ideal positions`);
  }

  const penaltyTotal = Math.min(
    0.65,
    penalties.reduce((sum, penalty) => sum + (penalty.factor || 0), 0)
  );

  return {
    isValid: penalties.length === 0 && playingXI.length === 11,
    penalties,
    penaltyTotal,
    warnings,
    roleCounts,
    overseasCount,
    positions,
  };
}

// ─── 9. Playing XI Selection ──────────────────────────────────────────────────

/**
 * selectBestXI — greedy role-balanced selection.
 *
 * Algorithm:
 *  1. Fill mandatory minimums first (1 WK, 3 bat, 3 bowl, 1 AR)
 *  2. Fill remaining 3 spots with highest-rated available players.
 *
 * @param {Array}  squadEntries  — squad entries (with player + ratingData attached)
 * @returns {Array} bestXI       — 11 entries sorted by overallRating desc
 */
function selectBestXI(squadEntries) {
  if (squadEntries.length === 0) return [];

  const byRole = {
    "Wicket-Keeper": [],
    "Batsman": [],
    "Bowler": [],
    "All-Rounder": [],
  };

  for (const entry of squadEntries) {
    const role = entry?.player?.role || entry?.role || "Batsman";
    const bucket = byRole[role] || byRole["Batsman"];
    bucket.push(entry);
  }

  // Sort each bucket by overallRating desc
  for (const role of Object.keys(byRole)) {
    byRole[role].sort((a, b) => (b.ratingData?.overallRating || 0) - (a.ratingData?.overallRating || 0));
  }

  const selected = [];
  const used     = new Set();

  function pick(role, count) {
    let picked = 0;
    for (const entry of byRole[role]) {
      const id = entry?.player?._id?.toString() || entry?.player?.toString();
      if (!used.has(id) && picked < count) {
        selected.push(entry);
        used.add(id);
        picked++;
      }
    }
  }

  pick("Wicket-Keeper", 1);
  pick("Batsman", 3);
  pick("Bowler",  3);
  pick("All-Rounder", 1);

  // Fill remaining spots from all roles by rating
  const remaining = squadEntries
    .filter((e) => !used.has(e?.player?._id?.toString() || e?.player?.toString()))
    .sort((a, b) => (b.ratingData?.overallRating || 0) - (a.ratingData?.overallRating || 0));

  for (const entry of remaining) {
    if (selected.length >= 11) break;
    selected.push(entry);
    used.add(entry?.player?._id?.toString() || entry?.player?.toString());
  }

  return selected.slice(0, 11);
}

// ─── 10. Team Strength Calculation ────────────────────────────────────────────

/**
 * calculateTeamStrength — Dream11-style fantasy point system.
 *
 * Uses the actual fairPoint (FP) from LeaguePlayer (the value shown in auction UI).
 * This produces high, meaningful totals (~400–800+ for a full XI).
 *
 * Formula per player:
 *   fantasyPts = FP × captainMultiplier × positionFit × (1 - fatigue)
 *
 * Total = sum(fantasyPts) × compositionFactor
 *
 * Composition penalties (% reduction on total):
 *   • No Wicket-Keeper in XI:     -10%
 *   • No Bowler at all (0):       -20%
 *   • Only 1 Bowler:              -10%
 *   • No All-Rounder:             -5%
 *   • >7 of any single role:      -15% (absurd team)
 *   • >4 overseas in XI:          -20% + 5% per extra
 *   (penalties stack multiplicatively, capped at 50% max reduction)
 *
 * @param {object} params
 * @param {Array}  params.squadEntries    — full squad (each entry has ratingData attached)
 * @param {Array}  params.playingXI       — 11 entry objects
 * @param {string} params.captainId       — player _id string
 * @param {string} params.viceCaptainId   — player _id string
 * @param {number} params.playersPerTeam  — 11 | 15 | 25
 * @param {object} params.fatigueMap      — { playerId: fatigueValue }
 * @returns {object} strength breakdown
 */
function calculateTeamStrength({
  squadEntries,
  playingXI,
  captainId,
  viceCaptainId,
  playersPerTeam = 11,
  fatigueMap = {},
}) {
  if (!playingXI || playingXI.length === 0) {
    if (squadEntries.length >= 11) {
      playingXI = selectBestXI(squadEntries);
    } else {
      playingXI = [...squadEntries];
    }
  }

  const xiValidation = validatePlayingXI(playingXI, playersPerTeam);

  // ── A) Sum each player's actual FP (fair points from auction) ──
  let playingXIPoints = 0;
  const xiPointsBreakdown = [];

  for (let index = 0; index < playingXI.length; index++) {
    const entry = playingXI[index];
    const pid = playerIdOf(entry);
    const rd   = entry?.ratingData;
    if (!rd) continue;

    // Use actual fairPoint from LeaguePlayer → falls back to overallRating
    const baseFP = rd.fairPoint || rd.overallRating || 10;
    // Apply a gentle phase & style strength multiplier from player_value_profiles.json.
    // Clamped to [0.80, 1.20] so no single player dominates the team score.
    const contextMult = pvp.getContextMultiplier(entry?.player?.name || "");
    let playerPoints = baseFP * contextMult;

    // Captain 2×, VC 1.5×
    const captainRole = pid === captainId ? "captain" : pid === viceCaptainId ? "vice-captain" : null;
    if (captainRole === "captain") playerPoints *= 2.0;
    else if (captainRole === "vice-captain") playerPoints *= 1.5;

    // Position suitability factor (reduces if not in ideal slot)
    const fit = xiValidation.positions[index] || positionSuitability(entry, index + 1);
    playerPoints *= (fit.factor || 1);

    // Fatigue reduction
    const fatigue = fatigueMap[pid] || 0;
    playerPoints *= clamp(1 - fatigue, 0.5, 1.0);

    playingXIPoints += playerPoints;
    xiPointsBreakdown.push({
      name: entry?.player?.name || pid,
      slot: index + 1,
      positionLabel: getPositionLabel(index + 1),
      baseFP: Math.round(baseFP * 10) / 10,
      finalPoints: Math.round(playerPoints * 10) / 10,
      positionFit: fit.fit || fit.category,
      positionFactor: fit.factor || 1,
      captainRole,
    });
  }

  // ── B) Composition penalties (Dream11-style: weird teams get punished) ──
  const xiRoles = xiValidation.roleCounts;
  const compositionPenalties = [];
  let compositionReduction = 0;

  if ((xiRoles["Wicket-Keeper"] || 0) === 0) {
    compositionPenalties.push({ type: "NO_WK", pct: 10, message: "No Wicket-Keeper in XI (-10%)" });
    compositionReduction += 10;
  }
  if ((xiRoles["Bowler"] || 0) === 0) {
    compositionPenalties.push({ type: "NO_BOWLER", pct: 20, message: "No Bowler in XI (-20%)" });
    compositionReduction += 20;
  } else if ((xiRoles["Bowler"] || 0) === 1) {
    compositionPenalties.push({ type: "LOW_BOWLER", pct: 10, message: "Only 1 Bowler in XI (-10%)" });
    compositionReduction += 10;
  }
  if ((xiRoles["All-Rounder"] || 0) === 0) {
    compositionPenalties.push({ type: "NO_AR", pct: 5, message: "No All-Rounder in XI (-5%)" });
    compositionReduction += 5;
  }
  if ((xiRoles["Batsman"] || 0) === 0) {
    compositionPenalties.push({ type: "NO_BAT", pct: 15, message: "No Batsman in XI (-15%)" });
    compositionReduction += 15;
  }
  for (const [role, count] of Object.entries(xiRoles)) {
    if (count >= 8) {
      compositionPenalties.push({ type: `OVERLOAD_${role}`, pct: 15, message: `${role} overload (${count}) (-15%)` });
      compositionReduction += 15;
    }
  }

  // Overseas penalty
  const osLimit = getOverseasLimit(11);
  if (xiValidation.overseasCount > osLimit) {
    const osPct = 20 + (xiValidation.overseasCount - osLimit) * 5;
    compositionPenalties.push({ type: "OVERSEAS", pct: osPct, message: `${xiValidation.overseasCount} overseas in XI (max ${osLimit}) (-${osPct}%)` });
    compositionReduction += osPct;
  }

  // Cap total reduction at 50%
  compositionReduction = Math.min(compositionReduction, 50);
  const compositionFactor = (100 - compositionReduction) / 100;

  // ── C) Team fairplay average (informational) ──
  const teamFairplay = squadEntries.length > 0
    ? squadEntries.reduce((s, e) => s + (e?.ratingData?.fairPlayScore || 0), 0) / squadEntries.length
    : 0;

  // ── D) Validation info ──
  const validation = validateTeam(squadEntries);
  const { roleCounts } = validation;

  // ── E) Total = sum of FP points × composition factor ──
  const total = Math.round(playingXIPoints * compositionFactor * 10) / 10;
  const squadHealth = buildSquadHealth({
    squadEntries,
    playingXI,
    baseTotal: total,
  });

  return {
    total,
    playingXIPoints:      Math.round(playingXIPoints * 10) / 10,
    compositionFactor:    Math.round(compositionFactor * 100) / 100,
    compositionPenalties,
    compositionReduction,
    teamFairplay:         Math.round(teamFairplay * 10) / 10,
    // Kept for backward compat (frontend may reference these)
    penaltyFactor:        Math.round(compositionFactor * 100) / 100,
    penalties:            compositionPenalties,
    warnings:             [...validation.warnings, ...xiValidation.warnings],
    roleCounts,
    xiRoleCounts:         xiValidation.roleCounts,
    overseasInXI:         xiValidation.overseasCount,
    positionBreakdown:    xiValidation.positions,
    xiBreakdown:          xiPointsBreakdown,
    squadHealth,
  };
}

// ─── 11. Fatigue system ───────────────────────────────────────────────────────

/**
 * applyFatigue — increments per-player fatigue after a match.
 * @param {object} fatigueMap   — mutable { playerId: value }
 * @param {Array}  playingXIIds — player ids who played
 * @returns updated fatigueMap
 */
function applyFatigue(fatigueMap = {}, playingXIIds = []) {
  const updated = { ...fatigueMap };
  for (const id of playingXIIds) {
    updated[id] = clamp((updated[id] || 0) + 0.05, 0, 0.5); // max 50% performance loss
  }
  return updated;
}

// ─── 12. Injury System ───────────────────────────────────────────────────────

/**
 * rollInjury — small probability a player is injured this match.
 * Probability scales with fatigue (tired players injure more).
 *
 * @param {string} playerId
 * @param {number} fatigue     — 0 to 0.5
 * @returns {boolean} isInjured
 */
function rollInjury(playerId, fatigue = 0) {
  const BASE_INJURY_CHANCE = 0.03; // 3% base per match
  const chance = BASE_INJURY_CHANCE + fatigue * 0.10; // up to 8% at max fatigue
  // Deterministic seed for reproducibility within a match
  const seed = (playerId || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  // LCG pseudo-random using regular Number math (same pattern as simulatePlayerPoints)
  const pseudo = ((seed * 1664525 + 1013904223) & 0xffffffff) / 0xffffffff;
  // Use current time modulo to vary across matches
  const timeVariance = (Date.now() % 1000) / 1000;
  return (pseudo + timeVariance) % 1 < chance;
}

// ─── 13. Full Player Profile Builder ─────────────────────────────────────────

/**
 * buildPlayerProfile — single entry-point used by the rest of the app.
 *
 * Combines all the above:
 *   estimateMissingStats → calculateRating → calculateConsistency → calculateFairPlay → classifyRole → valueScore
 *
 * @param {object} leaguePlayer  — LeaguePlayer doc (plain)
 * @param {object} player        — Player doc (plain)
 * @param {number} soldPrice     — price paid at auction (lakhs)
 * @returns {object} ratingData
 */
function buildPlayerProfile(leaguePlayer, player, soldPrice = 0) {
  const role   = player?.role || leaguePlayer?.player?.role || "Batsman";
  const stats  = estimateMissingStats(leaguePlayer, player);
  const ratings = calculateRating(stats, role);

  const consistency  = calculateConsistency(stats.yearA, stats.yearB, role);
  const fairPlayScore = calculateFairPlay(stats, ratings, consistency, role);
  const { label: valueLabel } = calculateValueScore(ratings.overallRating, soldPrice || leaguePlayer?.basePrice);

  // Use the actual fairPoint from LeaguePlayer (the FP shown in auction UI).
  // If missing or zero, fall back to final_player_value from player_value_profiles.json
  // (same 0-100 scale), and finally to 0.
  const profileFV = pvp.getPlayerFinalValue(player?.name || "");
  const fairPoint = leaguePlayer?.fairPoint || (profileFV !== null ? profileFV : 0);

  return {
    // Core ratings
    battingScore:  ratings.battingScore,
    bowlingScore:  ratings.bowlingScore,
    overallRating: ratings.overallRating,
    // The real FP value from the auction (5-100 scale)
    fairPoint,
    context: buildPlayerContext(player, {
      ...leaguePlayer,
      fairPoint,
      stats2026: leaguePlayer?.stats2026,
      stats2024: leaguePlayer?.stats2024,
      stats2025: leaguePlayer?.stats2025,
      stats: leaguePlayer?.stats,
    }),
    // Meta
    consistency,
    fairPlayScore,
    valueLabel,
    role,
    // Underlying stats used (real or estimated)
    stats: {
      totalRuns:      stats.totalRuns,
      totalWickets:   stats.totalWickets,
      battingAverage: stats.battingAverage,
      strikeRate:     stats.strikeRate,
      economyRate:    stats.economyRate,
      hasRealStats:   stats.hasRealStats,
    },
  };
}

/**
 * buildSquadProfiles — bulk-builds profiles for all squad entries.
 * Attaches ratingData to each entry.
 *
 * @param {Array} squadEntries  — array of squad entries (each has .player and .leaguePlayer populated or embedded)
 * @returns {Array} entries with ratingData attached
 */
function buildSquadProfiles(squadEntries) {
  return squadEntries.map((entry) => {
    // Convert Mongoose subdocuments to plain objects so spread works correctly.
    // Without this, { ...mongooseDoc } loses data fields (player, price, etc.)
    // because they live behind prototype getters, not as own enumerable props.
    const plain = typeof entry?.toObject === "function" ? entry.toObject() : (entry || {});
    const player       = plain.player || {};
    const leaguePlayer = plain.leaguePlayer || {};
    const soldPrice    = plain.price || 0;
    const ratingData   = buildPlayerProfile(leaguePlayer, player, soldPrice);
    return { ...plain, ratingData };
  });
}

// ─── 14. Overseas Limit ───────────────────────────────────────────────────────

/**
 * getOverseasLimit — derive limit from playersPerTeam config.
 */
function getOverseasLimit(playersPerTeam) {
  return OVERSEAS_LIMITS[playersPerTeam] || OVERSEAS_LIMITS[11];
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Core functions
  estimateMissingStats,
  calculateRating,
  classifyRole,
  calculateConsistency,
  calculateFairPlay,
  simulatePlayerPoints,
  calculateValueScore,
  validateTeam,
  validatePlayingXI,
  selectBestXI,
  calculateTeamStrength,
  applyFatigue,
  rollInjury,
  // High-level helpers
  buildPlayerProfile,
  buildSquadProfiles,
  getOverseasLimit,
  // Constants (exported for use in validation layers)
  OVERSEAS_LIMITS,
  SQUAD_MIN,
};
