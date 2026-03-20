const roomService = require("../services/roomService");
const retentionService = require("../services/retentionService");
const chatService = require("../services/chatService");
const auctionEngine = require("../auctionEngine");
const E = require("./events");

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

  auctionEngine.on("auction:initialized", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_INITIALIZED, data);
  });

  auctionEngine.on("auction:playerNominated", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_NOMINATED, data);
  });

  auctionEngine.on("auction:bidPlaced", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_BID_PLACED, data);
  });

  auctionEngine.on("auction:playerSold", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_SOLD, data);
  });

  auctionEngine.on("auction:playerUnsold", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PLAYER_UNSOLD, data);
  });

  auctionEngine.on("auction:rtmPending", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_RTM_PENDING, data);
  });

  auctionEngine.on("auction:timerTick", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_TIMER_TICK, data);
  });

  auctionEngine.on("auction:paused", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_PAUSED, data);
  });

  auctionEngine.on("auction:resumed", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_RESUMED, data);
  });

  auctionEngine.on("auction:completed", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_COMPLETED, data);
  });

  auctionEngine.on("auction:setChanged", (data) => {
    io.to(data.roomCode).emit(E.AUCTION_SET_CHANGED, data);
  });

  // ──────────── CONNECTION HANDLER ────────────

  io.on(E.CONNECTION, (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    let currentRoom = null;
    let currentUser = null;

    // ──── ROOM EVENTS ────

    socket.on(E.ROOM_JOIN, async (data, callback) => {
      try {
        const { roomCode, userId, userName, teamName } = data;
        const room = await roomService.joinRoom({ roomCode, userId, userName, teamName });

        socket.join(roomCode);
        currentRoom = roomCode;
        currentUser = { userId, userName, teamName };

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
            if (state) socket.emit(E.AUCTION_STATE, state);
          } catch (_) { /* auction might not be initialized yet */ }
        }
      } catch (err) {
        console.error("[Socket] ROOM_JOIN error:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.ROOM_SPECTATE, async (data, callback) => {
      try {
        const { roomCode, userId, userName } = data;
        const room = await roomService.getRoomByCode(roomCode);
        if (room.visibility !== "public") {
          throw new Error("Spectating is only available for public rooms");
        }

        socket.join(roomCode);
        currentRoom = roomCode;
        currentUser = null;

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
        socket.leave(roomCode);
        socket.to(roomCode).emit(E.ROOM_USER_LEFT, { userId });
        currentRoom = null;
        currentUser = null;
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
        const { roomCode, userId, teamName, amount } = data;
        await auctionEngine.placeBid({ roomCode, userId, teamName, amount });
        if (callback) callback({ success: true });
      } catch (err) {
        socket.emit(E.AUCTION_ERROR, { error: err.message });
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_NOMINATE, async (data, callback) => {
      try {
        const { roomCode, userId, leaguePlayerId } = data;
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
        const { roomCode, userId, teamName } = data;
        await auctionEngine.useRtm({ roomCode, userId, teamName });
        if (callback) callback({ success: true });
      } catch (err) {
        if (callback) callback({ success: false, error: err.message });
      }
    });

    socket.on(E.AUCTION_RTM_PASS, async (data, callback) => {
      try {
        const { roomCode, userId, teamName } = data;
        await auctionEngine.passRtm({ roomCode, userId, teamName });
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
        const { roomCode, userId, userName, teamName, message } = data;
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

    // ──── DISCONNECT ────

    socket.on(E.DISCONNECT, async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
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
          }
        } catch (err) {
          console.error("[Socket] Disconnect cleanup error:", err.message);
        }
      }
    });
  });
};
