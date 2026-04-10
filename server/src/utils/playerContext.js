const { getDataPath } = require("../store");

const analytics = require(getDataPath("ipl_player_analytics.json"));
const matchups = require(getDataPath("ipl_player_matchups.json"));

function normalizeName(name = "") {
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

const analyticsIndex = new Map();
const matchupBattersIndex = new Map();
const matchupBowlersIndex = new Map();

for (const bucket of ["batsmen", "bowlers", "all_rounders", "fielders"]) {
  const entries = analytics?.[bucket] || {};
  for (const [name, value] of Object.entries(entries)) {
    const existing = analyticsIndex.get(normalizeName(name)) || {};
    analyticsIndex.set(normalizeName(name), { ...existing, ...value });
  }
}

for (const [name, value] of Object.entries(matchups?.batters || {})) {
  matchupBattersIndex.set(normalizeName(name), value);
}
for (const [name, value] of Object.entries(matchups?.bowlers || {})) {
  matchupBowlersIndex.set(normalizeName(name), value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

function titleize(value = "") {
  return String(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortStyleTag(style = "") {
  const lower = String(style).toLowerCase();
  if (lower.includes("left-hand")) return "Left-hand bat";
  if (lower.includes("right-hand")) return "Right-hand bat";
  if (lower.includes("legbreak")) return "Leg-spin";
  if (lower.includes("offbreak")) return "Off-spin";
  if (lower.includes("orthodox")) return "Left-arm spin";
  if (lower.includes("chinaman")) return "Left-arm wrist-spin";
  if (lower.includes("fast")) return "Fast bowler";
  if (lower.includes("medium")) return "Seam bowler";
  return style || null;
}

function parseBattingSlot(slotKey = "") {
  const match = /^(\d+)_down$/.exec(slotKey);
  if (!match) return null;
  return Number(match[1]) + 1;
}

function getAnalytics(name = "") {
  return analyticsIndex.get(normalizeName(name)) || null;
}

function getBatterMatchups(name = "") {
  return matchupBattersIndex.get(normalizeName(name)) || {};
}

function getBowlerMatchups(name = "") {
  return matchupBowlersIndex.get(normalizeName(name)) || {};
}

function deriveBaseStats(analyticsRecord = {}, fallbackStats = {}) {
  const batting26 = fallbackStats?.stats2026?.batting || {};
  const batting25 = fallbackStats?.stats2025?.batting || {};
  const batting24 = fallbackStats?.stats2024?.batting || {};
  const avgSource = batting26.average || batting25.average || batting24.average || fallbackStats?.stats?.average || 0;
  const srSource = batting26.strikeRate || batting25.strikeRate || batting24.strikeRate || fallbackStats?.stats?.strikeRate || 0;
  const runsSource =
    analyticsRecord?.total_runs ||
    batting26.runs ||
    batting25.runs ||
    batting24.runs ||
    fallbackStats?.stats?.runs ||
    0;

  return {
    avg: round(avgSource, 0),
    sr: round(srSource, 0),
    runs: round(runsSource, 0),
  };
}

function derivePhaseRatings(record = {}, role = "Batsman") {
  const roleName = String(role || record?.role || "Batsman");
  if (roleName === "Bowler") {
    const balls = record?.balls_by_phase || {};
    const wickets = record?.wickets_by_phase || {};
    const totalBalls =
      (balls.powerplay || 0) +
      (balls.middle_overs || 0) +
      (balls.death_overs || 0);
    const totalWickets =
      (wickets.powerplay || 0) +
      (wickets.middle_overs || 0) +
      (wickets.death_overs || 0);

    const score = (phaseBalls, phaseWickets, roleBoost = 0) => {
      const usage = percent(phaseBalls, totalBalls || 1);
      const strikeShare = percent(phaseWickets, totalWickets || 1);
      return round(clamp(35 + usage * 0.35 + strikeShare * 0.45 + roleBoost, 20, 98), 0);
    };

    return {
      powerplay: score(balls.powerplay || 0, wickets.powerplay || 0, 6),
      middle: score(balls.middle_overs || 0, wickets.middle_overs || 0, 2),
      death: score(balls.death_overs || 0, wickets.death_overs || 0, 8),
    };
  }

  const battingPositions = record?.by_batting_position || record?.batting?.by_batting_position || {};
  const positionEntries = Object.entries(battingPositions);
  const totalRunsFromPositions = positionEntries.reduce((sum, [, runs]) => sum + (Number(runs) || 0), 0);
  const totalRuns = totalRunsFromPositions || record?.total_runs || record?.batting?.total_runs || 0;
  const weighted = { powerplay: 0, middle: 0, death: 0 };

  for (const [slotKey, runsValue] of positionEntries) {
    const slot = parseBattingSlot(slotKey);
    const runs = Number(runsValue) || 0;
    if (!slot || runs <= 0) continue;

    if (slot <= 2) {
      weighted.powerplay += runs * 1.0;
      weighted.middle += runs * 0.45;
      weighted.death += runs * 0.15;
    } else if (slot <= 5) {
      weighted.powerplay += runs * 0.35;
      weighted.middle += runs * 1.0;
      weighted.death += runs * 0.45;
    } else {
      weighted.powerplay += runs * 0.1;
      weighted.middle += runs * 0.55;
      weighted.death += runs * 1.1;
    }
  }

  const fallbackTotal = totalRuns || 1;
  const rate = (value, boost = 0) => round(clamp(30 + percent(value, fallbackTotal) * 0.5 + boost, 20, 98), 0);
  return {
    powerplay: rate(weighted.powerplay, 8),
    middle: rate(weighted.middle, 4),
    death: rate(weighted.death, 10),
  };
}

function derivePrimaryTag(record = {}, role = "Batsman", phaseRatings = {}) {
  const roleName = String(role || record?.role || "Batsman");
  const bowlingType = String(record?.bowling_type || record?.bowling?.bowling_type || "").toLowerCase();

  if (roleName === "Bowler") {
    const topPhase = Object.entries(phaseRatings).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topPhase === "death") return "Death specialist";
    if (topPhase === "powerplay") return "PowerPlay bowler";
    if (bowlingType === "spin") return "Spin bowler";
    return "Middle overs bowler";
  }

  const topPhase = Object.entries(phaseRatings).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topPhase === "death") return "Death specialist";
  if (topPhase === "powerplay") return "PowerPlay batter";
  if (topPhase === "middle") return "Middle overs anchor";
  return roleName === "All-Rounder" ? "Utility all-rounder" : "Top-order batter";
}

function deriveBowlingTypeSplit(record = {}) {
  const vsFast = Number(record?.vs_fast || record?.batting?.vs_fast || 0);
  const vsSpin = Number(record?.vs_spin || record?.batting?.vs_spin || 0);
  const total = vsFast + vsSpin;
  return {
    vsFast,
    vsSpin,
    total,
    spinShare: percent(vsSpin, total || 1),
    fastShare: percent(vsFast, total || 1),
  };
}

function deriveHandednessSplit(record = {}) {
  const vsRight = Number(record?.vs_right_handed || record?.bowling?.vs_right_handed || 0);
  const vsLeft = Number(record?.vs_left_handed || record?.bowling?.vs_left_handed || 0);
  const total = vsRight + vsLeft;
  return {
    vsRight,
    vsLeft,
    total,
    rightShare: percent(vsRight, total || 1),
    leftShare: percent(vsLeft, total || 1),
  };
}

// Dismissals that are normal cricket outcomes — not real technical weaknesses
const GENERIC_DISMISSALS = new Set(["caught", "c & b", "caught and bowled", "ct"]);

// Map specific dismissal kinds to actionable scouting labels
const DISMISSAL_LABELS = {
  bowled:   "Bowled pattern (gate or swing)",
  lbw:      "LBW pattern (plays across line)",
  stumped:  "Stumped risk vs spin",
  "run out": "Run-out risk (poor calling)",
  hitwicket: "Hit-wicket tendency",
};

function deriveDismissalInsight(name = "") {
  const batterMatchups = getBatterMatchups(name);
  const dismissalKinds = {};

  for (const value of Object.values(batterMatchups)) {
    for (const event of value?.dismissal_events || []) {
      const wicketKind = String(event?.wicket_kind || "").toLowerCase().trim();
      if (!wicketKind || GENERIC_DISMISSALS.has(wicketKind)) continue; // skip caught
      dismissalKinds[wicketKind] = (dismissalKinds[wicketKind] || 0) + 1;
    }
  }

  const topDismissal = Object.entries(dismissalKinds).sort((a, b) => b[1] - a[1])[0];
  if (!topDismissal || topDismissal[1] < 2) return null;

  const label = DISMISSAL_LABELS[topDismissal[0]] || `${titleize(topDismissal[0])} tendency`;
  return {
    key: topDismissal[0],
    count: topDismissal[1],
    label,
  };
}

function deriveVenueBonus(record = {}) {
  const venues = Object.entries(record?.by_ground || record?.batting?.by_ground || record?.bowling?.by_ground || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!venues.length) return null;
  const [venue, value] = venues[0];
  const bonus = clamp(Math.round(Number(value) / 20), 2, 8);
  return {
    venue,
    value: Number(value),
    bonus,
    label: `${venue.split(",")[0]} +${bonus} bonus`,
  };
}

function deriveMatchupEdges(name = "", role = "Batsman") {
  if (role === "Bowler") {
    const bowlerMap = getBowlerMatchups(name);
    const rows = Object.entries(bowlerMap).map(([opponent, value]) => {
      const wickets = Number(value?.wickets || 0);
      const runsConceded = Number(value?.runs_conceded || 0);
      const sample = wickets * 20 - runsConceded;
      return {
        opponent,
        wickets,
        runsConceded,
        score: sample,
      };
    });

    return {
      strengths: rows
        .filter((row) => row.wickets > 0 || row.runsConceded <= 12)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((row) => ({
          opponent: row.opponent,
          label: `${row.opponent} ${row.wickets ? `${row.wickets}w` : `${row.runsConceded}r conceded`}`,
          tone: "good",
        })),
      weaknesses: rows
        .filter((row) => row.runsConceded >= 18 && row.wickets === 0)
        .sort((a, b) => b.runsConceded - a.runsConceded)
        .slice(0, 2)
        .map((row) => ({
          opponent: row.opponent,
          label: `${row.opponent} attacks this matchup`,
          tone: "bad",
        })),
    };
  }

  const batterMap = getBatterMatchups(name);
  const rows = Object.entries(batterMap).map(([opponent, value]) => {
    const runs = Number(value?.runs || 0);
    const outs = Number(value?.outs || 0);
    const score = runs - outs * 16;
    return {
      opponent,
      runs,
      outs,
      score,
    };
  });

  return {
    strengths: rows
      .filter((row) => row.runs >= 20 && row.outs === 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((row) => ({
        opponent: row.opponent,
        label: `${row.opponent} ${row.runs}r 0w`,
        tone: "good",
      })),
    weaknesses: rows
      .filter((row) => row.outs > 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 2)
      .map((row) => ({
        opponent: row.opponent,
        label: `${row.opponent} ${row.runs}r ${row.outs}w`,
        tone: "bad",
      })),
  };
}

function deriveContextModifier(context) {
  let modifier = 0;
  if ((context.phaseRatings?.death || 0) >= 78) modifier += 3;
  if ((context.phaseRatings?.powerplay || 0) >= 78) modifier += 2;
  // Only penalise for a *meaningful* dismissal pattern (bowled/lbw/stumped), not generic caught
  const meaningfulDismissal = context.dismissalInsight &&
    ["bowled", "lbw", "stumped", "run out"].includes(context.dismissalInsight.key);
  if (meaningfulDismissal) modifier -= 2;
  if ((context.spinProfile?.spinShare || 0) <= 28 && context.role !== "Bowler") modifier -= 2;
  if ((context.handednessProfile?.leftShare || 0) <= 20 && context.role === "Bowler") modifier -= 1;
  return clamp(modifier, -8, 8);
}

function buildPlayerContext(player = {}, leaguePlayer = {}) {
  const name = player?.name || leaguePlayer?.player?.name || "";
  const analyticsRecord = getAnalytics(name) || {};
  const role = player?.role || leaguePlayer?.player?.role || analyticsRecord?.role || "Batsman";
  const phaseRatings = derivePhaseRatings(analyticsRecord, role);
  const spinProfile = deriveBowlingTypeSplit(analyticsRecord);
  const handednessProfile = deriveHandednessSplit(analyticsRecord);
  const dismissalInsight = deriveDismissalInsight(name);
  const venueBonus = deriveVenueBonus(analyticsRecord);
  const matchupEdges = deriveMatchupEdges(name, role);
  const battingStyle =
    analyticsRecord?.batting_style ||
    analyticsRecord?.batting?.batting_style ||
    player?.battingStyle ||
    leaguePlayer?.battingStyle ||
    "";

  const visibleTags = [
    derivePrimaryTag(analyticsRecord, role, phaseRatings),
    shortStyleTag(battingStyle),
  ].filter(Boolean).slice(0, 2);

  const clueTags = [];
  if (role !== "Bowler" && spinProfile.total > 0) {
    clueTags.push(
      spinProfile.spinShare <= 30 ? "Weakness vs 1 bowling type" : "Strong vs one bowling type"
    );
  }
  if (role === "Bowler" && handednessProfile.total > 0) {
    clueTags.push(
      Math.abs(handednessProfile.leftShare - handednessProfile.rightShare) >= 18
        ? "Strong vs one batting hand"
        : "Balanced matchup profile"
    );
  }
  clueTags.push("Strong in one phase");
  if (dismissalInsight) clueTags.push("Repeat dismissal pattern");

  const exactTags = [];
  const topPhase = Object.entries(phaseRatings).sort((a, b) => b[1] - a[1])[0];
  if (topPhase) {
    exactTags.push({
      label:
        topPhase[0] === "powerplay"
          ? "PowerPlay specialist"
          : topPhase[0] === "middle"
            ? "Middle overs strength"
            : "Death specialist",
      tone: "good",
    });
  }
  if (role !== "Bowler" && spinProfile.total > 0) {
    exactTags.push({
      label: spinProfile.spinShare <= 30 ? "Spin vulnerability" : "Strong vs spin",
      tone: spinProfile.spinShare <= 30 ? "bad" : "good",
    });
  }
  if (role !== "Bowler" && spinProfile.total > 0) {
    const fastShare = spinProfile.fastShare || 0;
    if (fastShare <= 30) {
      exactTags.push({ label: "Pace vulnerability", tone: "bad" });
    } else if (fastShare >= 60) {
      exactTags.push({ label: "Strong vs pace", tone: "good" });
    }
  }
  if (role === "Bowler" && handednessProfile.total > 0) {
    exactTags.push({
      label: handednessProfile.leftShare >= handednessProfile.rightShare ? "Left-hand matchup edge" : "Right-hand matchup edge",
      tone: "good",
    });
  }
  // Batting quality tags based on stats
  const bs = deriveBaseStats(analyticsRecord, leaguePlayer);
  if (role !== "Bowler") {
    if ((bs.avg || 0) >= 45) exactTags.push({ label: "Consistent scorer (avg 45+)", tone: "good" });
    else if ((bs.avg || 0) > 0 && (bs.avg || 0) < 22) exactTags.push({ label: "Low average concern", tone: "bad" });
    if ((bs.sr || 0) >= 155) exactTags.push({ label: "Explosive striker (SR 155+)", tone: "good" });
    else if ((bs.sr || 0) > 0 && (bs.sr || 0) < 110 && role !== "WK-Batsman") exactTags.push({ label: "Below-par strike rate", tone: "bad" });
  }
  if (dismissalInsight) exactTags.push({ label: dismissalInsight.label, tone: "bad" });
  if (venueBonus) exactTags.push({ label: venueBonus.label, tone: "good" });

  const context = {
    playerName: name,
    role,
    baseStats: deriveBaseStats(analyticsRecord, leaguePlayer),
    visibleTags,
    clueTags: clueTags.slice(0, 3),
    hiddenTagCount: Math.max(0, exactTags.length - visibleTags.length),
    phaseRatings,
    exactTags: exactTags.slice(0, 5),
    matchupStrengths: matchupEdges.strengths,
    matchupWeaknesses: matchupEdges.weaknesses,
    venueBonus,
    dismissalInsight,
    spinProfile,
    handednessProfile,
    battingStyle: battingStyle || null,
    bowlingStyle:
      analyticsRecord?.bowling_style ||
      analyticsRecord?.bowling?.bowling_style ||
      player?.bowlingStyle ||
      null,
  };

  // ── dataSufficiency flag ──────────────────────────────────────────────
  // "high"  → rich multi-season analytics (≥15 innings or ≥120 balls)
  // "medium" → some data but limited (5–14 innings or 30–119 balls)
  // "low"    → sparse / no meaningful analytics (< 5 innings or < 30 balls)
  {
    const innings  = Number(analyticsRecord?.innings || analyticsRecord?.batting?.innings || analyticsRecord?.bowling?.innings || 0);
    const balls    = Number(analyticsRecord?.balls_faced || analyticsRecord?.batting?.balls_faced || analyticsRecord?.balls_bowled || analyticsRecord?.bowling?.balls_bowled || 0);
    const hasRecord = !!analyticsRecord && Object.keys(analyticsRecord).length > 2;
    if (!hasRecord || (innings < 5 && balls < 30)) {
      context.dataSufficiency = "low";
    } else if (innings >= 15 || balls >= 120) {
      context.dataSufficiency = "high";
    } else {
      context.dataSufficiency = "medium";
    }
  }

  context.contextModifier = deriveContextModifier(context);
  context.revealedFairPoint = round((Number(leaguePlayer?.fairPoint) || Number(player?.fairPoint) || 0) + context.contextModifier, 1);
  return context;
}

function guessBestPosition(context = {}) {
  const death = context?.phaseRatings?.death || 0;
  const powerplay = context?.phaseRatings?.powerplay || 0;
  const middle = context?.phaseRatings?.middle || 0;
  if (context.role === "Bowler") return "lower_order";
  if (powerplay >= middle && powerplay >= death) return "opener";
  if (death >= middle) return "finisher";
  return "middle_order";
}

function tagToKey(tag = "") {
  return String(tag).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function buildProfile(name = "") {
  const context = buildPlayerContext({ name }, {});
  return {
    name,
    best_position: guessBestPosition(context),
    tags: [...context.visibleTags, ...context.exactTags.map((tag) => tag.label)]
      .filter(Boolean)
      .map(tagToKey),
    final_player_value: clamp(round(40 + (context.phaseRatings?.powerplay || 0) * 0.15 + (context.phaseRatings?.death || 0) * 0.15, 1), 15, 100),
  };
}

function computePositionMultiplier(name = "", slotNumber = 1) {
  const bestPosition = buildProfile(name).best_position;
  if (bestPosition === "lower_order") {
    if (slotNumber >= 8) return 1;
    if (slotNumber >= 6) return 0.86;
    return 0.72;
  }
  if (bestPosition === "finisher") {
    if (slotNumber >= 5 && slotNumber <= 7) return 1;
    if (slotNumber >= 4 && slotNumber <= 8) return 0.88;
    return 0.74;
  }
  if (bestPosition === "middle_order") {
    if (slotNumber >= 3 && slotNumber <= 5) return 1;
    if (slotNumber >= 2 && slotNumber <= 6) return 0.9;
    return 0.76;
  }
  if (slotNumber <= 2) return 1;
  if (slotNumber <= 4) return 0.88;
  return 0.72;
}

function buildSquadHealth({ squadEntries = [], playingXI = [], baseTotal = 0 } = {}) {
  const xi = Array.isArray(playingXI) && playingXI.length > 0 ? playingXI : squadEntries;
  const contextRows = xi.map((entry) => {
    const player = entry?.player || entry || {};
    const ratingData = entry?.ratingData || {};
    return {
      player,
      fairPoint: Number(ratingData?.fairPoint || entry?.fairPoint || ratingData?.overallRating || 0),
      context: buildPlayerContext(player, { ...entry, fairPoint: ratingData?.fairPoint || entry?.fairPoint || 0 }),
    };
  });

  const batters = contextRows.filter((row) => row.player?.role !== "Bowler");
  const bowlers = contextRows.filter((row) => ["Bowler", "All-Rounder"].includes(row.player?.role));

  const score = (value, divisor) => round(clamp((value / divisor) * 100, 0, 100), 0);
  const leftHanders = batters.filter((row) => String(row.context?.battingStyle || "").toLowerCase().includes("left-hand"));

  const vsSpinValue = batters.reduce((sum, row) => {
    const spinShare = row.context?.spinProfile?.spinShare || 0;
    const handedBoost = String(row.context?.battingStyle || "").toLowerCase().includes("left-hand") ? 10 : 0;
    return sum + row.fairPoint * clamp(0.45 + spinShare / 100 + handedBoost / 100, 0.2, 1.25);
  }, 0);
  const deathBowlingValue = bowlers.reduce((sum, row) => sum + row.fairPoint * ((row.context?.phaseRatings?.death || 0) / 100), 0);
  const powerPlayBatValue = batters.reduce((sum, row) => sum + row.fairPoint * ((row.context?.phaseRatings?.powerplay || 0) / 100), 0);
  const chaseValue = batters.reduce((sum, row) => sum + row.fairPoint * ((Math.max(row.context?.phaseRatings?.middle || 0, row.context?.phaseRatings?.death || 0)) / 100), 0);

  const metrics = [
    {
      key: "vs_spin",
      label: "vs Spin",
      value: score(vsSpinValue, 320),
    },
    {
      key: "death_bowling",
      label: "Death bowling",
      value: score(deathBowlingValue, 220),
    },
    {
      key: "powerplay_bat",
      label: "PowerPlay bat",
      value: score(powerPlayBatValue, 260),
    },
    {
      key: "chase_ability",
      label: "Chase ability",
      value: score(chaseValue, 280),
    },
    {
      key: "left_hand_bat",
      label: "Left-hand bat",
      value: clamp(leftHanders.length * 45, 0, 100),
    },
  ].map((metric) => ({
    ...metric,
    status:
      metric.value === 0 && metric.key === "left_hand_bat"
        ? "Missing"
        : metric.value >= 70
          ? "Covered"
          : metric.value >= 45
            ? "Weak"
            : "Critical gap",
  }));

  const spinMetric = metrics.find((metric) => metric.key === "vs_spin") || { value: 50 };
  const deathMetric = metrics.find((metric) => metric.key === "death_bowling") || { value: 50 };
  const powerplayMetric = metrics.find((metric) => metric.key === "powerplay_bat") || { value: 50 };

  const alerts = [];
  if ((metrics.find((metric) => metric.key === "left_hand_bat")?.value || 0) === 0) {
    alerts.push({
      tone: "danger",
      message: `No left-hand batter — spin bowlers can target your lineup. Spin cover at ${spinMetric.value} means -12 FP vs spin-heavy teams.`,
    });
  }
  if (deathMetric.value < 55) {
    alerts.push({
      tone: "warning",
      message: "Death bowling weak — opponents with death specialists can swing overs 16-20 against you.",
    });
  }
  if (powerplayMetric.value >= 75) {
    alerts.push({
      tone: "success",
      message: "PowerPlay batting strong — you gain a bonus against squads that lack early wicket takers.",
    });
  }

  const balancedEstimate = round(baseTotal - (60 - spinMetric.value) * 0.2 - (60 - deathMetric.value) * 0.15, 0);
  const paceEstimate = round(baseTotal + (powerplayMetric.value - 55) * 0.25, 0);
  const spinEstimate = round(baseTotal + (spinMetric.value - 55) * 0.35 - ((metrics.find((metric) => metric.key === "left_hand_bat")?.value || 0) === 0 ? 12 : 0), 0);

  return {
    metrics,
    alerts,
    preview: {
      vsPace: paceEstimate,
      vsBalanced: balancedEstimate,
      vsSpin: spinEstimate,
    },
  };
}

module.exports = {
  normalizeName,
  getAnalytics,
  getBatterMatchups,
  getBowlerMatchups,
  buildPlayerContext,
  buildSquadHealth,
  buildProfile,
  getPlayerTags(name = "") {
    return buildProfile(name).tags;
  },
  getPlayerProfile(name = "") {
    return buildProfile(name);
  },
  getPositionMultiplier(name = "", slotNumber = 1) {
    return computePositionMultiplier(name, slotNumber);
  },
  getContextMultiplier(name = "") {
    const context = buildPlayerContext({ name }, {});
    return clamp(1 + (context.contextModifier || 0) / 50, 0.82, 1.18);
  },
  getPlayerFinalValue(name = "") {
    return buildProfile(name).final_player_value;
  },
};
