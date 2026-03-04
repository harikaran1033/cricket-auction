/**
 * Design system constants — color palette, formatting helpers.
 */
export const COLORS = {
  primary: "#00E5FF",
  accent: "#FF3D00",
  success: "#00C853",
  warning: "#FFD600",
  bgMain: "#0F172A",
  bgCard: "#1E293B",
  border: "#334155",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
};

export const ROLE_COLORS = {
  Batsman: COLORS.primary,
  Bowler: COLORS.accent,
  "All-Rounder": COLORS.success,
  "Wicket-Keeper": COLORS.warning,
  BAT: COLORS.primary,
  BOWL: COLORS.accent,
  AR: COLORS.success,
  WK: COLORS.warning,
};

/**
 * Dynamic set config resolver.
 * Derives display metadata from any set code pattern (M1, BA3, UWK2, ACC, etc.).
 * Handles dynamic sets built by the engine — no hardcoding needed.
 */
const PHASE_COLOR_MAP = {
  marquee: "#FFD700",
  primary: COLORS.primary,
  uncapped: "#A78BFA",
  depth: "#F97316",
  accelerated: "#EF4444",
};

const CODE_PREFIX_META = {
  M:   { label: "Marquee",                phase: "marquee",     color: "#FFD700" },
  BA:  { label: "Capped Batters",         phase: "primary",     color: COLORS.primary },
  AL:  { label: "Capped All-Rounders",    phase: "primary",     color: COLORS.success },
  WK:  { label: "Capped Wicket-Keepers",  phase: "primary",     color: COLORS.warning },
  FA:  { label: "Capped Bowlers",         phase: "primary",     color: COLORS.accent },
  SP:  { label: "Capped Spinners",        phase: "primary",     color: "#7C3AED" },
  UBA: { label: "Uncapped Batters",       phase: "uncapped",    color: COLORS.primary },
  UAL: { label: "Uncapped All-Rounders",  phase: "uncapped",    color: COLORS.success },
  UWK: { label: "Uncapped Wicket-Keepers",phase: "uncapped",    color: COLORS.warning },
  UFA: { label: "Uncapped Bowlers",       phase: "uncapped",    color: COLORS.accent },
  USP: { label: "Uncapped Spinners",      phase: "uncapped",    color: "#7C3AED" },
  ACC: { label: "Accelerated Round",      phase: "accelerated", color: "#EF4444" },
};

/**
 * Get set config for any code. Works for M1, M2, M3, BA1, BA2, UFA3, ACC etc.
 */
export function getSetConfig(code) {
  if (!code) return { name: code || "?", short: code || "?", phase: "primary", color: COLORS.primary };
  // Extract prefix and number — e.g. "UBA3" → prefix="UBA", num="3"
  const match = code.match(/^([A-Z]+?)(\d*)$/);
  if (!match) return { name: code, short: code, phase: "primary", color: COLORS.primary };
  const [, prefix, numStr] = match;
  const meta = CODE_PREFIX_META[prefix];
  if (!meta) return { name: code, short: code, phase: "primary", color: COLORS.primary };
  const num = numStr || "";
  const setLabel = num ? `${meta.label} Set ${num}` : meta.label;
  return { name: setLabel, short: code, phase: meta.phase, color: meta.color };
}

// Legacy alias — used throughout the app. Falls back to dynamic resolver.
export const SET_CONFIG = new Proxy({}, {
  get(_, code) {
    return getSetConfig(String(code));
  },
  has() { return true; },
});

export const PHASE_LABELS = {
  marquee: "MARQUEE",
  primary: "CAPPED",
  uncapped: "UNCAPPED",
  depth: "DEPTH",
  accelerated: "ACCELERATED",
};

export const PHASE_COLORS = {
  marquee: "#FFD700",
  primary: COLORS.primary,
  uncapped: "#A78BFA",
  depth: "#F97316",
  accelerated: "#EF4444",
};

export const LEAGUE_COLORS = {
  IPL: "#FF3D00",
  BBL: "#00E5FF",
  CPL: "#FFD600",
  PSL: "#00C853",
  T20: "#7C3AED",
  WC: "#EC4899",
  PL: "#0090FF",
  CT: "#F97316",
};

/**
 * Format price from lakhs to human-readable.
 */
export function formatPrice(lakhs) {
  if (lakhs >= 100) {
    return `₹${(lakhs / 100).toFixed(2)}Cr`;
  }
  return `₹${lakhs}L`;
}

/**
 * Get activity type for styling.
 */
export function getActivityClass(type) {
  if (type.includes("SOLD") && !type.includes("UNSOLD")) return "sold";
  if (type.includes("UNSOLD")) return "unsold";
  if (type.includes("BID")) return "bid";
  if (type.includes("JOIN")) return "join";
  return "";
}

/**
 * Format activity log to readable string.
 */
export function formatActivity(log) {
  const p = log.payload || {};
  switch (log.type) {
    case "ROOM_CREATED":
      return `${p.teamName} created the room`;
    case "TEAM_JOINED":
      return `${p.userName} joined as ${p.teamName}`;
    case "TEAM_LEFT":
      return `${p.userName} left the room`;
    case "TEAM_KICKED":
      return `${p.teamName} was kicked from the room`;
    case "RETENTION_MADE":
      return `${p.teamName} retained ${p.playerName} (Slot ${p.slot} — ${formatPrice(p.cost)})`;
    case "AUCTION_STARTED":
      return `Auction started! ${p.totalPlayers} players in pool · ${p.totalSets || "?"} sets`;
    case "PLAYER_NOMINATED":
      return `${p.playerName} is up for auction (Base: ${formatPrice(p.basePrice)})${p.set ? ` [${p.set}]` : ""}`;    case "BID_PLACED":
      return `${p.teamName} bids ${formatPrice(p.amount)} for ${p.playerName}`;
    case "PLAYER_SOLD":
      return `${p.playerName} SOLD to ${p.teamName} for ${formatPrice(p.amount)}`;
    case "PLAYER_UNSOLD":
      return `${p.playerName} goes UNSOLD`;
    case "RTM_USED":
      return `${p.teamName} uses RTM for ${formatPrice(p.amount)}`;
    case "RTM_PASSED":
      return `${p.teamName} passes on RTM`;
    case "AUCTION_COMPLETED":
      return `Auction Complete! ${p.totalSold} sold, ${p.totalUnsold} unsold`;
    case "SET_CHANGED":
      return `📋 Now entering: ${p.setName || p.setCode}`;
    default:
      return log.type;
  }
}

/**
 * Map server status to display status.
 */
export function getStatusConfig(status) {
  const map = {
    waiting: { color: COLORS.warning, bg: `${COLORS.warning}22`, label: "WAITING" },
    retention: { color: COLORS.primary, bg: `${COLORS.primary}22`, label: "RETENTION" },
    lobby: { color: COLORS.warning, bg: `${COLORS.warning}22`, label: "LOBBY" },
    auction: { color: COLORS.accent, bg: `${COLORS.accent}22`, label: "LIVE", pulse: true },
    paused: { color: COLORS.warning, bg: `${COLORS.warning}22`, label: "PAUSED" },
    completed: { color: COLORS.textSecondary, bg: `${COLORS.textSecondary}22`, label: "DONE" },
  };
  return map[status] || map.waiting;
}
