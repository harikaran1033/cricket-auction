const roomService = require("../services/roomService");

/**
 * RoomController — HTTP handlers for room operations.
 */
class RoomController {
  async createRoom(req, res, next) {
    try {
      const room = await roomService.createRoom(req.body);
      res.status(201).json({ success: true, data: room });
    } catch (err) {
      next(err);
    }
  }

  async getPublicRooms(req, res, next) {
    try {
      const rooms = await roomService.getPublicRooms();
      res.json({ success: true, data: rooms });
    } catch (err) {
      next(err);
    }
  }

  async getRoomByCode(req, res, next) {
    try {
      const room = await roomService.getRoomByCode(req.params.code);
      // Don't expose full data for private rooms without auth
      res.json({
        success: true,
        data: {
          _id: room._id,
          roomCode: room.roomCode,
          roomName: room.roomName,
          league: room.league,
          visibility: room.visibility,
          retentionEnabled: room.retentionEnabled,
          status: room.status,
          joinedTeams: room.joinedTeams.map((t) => ({
            teamName: t.teamName,
            teamShortName: t.teamShortName,
            userName: t.userName,
            isReady: t.isReady,
            isConnected: t.isConnected,
            squadSize: t.squad.length,
            remainingPurse: t.remainingPurse,
          })),
          maxTeams: room.maxTeams,
          host: room.host,
          createdAt: room.createdAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async moveToLobby(req, res, next) {
    try {
      const { userId } = req.body;
      const room = await roomService.moveToLobby(req.params.code, userId);
      res.json({ success: true, data: room });
    } catch (err) {
      next(err);
    }
  }

  async getRoomReplay(req, res, next) {
    try {
      const replay = await roomService.getRoomReplay(req.params.code, req.query.limit);
      res.json({ success: true, data: replay });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RoomController();
