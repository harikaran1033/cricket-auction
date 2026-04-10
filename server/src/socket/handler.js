const Joi = require("joi");
const roomService = require("../services/roomService");
const retentionService = require("../services/retentionService");
const chatService = require("../services/chatService");
const auctionEngine = require("../auctionEngine");
const matchService = require("../services/matchService");
const E = require("./events");

// ── Joi schemas for socket event validation ──────────────────────
const schemas = {
  ROOM_JOIN: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).required(),
    userName:  Joi.string().min(1).max(40).required(),
    teamName:  Joi.string().min(1).max(40).required(),
  }),
  ROOM_SPECTATE: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).optional(),
    userName:  Joi.string().min(1).max(40).optional(),
  }),
  AUCTION_BID: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).required(),
    teamName:  Joi.string().min(1).max(40).required(),
    amount:    Joi.number().positive().max(50000).required(),
  }),
  AUCTION_NOMINATE: Joi.object({
    roomCode:       Joi.string().alphanum().min(4).max(10).required(),
    userId:         Joi.string().min(1).max(64).required(),
    leaguePlayerId: Joi.string().hex().length(24).optional(),
  }),
  AUCTION_RTM_USE: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).required(),
    teamName:  Joi.string().min(1).max(40).required(),
  }),
  AUCTION_RTM_PASS: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).required(),
    teamName:  Joi.string().min(1).max(40).required(),
  }),
  CHAT_SEND: Joi.object({
    roomCode:  Joi.string().alphanum().min(4).max(10).required(),
    userId:    Joi.string().min(1).max(64).required(),
    userName:  Joi.string().min(1).max(40).optional(),
    teamName:  Joi.string().min(1).max(40).optional(),
    message:   Joi.string().min(1).max(500).required(),
  }),
};

/**
 * Validate socket event payload against a Joi schema.
 * Returns { error } if invalid, else { value } (sanitised payload).
 */
function validate(schemaName, data) {
  const schema = schemas[schemaName];
  if (!schema) return { value: data };
  return schema.validate(data, { abortEarly: true, stripUnknown: true });
}

// ── Per-socket bid rate-limiter (400 ms throttle) ────────────────
// Prevents clients from spamming the bid endpoint.
const BID_THROTTLE_MS = 400;
const lastBidTime = new Map(); // socketId → timestamp

/**
 * Socket Handler — maps socket events to service/engine calls.
 * Each socket joins a room identified by roomCode.
 *
 * Architecture:
 * - Client emits event → handler validates → calls service → emits response
 * - AuctionEngine emits events → this layer broadcasts to room
 */
