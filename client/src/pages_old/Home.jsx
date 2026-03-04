import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function Home() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPublicRooms()
      .then(setRooms)
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>🏏 Cricket Auction</h1>
        <p>Host your own room, join a team, or spectate any public auction in real time.</p>
      </div>

      <div className="grid-2" style={{ maxWidth: 800, margin: "0 auto" }}>
        <Link to="/create" className="btn btn-primary btn-lg btn-block" style={{ fontSize: 18, padding: "24px" }}>
          + Create Room
        </Link>
        <Link to="/join" className="btn btn-outline btn-lg btn-block" style={{ fontSize: 18, padding: "24px" }}>
          Join Room
        </Link>
      </div>

      <div style={{ maxWidth: 800, margin: "40px auto 0" }}>
        <h2 style={{ marginBottom: 16 }}>Live Rooms</h2>
        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
        ) : rooms.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No public rooms available. Create one!</p>
        ) : (
          <div className="room-list">
            {rooms.map((room) => (
              <div
                key={room.roomCode}
                className="room-item"
                style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{room.roomName}</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                    {room.league?.name} · {room.roomCode}
                    {room.retentionEnabled && (
                      <span className="badge badge-info" style={{ marginLeft: 8 }}>Retention</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 220 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {room.joinedTeams?.length || 0} / {room.maxTeams}
                  </div>
                  <div className={`badge badge-${room.status === "waiting" ? "success" : room.status === "auction" ? "danger" : "warning"}`}>
                    {room.status}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    {(room.joinedTeams?.length || 0) < room.maxTeams && (
                      <Link
                        to={`/join/${room.roomCode}`}
                        className="btn btn-outline btn-sm"
                        style={{ flex: 1, textAlign: "center" }}
                      >
                        Join
                      </Link>
                    )}
                    <Link
                      to={`/room/${room.roomCode}/auction?spectate=1`}
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, textAlign: "center" }}
                    >
                      Spectate
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
