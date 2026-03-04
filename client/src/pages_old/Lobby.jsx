import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { formatPrice } from "../utils";
import ChatPanel from "../components/chat/ChatPanel";

export default function Lobby() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();

  const [room, setRoom] = useState(null);
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const isHost = room?.host?.userId === user.userId;

  useEffect(() => {
    if (!socket) return;

    // Join room
    socket.emit("room:join", {
      roomCode: code,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
    }, (res) => {
      if (res.success) {
        setRoom(res.room);
        setTeams(res.room.joinedTeams || []);
      } else {
        setError(res.error);
      }
    });

    socket.on("room:updated", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
    });

    socket.on("room:userJoined", (data) => {
      setTeams(data.joinedTeams || []);
    });

    socket.on("room:userLeft", () => {
      // Refresh
    });

    socket.on("auction:initialized", () => {
      navigate(`/room/${code}/auction`);
    });

    return () => {
      socket.off("room:updated");
      socket.off("room:userJoined");
      socket.off("room:userLeft");
      socket.off("auction:initialized");
    };
  }, [socket, code]);

  const handleReady = () => {
    socket.emit("room:ready", {
      roomCode: code,
      userId: user.userId,
      isReady: true,
    });
  };

  const handleStart = () => {
    setStarting(true);
    socket.emit("auction:start", {
      roomCode: code,
      userId: user.userId,
    }, (res) => {
      setStarting(false);
      if (res.success) {
        navigate(`/room/${code}/auction`);
      } else {
        setError(res.error);
      }
    });
  };

  const allReady = teams.length >= 2 && teams.every((t) => t.isReady);
  const myTeam = teams.find((t) => t.userId === user.userId);

  return (
    <div className="page">
      <div className="page-header">
        <h1>{room?.roomName || "Lobby"}</h1>
        <p>
          Room Code: <strong style={{ fontSize: 20, letterSpacing: 4, color: "var(--accent)" }}>{code}</strong>
          {room?.visibility === "private" && <span className="badge badge-warning" style={{ marginLeft: 12 }}>Private</span>}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", color: "var(--danger)", padding: 12, borderRadius: 8, marginBottom: 16, textAlign: "center" }}>
          {error}
        </div>
      )}

      <div className="grid-2">
        {/* Left: Teams */}
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Teams ({teams.length}/{room?.maxTeams || "?"})</h3>
              {isHost && (
                <span className="badge badge-info">You are Host</span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {teams.map((t) => (
                <div
                  key={t.teamName}
                  style={{
                    padding: 16,
                    background: t.userId === user.userId ? "rgba(59,130,246,0.1)" : "var(--bg-card)",
                    borderRadius: 8,
                    border: `2px solid ${t.userId === user.userId ? "var(--accent)" : "transparent"}`,
                  }}
                >
                  <div className="flex-between">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        {t.teamShortName} — {t.teamName}
                        {t.userId === room?.host?.userId && (
                          <span style={{ fontSize: 11, color: "var(--warning)", marginLeft: 8 }}>👑 HOST</span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                        {t.userName} · Purse: {formatPrice(t.remainingPurse)}
                        {t.retentions?.length > 0 && ` · ${t.retentions.length} retained`}
                      </div>
                    </div>
                    <div>
                      {t.isConnected ? (
                        <span className={`badge ${t.isReady ? "badge-success" : "badge-warning"}`}>
                          {t.isReady ? "Ready" : "Not Ready"}
                        </span>
                      ) : (
                        <span className="badge badge-danger">Disconnected</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {teams.length < (room?.maxTeams || 10) && (
                <div style={{ padding: 16, background: "var(--bg-card)", borderRadius: 8, textAlign: "center", border: "2px dashed var(--border)" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Waiting for more teams...</p>
                </div>
              )}
            </div>

            <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
              {!myTeam?.isReady && (
                <button className="btn btn-success btn-lg" style={{ flex: 1 }} onClick={handleReady}>
                  Ready Up
                </button>
              )}
              {isHost && (
                <button
                  className="btn btn-primary btn-lg"
                  style={{ flex: 1 }}
                  onClick={handleStart}
                  disabled={starting}
                >
                  {starting ? "Starting..." : `Start Auction (${teams.length} team${teams.length !== 1 ? "s" : ""})`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Chat */}
        <div>
          <ChatPanel roomCode={code} />
        </div>
      </div>
    </div>
  );
}
