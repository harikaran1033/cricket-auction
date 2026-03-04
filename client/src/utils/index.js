/**
 * Format price from lakhs to human-readable.
 */
export function formatPrice(lakhs) {
  if (lakhs >= 100) {
    return `₹${(lakhs / 100).toFixed(2)} Cr`;
  }
  return `₹${lakhs} L`;
}

/**
 * Get role color for badges.
 */
export function getRoleColor(role) {
  const map = {
    Batsman: "#3b82f6",
    Bowler: "#ef4444",
    "All-Rounder": "#f59e0b",
    "Wicket-Keeper": "#8b5cf6",
  };
  return map[role] || "#94a3b8";
}

/**
 * Get activity type color class.
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
    case "RETENTION_MADE":
      return `${p.teamName} retained ${p.playerName} (Slot ${p.slot} — ${formatPrice(p.cost)})`;
    case "AUCTION_STARTED":
      return `Auction started! ${p.totalPlayers} players in pool`;
    case "PLAYER_NOMINATED":
      return `${p.playerName} is up for auction (Base: ${formatPrice(p.basePrice)})`;
    case "BID_PLACED":
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
    default:
      return log.type;
  }
}
