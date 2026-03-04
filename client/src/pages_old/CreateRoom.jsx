import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { api } from "../services/api";

export default function CreateRoom() {
  const navigate = useNavigate();
  const { user, updateUser } = useUser();

  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [roomName, setRoomName] = useState("");
  const [userName, setUserName] = useState(user.userName || "");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [visibility, setVisibility] = useState("public");
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getLeagues().then(setLeagues).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!roomName.trim()) return setError("Room name is required");
    if (!userName.trim()) return setError("Your name is required");
    if (!selectedLeague) return setError("Select a league");
    if (!selectedTeam) return setError("Select a team");

    setLoading(true);
    setError("");

    try {
      const room = await api.createRoom({
        roomName: roomName.trim(),
        leagueId: selectedLeague._id,
        userId: user.userId,
        userName: userName.trim(),
        teamName: selectedTeam.name,
        teamShortName: selectedTeam.shortName,
        visibility,
        retentionEnabled,
      });

      updateUser({
        userName: userName.trim(),
        teamName: selectedTeam.name,
        teamShortName: selectedTeam.shortName,
        roomCode: room.roomCode,
        isHost: true,
      });

      if (retentionEnabled) {
        navigate(`/room/${room.roomCode}/retention`);
      } else {
        navigate(`/room/${room.roomCode}/lobby`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <div className="page-header">
        <h1>Create Room</h1>
        <p>Set up your auction room</p>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", color: "var(--danger)", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      <div className="card">
        <div className="input-group">
          <label>Room Name</label>
          <input className="input" placeholder="e.g. IPL Mega Auction 2026" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        </div>

        <div className="input-group">
          <label>Your Name</label>
          <input className="input" placeholder="Enter your name" value={userName} onChange={(e) => setUserName(e.target.value)} />
        </div>

        <div className="input-group">
          <label>Select League</label>
          <select className="select" value={selectedLeague?._id || ""} onChange={(e) => {
            const league = leagues.find((l) => l._id === e.target.value);
            setSelectedLeague(league);
            setSelectedTeam(null);
          }}>
            <option value="">Choose a league...</option>
            {leagues.map((l) => (
              <option key={l._id} value={l._id}>{l.name} ({l.code})</option>
            ))}
          </select>
        </div>

        {selectedLeague && (
          <div className="input-group">
            <label>Select Your Team</label>
            <div className="grid-3">
              {selectedLeague.teams.map((team) => (
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
          </div>
        )}

        <div className="input-group">
          <label>Visibility</label>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              className={`btn ${visibility === "public" ? "btn-primary" : "btn-outline"} btn-sm`}
              onClick={() => setVisibility("public")}
            >
              Public
            </button>
            <button
              className={`btn ${visibility === "private" ? "btn-primary" : "btn-outline"} btn-sm`}
              onClick={() => setVisibility("private")}
            >
              Private
            </button>
          </div>
        </div>

        <div className="input-group">
          <label>Player Retention</label>
          <div className="toggle-group">
            <div className={`toggle ${retentionEnabled ? "active" : ""}`} onClick={() => setRetentionEnabled(!retentionEnabled)} />
            <span style={{ fontSize: 14 }}>{retentionEnabled ? "Enabled" : "Disabled"}</span>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg btn-block"
          onClick={handleCreate}
          disabled={loading}
          style={{ marginTop: 16 }}
        >
          {loading ? "Creating..." : "Create Room"}
        </button>
      </div>
    </div>
  );
}