module.exports = function setupSocketHandlers(io) {
  // ──────────── AUCTION ENGINE EVENT FORWARDING ────────────
  // The engine emits events; we forward them to the correct socket room.
  // Each significant auction event also triggers a compact FEED_EVENT for the live feed.

  function emitFeed(roomCode, type, data) {
    io.to(roomCode).emit(E.FEED_EVENT, {
      type,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  auctionEngine.on("auction:initialized", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_INITIALIZED, data);
    emitFeed(data.roomCode, "AUCTION_STARTED", { message: "Auction has started!" });
  });

  auctionEngine.on("auction:playerNominated", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_NOMINATED, data);
    emitFeed(data.roomCode, "PLAYER_NOMINATED", {
      playerName: data.player?.name || "Unknown Player",
      role: data.player?.role,
      basePrice: data.basePrice,
      message: `${data.player?.name || "Unknown Player"} is up for auction`,
    });
  });

  auctionEngine.on("auction:bidPlaced", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_BID_PLACED, data);
    const playerName = data.currentPlayer?.name || "Unknown Player";
    emitFeed(data.roomCode, "BID_PLACED", {
      playerName,
      teamName: data.currentBidTeam,
      amount: data.currentBid,
      message: `${data.currentBidTeam} bid ₹${data.currentBid}L on ${playerName}`,
    });
  });

  auctionEngine.on("auction:playerSold", (data) => {
    const { revealedPlayer, ...publicData } = data;
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_SOLD, publicData);
    io.in(data.roomCode).fetchSockets()
      .then((sockets) => {
        sockets
          .filter((socket) => socket.data?.currentUser?.teamName === data.soldTo)
          .forEach((socket) => {
            socket.emit(E.AUCTION_PLAYER_REVEALED, {
              roomCode: data.roomCode,
              player: data.revealedPlayer,
              soldTo: data.soldTo,
              soldPrice: data.soldPrice,
              acquiredVia: data.acquiredVia,
            });
          });
      })
      .catch((err) => console.error("[Handler] player reveal emit error:", err.message));
    const playerName = data.soldPlayer?.name || data.player?.name || "Unknown Player";
    emitFeed(data.roomCode, "PLAYER_SOLD", {
      playerName,
      teamName: data.soldTo,
      price: data.soldPrice,
      message: `${playerName} SOLD to ${data.soldTo} for ₹${data.soldPrice}L`,
    });
    // Async: broadcast live team strength update to all room members
    if (data.soldTo && data.roomCode) {
      matchService.getTeamStrength(data.roomCode, data.soldTo)
        .then((strengthData) => {
          io.to(data.roomCode).emit(E.MATCH_STRENGTH_UPDATE, strengthData);
        })
        .catch((err) => console.error("[Handler] Strength broadcast error:", err.message));
    }
  });

  auctionEngine.on("auction:pursesRecalculated", (data) => {
    io.to(data.roomCode).emit("auction:pursesRecalculated", data);
  });

  auctionEngine.on("auction:playerUnsold", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_UNSOLD, data);
    const playerName = data.player?.name || "Unknown Player";
    emitFeed(data.roomCode, "PLAYER_UNSOLD", {
      playerName,
      message: `${playerName} went unsold`,
    });
  });

  auctionEngine.on("auction:rtmPending", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_RTM_PENDING, data);
    const playerName = data.currentPlayer?.name || "Unknown Player";
    emitFeed(data.roomCode, "RTM_PENDING", {
      teamName: data.rtmEligibleTeam,
      playerName,
      message: `${data.rtmEligibleTeam} has RTM option on ${playerName}`,
    });
  });

  auctionEngine.on("auction:timerTick", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_TIMER_TICK, data);
  });

  auctionEngine.on("auction:paused", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PAUSED, data);
    emitFeed(data.roomCode, "AUCTION_PAUSED", { message: "Auction paused" });
  });

  auctionEngine.on("auction:resumed", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_RESUMED, data);
    emitFeed(data.roomCode, "AUCTION_RESUMED", { message: "Auction resumed" });
  });

  auctionEngine.on("auction:completed", async (data) => {
    io.to(data.roomCode).emit(E.AUCTION_COMPLETED, data);
    emitFeed(data.roomCode, "AUCTION_COMPLETED", { message: "🏆 Auction complete! Select your Playing XI." });
    // Purge chat + activity logs to reclaim storage
    if (data.roomId) {
      chatService.clearRoom(data.roomId)
        .catch((err) => console.error("[Handler] clearRoom error:", err.message));
    }
  });

  auctionEngine.on("auction:setChanged", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_SET_CHANGED, data);
    emitFeed(data.roomCode, "SET_CHANGED", {
      setCode: data.currentSet,
      message: `Moving to set: ${data.currentSet}`,
    });
  });

  // ──────────── CONNECTION HANDLER ────────────

  io.on(E.CONNECTION, (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    let currentRoom = null;
    let currentUser = null;

    // ──── ROOM EVENTS ────

    socket.on(E.ROOM_JOIN, async (data, callback) => {
      try {
        const { error, value } = validate("ROOM_JOIN", data);
        if (error) {
          if (callback) callback({ success: false, error: error.message });
          return;
        }
        const { roomCode, userId, userName, teamName } = value;
        const room = await roomService.joinRoom({ roomCode, userId, userName, teamName });

        socket.join(roomCode);
        currentRoom = roomCode;
        currentUser = { userId, userName, teamName };
        socket.data.currentRoom = roomCode;
        socket.data.currentUser = currentUser;

        // Notify others
        let joinedTeamsForBroadcast = room.joinedTeams;
        if (["auction", "paused"].includes(room.status)) {
          try {
            const state = await auctionEngine.getAuctionState(roomCode);
            if (state?.teams) joinedTeamsForBroadcast = state.teams;
          } catch (_) {
            // Fall back to raw joinedTeams if state fetch fails
          }
        }

        socket.to(roomCode).emit(E.ROOM_USER_JOINED, {
          userName,
          teamName,
          joinedTeams: joinedTeamsForBroadcast,
        });

        // If auction is live, also emit room:updated so Auction.jsx picks up the new team
        if (["auction", "paused"].includes(room.status)) {
          io.to(roomCode).emit(E.ROOM_UPDATED, { joinedTeams: joinedTeamsForBroadcast });
        }

        // Send room state to joiner
        if (callback) callback({ success: true, room });

        // Send activity & chat history
        const [activities, messages] = await Promise.all([
          chatService.getActivityLogs(room._id, 50),
          chatService.getMessages(room._id, 50),
        ]);
        socket.emit(E.ACTIVITY_HISTORY, activities);
        socket.emit(E.CHAT_HISTORY, messages.reverse());

        // If auction is live, send current auction state to the late joiner
        if (["auction", "paused"].includes(room.status)) {
          try {
            const state = await auctionEngine.getAuctionState(roomCode);
            if (state) {
              socket.emit(E.AUCTION_STATE, state);
              // Signal this socket that it has successfully reconnected mid-auction
              socket.emit("room:reconnected", { teamName, roomCode });
            }
          } catch (_) { /* auction might not be initialized yet */ }
        }
      } catch (err) {
        console.error("[Socket] ROOM_JOIN error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.ROOM_SPECTATE, async (data, callback) => {
      try {
        const { error, value } = validate("ROOM_SPECTATE", data);
        if (error) {
          if (callback) callback({ success: false, error: error.message });
          return;
        }
        const { roomCode, userId, userName } = value;
        const room = await roomService.getRoomByCode(roomCode);
        if (room.visibility !== "public") {
          throw new Error("Spectating is only available for public rooms");
        }

        socket.join(roomCode);
        currentRoom = roomCode;
        currentUser = null;
        socket.data.currentRoom = roomCode;
        socket.data.currentUser = null;

        if (callback) callback({ success: true, room });

        const [activities, messages] = await Promise.all([
          chatService.getActivityLogs(room._id, 50),
          chatService.getMessages(room._id, 50),
        ]);
        socket.emit(E.ACTIVITY_HISTORY, activities);
        socket.emit(E.CHAT_HISTORY, messages.reverse());
      } catch (err) {
        console.error("[Socket] ROOM_SPECTATE error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.ROOM_LEAVE, async (data) => {
      try {
        const { roomCode, userId } = data;
        await roomService.disconnectUser(roomCode, userId);
        const updatedRoom = await roomService.getRoomByCode(roomCode).catch(() => null);
        socket.leave(roomCode);
        socket.to(roomCode).emit(E.ROOM_USER_LEFT, { userId });
        if (updatedRoom) {
          io.to(roomCode).emit(E.ROOM_UPDATED, {
            joinedTeams: updatedRoom.joinedTeams,
            host: updatedRoom.host,
            status: updatedRoom.status,
          });
        }
        currentRoom = null;
        currentUser = null;
        socket.data.currentRoom = null;
        socket.data.currentUser = null;
      } catch (err) {
        console.error("[Socket] ROOM_LEAVE error:", err.message);
      }
    });

    socket.on(E.ROOM_READY, async (data, callback) => {
      try {
        const { roomCode, userId, isReady } = data;
        const room = await roomService.setTeamReady(roomCode, userId, isReady);
        io.to(roomCode).emit(E.ROOM_UPDATED, { joinedTeams: room.joinedTeams });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.ROOM_KICK, async (data, callback) => {
      try {
        const { roomCode, userId, targetUserId } = data;
        const { room, kickedTeam } = await roomService.kickTeam({ roomCode, hostUserId: userId, targetUserId });

        // If auction is live, return the kicked team's players to the pool
        if (["auction", "paused"].includes(room.status) && kickedTeam.squad && kickedTeam.squad.length > 0) {
          try {
            await auctionEngine.returnPlayersToPool(roomCode, kickedTeam.squad);
          } catch (e) {
            console.error("[Socket] returnPlayersToPool error:", e.message);
          }
        }

        // Notify all clients in the room
        io.to(roomCode).emit(E.ROOM_TEAM_KICKED, {
          kickedUserId: targetUserId,
          kickedTeamName: kickedTeam.teamName,
          joinedTeams: room.joinedTeams,
        });
        io.to(roomCode).emit(E.ROOM_UPDATED, { joinedTeams: room.joinedTeams });
        if (callback) callback({ success: true });
      } catch (err) {
        console.error("[Socket] ROOM_KICK error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ──── RETENTION EVENTS ────

    socket.on(E.RETENTION_GET_PLAYERS, async (data, callback) => {
      try {
        const { roomCode } = data;
        const [config, players] = await Promise.all([
          retentionService.getRetentionConfig(roomCode),
          retentionService.getRetentionPlayers(roomCode),
        ]);
        if (callback) callback({ success: true, config, players });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.RETENTION_RETAIN, async (data, callback) => {
      try {
        const { roomCode, userId, leaguePlayerId, slotNumber } = data;
        const result = await retentionService.retainPlayer({
          roomCode,
          userId,
          leaguePlayerId,
          slotNumber,
        });
        io.to(roomCode).emit(E.RETENTION_UPDATED, {
          joinedTeams: result.room.joinedTeams,
          retainedPlayer: result.retainedPlayer,
        });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.RETENTION_REMOVE, async (data, callback) => {
      try {
        const { roomCode, userId, playerId } = data;
        const room = await retentionService.removeRetention({ roomCode, userId, playerId });
        io.to(roomCode).emit(E.RETENTION_UPDATED, {
          joinedTeams: room.joinedTeams,
        });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.RETENTION_CONFIRM, async (data, callback) => {
      try {
        const { roomCode, userId } = data;
        const { room, allReady } = await retentionService.confirmRetentions(roomCode, userId);
        io.to(roomCode).emit(E.RETENTION_UPDATED, {
          joinedTeams: room.joinedTeams,
        });
        if (allReady) {
          io.to(roomCode).emit(E.RETENTION_ALL_CONFIRMED, {});
        }
        if (callback) callback({ success: true, allReady });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ──── AUCTION EVENTS ────

    socket.on(E.AUCTION_START, async (data, callback) => {
      try {
        const { roomCode, userId } = data;
        const room = await roomService.getRoomByCode(roomCode);
        if (room.host.userId !== userId) throw new Error("Only host can start");

        await auctionEngine.initializeAuction(roomCode);
        // Start first nomination
        await auctionEngine.nominatePlayer(roomCode);

        if (callback) callback({ success: true });
      } catch (err) {
        console.error("[Socket] AUCTION_START error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_BID, async (data, callback) => {
      try {
        // ── per-socket 400ms throttle ──
        const now = Date.now();
        const last = lastBidTime.get(socket.id) || 0;
        if (now - last < BID_THROTTLE_MS) {
          if (callback) callback({ success: false, error: "Bidding too fast — wait a moment" });
          return;
        }
        lastBidTime.set(socket.id, now);

        // ── Joi validation ──
        const { error, value } = validate("AUCTION_BID", data);
        if (error) {
          socket.emit(E.AUCTION_ERROR, { error: error.message });
          if (callback) callback({ success: false, error: error.message });
          return;
        }
        const { roomCode, userId, teamName, amount } = value;
        await auctionEngine.placeBid({ roomCode, userId, teamName, amount });
        if (callback) callback({ success: true });
      } catch (err) {
        socket.emit(E.AUCTION_ERROR, { error: err.message });
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_NOMINATE, async (data, callback) => {
      try {
        const { error, value } = validate("AUCTION_NOMINATE", data);
        if (error) {
          if (callback) callback({ success: false, error: error.message });
          return;
        }
        const { roomCode, userId, leaguePlayerId } = value;
        const room = await roomService.getRoomByCode(roomCode);
        if (room.host.userId !== userId) throw new Error("Only host can nominate");
        await auctionEngine.nominatePlayer(roomCode, leaguePlayerId);
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_PAUSE, async (data, callback) => {
      try {
        const { roomCode, userId } = data;
        await auctionEngine.pauseAuction(roomCode, userId);
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_RESUME, async (data, callback) => {
      try {
        const { roomCode, userId } = data;
        await auctionEngine.resumeAuction(roomCode, userId);
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_RTM_USE, async (data, callback) => {
      try {
        const { error, value } = validate("AUCTION_RTM_USE", data);
        if (error) { if (callback) callback({ success: false, error: error.message }); return; }
        const { roomCode, userId, teamName } = value;
        await auctionEngine.useRtm({ roomCode, userId, teamName });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_RTM_PASS, async (data, callback) => {
      try {
        const { error, value } = validate("AUCTION_RTM_PASS", data);
        if (error) { if (callback) callback({ success: false, error: error.message }); return; }
        const { roomCode, userId, teamName } = value;
        await auctionEngine.passRtm({ roomCode, userId, teamName });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ── Re-auction unsold players (host only) ────────────────────────────
    socket.on("auction:nominateUnsold", async (data, callback) => {
      try {
        const { roomCode, userId } = data || {};
        if (!roomCode || !userId) {
          if (callback) callback({ success: false, error: "roomCode and userId required" });
          return;
        }
        await auctionEngine.nominateUnsold(roomCode, userId);
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_GET_STATE, async (data, callback) => {
      try {
        const { roomCode } = data;
        const state = await auctionEngine.getAuctionState(roomCode);
        if (callback) callback({ success: true, state });
        else socket.emit(E.AUCTION_STATE, state);
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_TIMER_CONFIG, async (data, callback) => {
      try {
        const { roomCode, userId, seconds } = data;
        const result = await auctionEngine.updateTimerDuration(roomCode, userId, seconds);
        io.to(roomCode).emit(E.AUCTION_TIMER_CHANGED, { seconds: result.seconds });
        if (callback) callback({ success: true, seconds: result.seconds });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ──── CHAT EVENTS ────

    socket.on(E.CHAT_SEND, async (data, callback) => {
      try {
        const { error: vErr, value: vData } = validate("CHAT_SEND", data);
        if (vErr) { if (callback) callback({ success: false, error: vErr.message }); return; }
        const { roomCode, userId, userName, teamName, message } = vData;
        const room = await roomService.getRoomByCode(roomCode);
        const participant = room.joinedTeams.find((t) => t.userId === userId);
        if (!participant) {
          throw new Error("Only active teams can chat");
        }

        const msg = await chatService.sendMessage({
          roomId: room._id,
          userId,
          userName: participant.userName || userName,
          teamName: participant.teamName || teamName,
          message,
        });
        io.to(roomCode).emit(E.CHAT_MESSAGE, {
          _id: msg._id,
          userId,
          userName: participant.userName || userName,
          teamName: participant.teamName || teamName,
          message,
          createdAt: msg.createdAt,
        });
      } catch (err) {
        console.error("[Socket] CHAT_SEND error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // ──── MATCH / SIMULATION EVENTS ────

    socket.on(E.MATCH_SUBMIT_XI, async (data, callback) => {
      try {
        const { roomCode, userId, playingXIPlayerIds, captainId, viceCaptainId } = data;
        const result = await matchService.submitPlayingXI(
          roomCode, userId, playingXIPlayerIds, captainId, viceCaptainId
        );
        // Notify the room so others can see who has confirmed
        io.to(roomCode).emit(E.MATCH_XI_CONFIRMED, {
          teamName: result.teamName,
          teamStrength: result.teamStrength,
          breakdown: result.breakdown,
        });
        io.to(roomCode).emit(E.MATCH_STRENGTH_UPDATE, {
          teamName: result.teamName,
          total: result.teamStrength,
          ...result.breakdown,
          xiConfirmed: true,
        });
        emitFeed(roomCode, "XI_CONFIRMED", {
          teamName: result.teamName,
          message: `${result.teamName} confirmed their Playing XI (Strength: ${result.teamStrength.toFixed(1)})`,
        });
        if (callback) callback({ success: true, data: result });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
        socket.emit(E.MATCH_ERROR, { error: err.message });
      }
    });

    socket.on(E.MATCH_GET_STRENGTH, async (data, callback) => {
      try {
        const { roomCode, teamName } = data;
        const result = await matchService.getTeamStrength(roomCode, teamName);
        // Push updated strength to requesting client
        socket.emit(E.MATCH_STRENGTH_UPDATE, result);
        if (callback) callback({ success: true, data: result });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.MATCH_GET_ALL_STRENGTHS, async (data, callback) => {
      try {
        const { roomCode } = data;
        const results = await matchService.getAllTeamStrengths(roomCode);
        if (callback) callback({ success: true, data: results });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.MATCH_SIMULATE, async (data, callback) => {
      try {
        const { roomCode, userId } = data;
        // Only host can trigger
        const room = await roomService.getRoomByCode(roomCode);
        if (room.host.userId !== userId) throw new Error("Only the host can simulate a match");

        const result = await matchService.simulateMatch(roomCode);
        io.to(roomCode).emit(E.MATCH_RESULTS, result);
        emitFeed(roomCode, "MATCH_SIMULATED", {
          matchNumber: result.matchNumber,
          winner: result.season?.playoffs?.champion || result.results[0]?.teamName,
          message: result.simulationType === "league"
            ? `🏆 League simulation complete! ${result.season?.playoffs?.champion || result.results[0]?.teamName} are champions!`
            : `🏆 Match ${result.matchNumber} complete! ${result.results[0]?.teamName} leads!`,
        });
        if (callback) callback({ success: true, data: result });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
        socket.emit(E.MATCH_ERROR, { error: err.message });
      }
    });

    // ──── DISCONNECT ────

    socket.on(E.DISCONNECT, async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      // Clean up bid throttle entry
      lastBidTime.delete(socket.id);
      // Emit reconnection event to the room so clients can show a toast
      if (currentRoom && currentUser) {
        socket.to(currentRoom).emit("room:user_disconnected", {
          userId: currentUser.userId,
          teamName: currentUser.teamName,
        });
      }
      if (currentRoom && currentUser) {
        try {
          const room = await roomService.disconnectUser(
            currentRoom,
            currentUser.userId
          );
          if (room) {
            socket.to(currentRoom).emit(E.ROOM_USER_LEFT, {
              userId: currentUser.userId,
              userName: currentUser.userName,
            });
            socket.to(currentRoom).emit(E.ROOM_UPDATED, {
              joinedTeams: room.joinedTeams,
              host: room.host,
              status: room.status,
            });
          }
        } catch (err) {
          console.error("[Socket] Disconnect cleanup error:", err.message);
        }
      }
    });
  });
};
