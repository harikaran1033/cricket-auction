/**
 * Socket Event Constants — single source of truth for all event names.
 * Used by both socket handlers and frontend.
 */
module.exports = {
  // Connection
  CONNECTION: "connection",
  DISCONNECT: "disconnect",

  // Room events (client → server)
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_READY: "room:ready",
  ROOM_SPECTATE: "room:spectate",
  ROOM_KICK: "room:kick",

  // Room events (server → client)
  ROOM_UPDATED: "room:updated",
  ROOM_ERROR: "room:error",
  ROOM_USER_JOINED: "room:userJoined",
  ROOM_USER_LEFT: "room:userLeft",
  ROOM_TEAM_KICKED: "room:teamKicked",

  // Retention events (client → server)
  RETENTION_RETAIN: "retention:retain",
  RETENTION_REMOVE: "retention:remove",
  RETENTION_CONFIRM: "retention:confirm",
  RETENTION_GET_PLAYERS: "retention:getPlayers",

  // Retention events (server → client)
  RETENTION_UPDATED: "retention:updated",
  RETENTION_PLAYERS: "retention:players",
  RETENTION_ALL_CONFIRMED: "retention:allConfirmed",
  RETENTION_ERROR: "retention:error",

  // Auction events (client → server)
  AUCTION_START: "auction:start",
  AUCTION_BID: "auction:bid",
  AUCTION_NOMINATE: "auction:nominate",
  AUCTION_PAUSE: "auction:pause",
  AUCTION_RESUME: "auction:resume",
  AUCTION_RTM_USE: "auction:rtmUse",
  AUCTION_RTM_PASS: "auction:rtmPass",
  AUCTION_GET_STATE: "auction:getState",

  // Auction events (server → client)
  AUCTION_INITIALIZED: "auction:initialized",
  AUCTION_PLAYER_NOMINATED: "auction:playerNominated",
  AUCTION_BID_PLACED: "auction:bidPlaced",
  AUCTION_PLAYER_SOLD: "auction:playerSold",
  AUCTION_PLAYER_REVEALED: "auction:playerRevealed",
  AUCTION_PLAYER_UNSOLD: "auction:playerUnsold",
  AUCTION_RTM_PENDING: "auction:rtmPending",
  AUCTION_TIMER_TICK: "auction:timerTick",
  AUCTION_PAUSED: "auction:paused",
  AUCTION_RESUMED: "auction:resumed",
  AUCTION_COMPLETED: "auction:completed",
  AUCTION_SET_CHANGED: "auction:setChanged",
  AUCTION_STATE: "auction:state",
  AUCTION_ERROR: "auction:error",

  // Auction timer config (client → server)
  AUCTION_TIMER_CONFIG: "auction:timerConfig",
  // Auction timer changed (server → client)
  AUCTION_TIMER_CHANGED: "auction:timerChanged",

  // Chat events
  CHAT_SEND: "chat:send",
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",

  // Activity events
  ACTIVITY_NEW: "activity:new",
  ACTIVITY_HISTORY: "activity:history",

  // ── Match / Simulation events ─────────────────────────────────────────────

  // client → server
  MATCH_SUBMIT_XI:    "match:submitXI",     // submit Playing XI + C/VC
  MATCH_SIMULATE:     "match:simulate",     // host triggers simulation
  MATCH_GET_STRENGTH: "match:getStrength",  // request strength for a team
  MATCH_GET_ALL_STRENGTHS: "match:getAllStrengths", // all teams' strengths

  // server → client
  MATCH_XI_CONFIRMED:    "match:xiConfirmed",     // XI accepted for a team
  MATCH_STRENGTH_UPDATE: "match:strengthUpdate",  // updated strength pushed to room
  MATCH_RESULTS:         "match:results",         // full simulation results
  MATCH_ERROR:           "match:error",

  // ── Live activity feed ───────────────────────────────────────────────────
  // server → client  (broadcast on all significant auction events)
  FEED_EVENT: "feed:event",
};
