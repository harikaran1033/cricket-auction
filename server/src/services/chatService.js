const { ChatMessage, ActivityLog } = require("../models");

/**
 * ChatService — room-scoped chat & activity logs.
 */
class ChatService {
  async sendMessage({ roomId, userId, userName, teamName, message }) {
    return ChatMessage.create({ room: roomId, userId, userName, teamName, message });
  }

  async getMessages(roomId, limit = 50) {
    return ChatMessage.find({ room: roomId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getActivityLogs(roomId, limit = 100) {
    return ActivityLog.find({ room: roomId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  /**
   * clearRoom — purge all chat messages and activity logs for a room.
   * Called when the auction completes to reclaim storage.
   */
  async clearRoom(roomId) {
    await Promise.all([
      ChatMessage.deleteMany({ room: roomId }),
      ActivityLog.deleteMany({ room: roomId }),
    ]);
  }
}

module.exports = new ChatService();
