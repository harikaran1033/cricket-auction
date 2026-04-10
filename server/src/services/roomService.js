const { Room, League, ActivityLog, AuctionState, ChatMessage } = require("../models");
const ROOM_INACTIVE_TTL_MS = 10 * 60 * 1000;

/**
 * RoomService — handles room CRUD, joining, team management.
 * Pure business logic — no HTTP or socket awareness.
 */
class RoomService {
  /**
   * Create a new auction room.
   */
  async createRoom({ roomName, leagueId, userId, userName, teamName, teamShortName, visibility, retentionEnabled, playersPerTeam }) {
    const league = await League.findById(leagueId);
    if (!league) throw new Error("League not found");

    // Validate team belongs to this league
    const leagueTeam = league.teams.find((t) => t.name === teamName);
    if (!leagueTeam) throw new Error(`Team "${teamName}" not found in ${league.name}`);

    // Generate unique room code
    let roomCode;
    let exists = true;
    while (exists) {
      roomCode = Room.generateRoomCode();
      exists = await Room.findOne({ roomCode });
    }

    const room = await Room.create({
      roomCode,
      roomName,
      league: leagueId,
      host: { userId, userName },
      visibility,
      retentionEnabled,
      playersPerTeam: [11, 15, 25].includes(Number(playersPerTeam)) ? Number(playersPerTeam) : 25,
      status: retentionEnabled ? "retention" : "waiting",
      maxTeams: league.totalTeams,
      joinedTeams: [
        {
          userId,
          userName,
          teamName,
          teamShortName: leagueTeam.shortName,
          totalPurse: league.purse,
          remainingPurse: league.purse,
          squad: [],
          retentions: [],
          rtmCardsUsed: 0,
          maxRtmCards: league.retention?.maxRetentions || 0,
          isReady: false,
          isConnected: true,
        },
      ],
      auctionConfig: {
        timerSeconds: 15,
        bidIncrement: 25,
      },
    });

    // Activity log
    await ActivityLog.create({
      room: room._id,
      type: "ROOM_CREATED",
      payload: { roomName, leagueName: league.name, teamName },
      userId,
      userName,
    });

    return room.populate("league");
  }

  /**
   * Join an existing room.
   */
  async joinRoom({ roomCode, userId, userName, teamName }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    if (room.status === "completed") {
      throw new Error("Cannot join — auction has completed");
    }

    // Check if user was kicked from this room
    if (room.kickedUsers && room.kickedUsers.includes(userId)) {
      throw new Error("You have been kicked from this room and cannot rejoin.");
    }

    // Check if user already in room
    const alreadyJoined = room.joinedTeams.find((t) => t.userId === userId);
    if (alreadyJoined) {
      // Reconnecting — mark connected
      alreadyJoined.isConnected = true;
      room.inactiveAt = null;
      if (room.status === "inactive") {
        room.status = room.retentionEnabled ? "retention" : "waiting";
      }
      room.lastActiveAt = new Date();
      await room.save();
      return room;
    }

    if (room.status === "inactive") {
      throw new Error("Room is inactive");
    }

    if (room.joinedTeams.length >= room.maxTeams) {
      throw new Error("Room is full");
    }

    // Check if team already taken
    const teamTaken = room.joinedTeams.find((t) => t.teamName === teamName);
    if (teamTaken) throw new Error(`Team "${teamName}" is already taken`);

    // Validate team belongs to league
    const leagueTeam = room.league.teams.find((t) => t.name === teamName);
    if (!leagueTeam) throw new Error(`Team "${teamName}" not in ${room.league.name}`);

    const isLateJoin = ["auction", "paused"].includes(room.status);

    // Late joiners get full RTM cards (they skipped retention, so all slots become RTM)
    const maxRtm = isLateJoin && room.retentionEnabled
      ? (room.league.retention?.maxRetentions || 0)
      : (room.league.retention?.maxRetentions || 0);

    room.joinedTeams.push({
      userId,
      userName,
      teamName,
      teamShortName: leagueTeam.shortName,
      totalPurse: room.league.purse,
      remainingPurse: room.league.purse,
      squad: [],
      retentions: [],
      rtmCardsUsed: 0,
      maxRtmCards: maxRtm,
      isReady: isLateJoin, // auto-ready for late joiners
      isConnected: true,
    });

    room.inactiveAt = null;
    room.lastActiveAt = new Date();
    await room.save();

    await ActivityLog.create({
      room: room._id,
      type: "TEAM_JOINED",
      payload: { teamName, userName },
      userId,
      userName,
    });

    return room;
  }

