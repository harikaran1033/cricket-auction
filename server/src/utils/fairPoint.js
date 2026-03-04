/**
 * Fair Point Rating System
 * ─────────────────────────
 * Weight: 70% from 2025 (current) + 30% from 2024 (history).
 * Fresh Player Rule: If 2024 data missing → 0.8x damping factor.
 * Role Normalization: Separate scores for Batting & Bowling, merged for All-Rounders.
 *
 * Batting Score (BS):
 *   BS = (Average × 0.4) + (StrikeRate × 0.6) + (Runs / Matches × 0.2)
 *
 * Bowling Score (QS):
 *   QS = (Wickets × 10) + (20 / Economy × 5) + (Matches / StrikeRate × 2)
 *
 * All-Rounder Synergy (AS):
 *   AS = (BS + QS) × 1.15
 *
 * Final Fair Point is min-max normalized to 0–100 scale.
 */

const WEIGHT_CURRENT = 0.7; // 2025
const WEIGHT_HISTORY = 0.3; // 2024
const DAMPING_FACTOR = 0.9; // for fresh players (no 2024 data)

/**
 * Compute Batting Score from season stats.
 */
function battingScore(batting) {
  if (!batting || !batting.matches || batting.matches === 0) return 0;
  const avg = batting.average || 0;
  const sr = batting.strikeRate || 0;
  const runsPerMatch = batting.runs / batting.matches;
  const runs = batting.runs
  return avg * 0.4 + sr * 0.6 + runs * 0.2 + runsPerMatch * 0.2;
}

/**
 * Compute Bowling Score from season stats.
 */
function bowlingScore(bowling) {
  if (!bowling || !bowling.matches || bowling.matches === 0) return 0;
  const wickets = bowling.wickets || 0;
  const economy = bowling.economy || 999;
  const sr = bowling.strikeRate || 999;
  const matches = bowling.matches;
  return wickets * 10 + (20 / economy) * 5 + (matches / sr) * 2;
}

/**
 * Compute raw (un-normalized) fair point for a player.
 * Returns a raw score; call normalizeFairPoints() for 0-100 scaling.
 *
 * @param {string} role - "Batsman" | "Bowler" | "All-Rounder" | "Wicket-Keeper"
 * @param {object} stats2025 - { batting: {...}, bowling: {...} }
 * @param {object} stats2024 - { batting: {...}, bowling: {...} }
 * @returns {number} raw fairPoint
 */
function calculateRawFairPoint(role, stats2025, stats2024) {
  const s25 = stats2025 || {};
  const s24 = stats2024 || {};

  let score2025 = 0;
  let score2024 = 0;
  let has2024 = false;

  if (role === "Batsman" || role === "Wicket-Keeper") {
    score2025 = battingScore(s25.batting);
    if (s24.batting && s24.batting.matches > 0) {
      score2024 = battingScore(s24.batting);
      has2024 = true;
    }
  } else if (role === "Bowler") {
    score2025 = bowlingScore(s25.bowling);
    if (s24.bowling && s24.bowling.matches > 0) {
      score2024 = bowlingScore(s24.bowling);
      has2024 = true;
    }
  } else if (role === "All-Rounder") {
    const bs25 = battingScore(s25.batting);
    const qs25 = bowlingScore(s25.bowling);
    // Weighted Best: 100% of better skill + 40% of secondary skill
    score2025 = Math.max(bs25, qs25) + Math.min(bs25, qs25) * 0.4;

    if (has2024) {
      const bs24 = battingScore(s24.batting);
      const qs24 = bowlingScore(s24.bowling);
      score2024 = Math.max(bs24, qs24) + Math.min(bs24, qs24) * 0.4;
    }
  }

  let raw;
  if (has2024) {
    raw = score2025 * WEIGHT_CURRENT + score2024 * WEIGHT_HISTORY;
  } else {
    raw = score2025 * DAMPING_FACTOR;
  }

  return Math.round(raw * 100) / 100;
}

/**
 * Normalize an array of raw scores to 0-100 using min-max scaling.
 * Players with raw score 0 stay at 0.
 *
 * @param {number[]} rawScores
 * @returns {number[]} normalized scores (0-100)
 */
function normalizeTo100(rawScores) {
  const nonZero = rawScores.filter((s) => s > 0);
  if (nonZero.length === 0) return rawScores.map(() => 0);

  const min = Math.min(...nonZero);
  const max = Math.max(...nonZero);
  const range = max - min || 1; // avoid div by 0

  return rawScores.map((s) => {
    if (s <= 0) return 0;
    // Scale to 5-100 (so even the lowest active player gets at least 5)
    return Math.round((((s - min) / range) * 95 + 5) * 10) / 10;
  });
}

// Backward compat alias
function calculateFairPoint(role, stats2025, stats2024) {
  return calculateRawFairPoint(role, stats2025, stats2024);
}

module.exports = {
  calculateFairPoint,
  calculateRawFairPoint,
  normalizeTo100,
  battingScore,
  bowlingScore,
};
