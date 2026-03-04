import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { api } from "../services/api";

export default function JoinRoom() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, updateUser } = useUser();
  const { socket } = useSocket();

  const [roomCode, setRoomCode] = useState(code || "");
  const [userName, setUserName] = useState(user.userName || "");
  const [room, setRoom] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Auto-fetch room if code is in URL
  useEffect(() => {
    if (code) fetchRoom(code);
  }, [code]);

  const fetchRoom = async (rc) => {
    setError("");
    try {
      const r = await api.getRoom(rc.toUpperCase());
      setRoom(r);
    } catch (err) {
      setError(err.message);
      setRoom(null);
    }
  };

  const handleSearch = () => {
    if (!roomCode.trim()) return setError("Enter a room code");
    fetchRoom(roomCode.trim());
  };

  const handleJoin = () => {
    if (!userName.trim()) return setError("Enter your name");
    if (!selectedTeam) return setError("Select a team");
    if (!socket) return setError("Not connected to server");

    setLoading(true);
    setError("");

    socket.emit(
      "room:join",
      {
        roomCode: room.roomCode,
        userId: user.userId,
        userName: userName.trim(),
        teamName: selectedTeam.teamName || selectedTeam.name,
      },
      (res) => {
        setLoading(false);
        if (res.success) {
          updateUser({
            userName: userName.trim(),
            teamName: selectedTeam.teamName || selectedTeam.name,
            teamShortName: selectedTeam.teamShortName || selectedTeam.shortName,
            roomCode: room.roomCode,
            isHost: false,
          });

          // Navigate based on room status
          const status = res.room?.status || room.status;
          if (status === "retention") {
            navigate(`/room/${room.roomCode}/retention`);
          } else if (status === "auction" || status === "paused") {
            navigate(`/room/${room.roomCode}/auction`);
          } else {
            navigate(`/room/${room.roomCode}/lobby`);
          }
        } else {
          setError(res.error || "Failed to join");
        }
      }
    );
  };

  // Get available teams (not already taken)
  const takenTeams = room?.joinedTeams?.map((t) => t.teamName) || [];
  const availableTeams = room?.league?.teams?.filter(
    (t) => !takenTeams.includes(t.name)
  ) || [];

  return (
    <div className="page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <div className="page-header">
        <h1>Join Room</h1>
        <p>{room ? `Joining: ${room.roomName}` : "Enter a room code to join"}</p>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", color: "var(--danger)", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!room ? (
        <div className="card">
          <div className="input-group">
            <label>Room Code</label>
            <input
              className="input"
              placeholder="e.g. ABC123"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              style={{ textTransform: "uppercase", letterSpacing: 4, fontSize: 24, textAlign: "center", fontWeight: 800 }}
            />
          </div>
          <button className="btn btn-primary btn-lg btn-block" onClick={handleSearch}>
            Search Room
          </button>
        </div>
      ) : (
        <div className="card">
          <div style={{ marginBottom: 20, padding: 16, background: "var(--bg-card)", borderRadius: 8 }}>
            <div className="flex-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{room.roomName}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>
                  {room.league?.name} · Code: {room.roomCode}
                </div>
              </div>
              <div>
                <span className={`badge badge-${room.status === "waiting" ? "success" : "info"}`}>
                  {room.status}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-muted)" }}>
              Host: {room.host?.userName} · Teams: {room.joinedTeams?.length}/{room.maxTeams}
              {room.retentionEnabled && <span className="badge badge-info" style={{ marginLeft: 8 }}>Retention</span>}
            </div>
          </div>

          <div className="input-group">
            <label>Your Name</label>
            <input className="input" placeholder="Enter your name" value={userName} onChange={(e) => setUserName(e.target.value)} />
          </div>

          <div className="input-group">
            <label>Select Your Team</label>
            {availableTeams.length === 0 ? (
              <p style={{ color: "var(--danger)" }}>All teams are taken!</p>
            ) : (
              <div className="grid-3">
                {availableTeams.map((team) => (
                  <div
                    key={team.name}
                    className={`team-card ${selectedTeam?.name === team.name ? "selected" : ""}`}
                    onClick={() => setSelectedTeam(team)}
                  >
                    <div className="team-short">{team.shortName}</div>
                    <div className="team-name">{team.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {room.joinedTeams?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>ALREADY JOINED</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                {room.joinedTeams.map((t) => (
                  <span key={t.teamName} className="badge badge-warning">{t.teamShortName} - {t.userName}</span>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg btn-block"
            onClick={handleJoin}
            disabled={loading || availableTeams.length === 0}
            style={{ marginTop: 24 }}
          >
            {loading ? "Joining..." : "Join Room"}
          </button>
        </div>
      )}
    </div>
  );
}