  /**
   * Get room by code (for joining).
   */
  async getRoomByCode(roomCode) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    return room;
  }

  /**
   * Get all public live rooms.
   */
  async getPublicRooms() {
    return Room.find({
      visibility: "public",
      status: { $in: ["waiting", "retention", "lobby", "auction", "paused"] },
      inactiveAt: null,
    })
      .populate("league", "name code")
      .select("roomCode roomName league joinedTeams maxTeams status retentionEnabled createdAt")
      .sort({ createdAt: -1 })
      .limit(50);
  }

  /**
   * Return a normalized replay timeline for a room.
   */
  async getRoomReplay(roomCode, limit = 500) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");

    const logs = await ActivityLog.find({ room: room._id })
      .sort({ createdAt: 1 })
      .limit(Math.max(50, Math.min(Number(limit) || 500, 2000)))
      .lean();

    const events = logs.map((log, index) => ({
      id: `${log._id}`,
      seq: index + 1,
      type: log.type,
      at: log.createdAt,
      userName: log.userName || "",
      payload: log.payload || {},
    }));

    return {
      room: {
        roomCode: room.roomCode,
        roomName: room.roomName,
        league: room.league?.name || room.league?.code || "",
      },
      events,
    };
  }

  /**
   * Mark a team as ready in the lobby.
   */
  async setTeamReady(roomCode, userId, isReady) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (!team) throw new Error("Team not found in room");

    team.isReady = isReady;
    await room.save();
    return room;
  }

  /**
   * Move room to lobby status (after retention or directly).
   */
  async moveToLobby(roomCode, userId) {
    const room = await Room.findOne({ roomCode });
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== userId) throw new Error("Only host can move to lobby");

    room.status = "lobby";
    await room.save();
    return room;
  }

  /**
   * Mark user disconnected.
   */
  async disconnectUser(roomCode, userId) {
    const room = await Room.findOne({ roomCode });
    if (!room) return null;

    const team = room.joinedTeams.find((t) => t.userId === userId);
    if (team) {
      team.isConnected = false;
      room.lastActiveAt = new Date();

      const connectedTeams = room.joinedTeams.filter((t) => t.isConnected);
      const disconnectedTeam = room.joinedTeams.find((t) => t.userId === userId);
      const hostLeft = room.host.userId === userId;

      if (hostLeft) {
        const nextHost = connectedTeams.find((t) => t.userId !== userId) || connectedTeams[0];
        if (nextHost) {
          room.host = {
            userId: nextHost.userId,
            userName: nextHost.userName,
          };
          room.inactiveAt = null;
          await ActivityLog.create({
            room: room._id,
            type: "HOST_REASSIGNED",
            payload: { previousHost: disconnectedTeam?.userName, newHost: nextHost.userName },
            userId: nextHost.userId,
            userName: nextHost.userName,
          });
        } else {
          room.status = "inactive";
          room.inactiveAt = new Date();
        }
      } else if (connectedTeams.length === 0) {
        room.status = "inactive";
        room.inactiveAt = new Date();
      }

      await room.save();
    }
    return room;
  }

  async cleanupInactiveRooms() {
    const cutoff = new Date(Date.now() - ROOM_INACTIVE_TTL_MS);
    const staleRooms = await Room.find({
      $or: [
        { status: "inactive", inactiveAt: { $lte: cutoff } },
        {
          inactiveAt: { $lte: cutoff },
          status: { $in: ["waiting", "retention", "lobby", "auction", "paused"] },
        },
      ],
    }).select("_id");

    if (staleRooms.length === 0) return 0;
    const roomIds = staleRooms.map((room) => room._id);
    await AuctionState.deleteMany({ room: { $in: roomIds } });
    await ChatMessage.deleteMany({ room: { $in: roomIds } });
    await ActivityLog.deleteMany({ room: { $in: roomIds } });
    await Room.deleteMany({ _id: { $in: roomIds } });
    return roomIds.length;
  }

  /**
   * Kick a team from the room (host only).
   */
  async kickTeam({ roomCode, hostUserId, targetUserId }) {
    const room = await Room.findOne({ roomCode }).populate("league");
    if (!room) throw new Error("Room not found");
    if (room.host.userId !== hostUserId) throw new Error("Only host can kick teams");
    if (targetUserId === hostUserId) throw new Error("Cannot kick yourself");

    const teamIdx = room.joinedTeams.findIndex((t) => t.userId === targetUserId);
    if (teamIdx === -1) throw new Error("Team not found in room");

    const kicked = room.joinedTeams[teamIdx];
    room.joinedTeams.splice(teamIdx, 1);

    // Add to kicked users list so they cannot rejoin
    if (!room.kickedUsers) room.kickedUsers = [];
    room.kickedUsers.push(targetUserId);

    await room.save();

    await ActivityLog.create({
      room: room._id,
      type: "TEAM_KICKED",
      payload: { teamName: kicked.teamName, userName: kicked.userName },
      userId: hostUserId,
      userName: room.host.userName,
    });

    return { room, kickedTeam: kicked };
  }

  /**
   * Get room by ID.
   */
  async getRoomById(roomId) {
    return Room.findById(roomId).populate("league");
  }
}

module.exports = new RoomService();
