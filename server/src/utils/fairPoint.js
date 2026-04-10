/**
 * Fair Point Rating System
 * ─────────────────────────
 * Season weights (latest form biased):
 *   2026/current form: 0.55
 *   2025:              0.30
 *   2024:              0.15
 *
 * If some seasons are missing, available seasons are re-normalized.
 * If only one season is present, a mild damping is applied.
 */

const SEASON_WEIGHTS = {
  current: 0.55,
  previous: 0.30,
  history: 0.15,
};
const SINGLE_SEASON_DAMPING = 0.92;

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
function calculateRoleScore(role, seasonStats = {}) {
  if (role === "Batsman" || role === "Wicket-Keeper") {
    return battingScore(seasonStats.batting);
  }
  if (role === "Bowler") {
    return bowlingScore(seasonStats.bowling);
  }
  const bs = battingScore(seasonStats.batting);
  const qs = bowlingScore(seasonStats.bowling);
  return Math.max(bs, qs) + Math.min(bs, qs) * 0.4;
}

function hasSeasonData(role, seasonStats = {}) {
  if (role === "Batsman" || role === "Wicket-Keeper") {
    return Number(seasonStats?.batting?.matches || 0) > 0;
  }
  if (role === "Bowler") {
    return Number(seasonStats?.bowling?.matches || 0) > 0;
  }
  return (
    Number(seasonStats?.batting?.matches || 0) > 0 ||
    Number(seasonStats?.bowling?.matches || 0) > 0
  );
}

function weightedNormalized(components) {
  const available = components.filter((entry) => entry.available);
  if (available.length === 0) return 0;
  const weightSum = available.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const score = available.reduce((sum, entry) => sum + entry.score * (entry.weight / weightSum), 0);
  if (available.length === 1) return score * SINGLE_SEASON_DAMPING;
  return score;
}

function calculateRawFairPoint(role, statsCurrent, statsPrevious, statsHistory) {
  const current = statsCurrent || {};
  const previous = statsPrevious || {};
  const history = statsHistory || {};

  const components = [
    {
      score: calculateRoleScore(role, current),
      weight: SEASON_WEIGHTS.current,
      available: hasSeasonData(role, current),
    },
    {
      score: calculateRoleScore(role, previous),
      weight: SEASON_WEIGHTS.previous,
      available: hasSeasonData(role, previous),
    },
    {
      score: calculateRoleScore(role, history),
      weight: SEASON_WEIGHTS.history,
      available: hasSeasonData(role, history),
    },
  ];

  return Math.round(weightedNormalized(components) * 100) / 100;
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
function calculateFairPoint(role, statsCurrent, statsPrevious, statsHistory) {
  return calculateRawFairPoint(role, statsCurrent, statsPrevious, statsHistory);
}

module.exports = {
  calculateFairPoint,
  calculateRawFairPoint,
  normalizeTo100,
  battingScore,
  bowlingScore,
};
