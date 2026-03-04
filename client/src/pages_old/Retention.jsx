import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { formatPrice } from "../utils";

export default function Retention() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();

  const [config, setConfig] = useState(null);
  const [players, setPlayers] = useState({});
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retaining, setRetaining] = useState(false);

  // Get the user's team data
  const myTeam = teams.find((t) => t.userId === user.userId);

  // Connect to room & fetch retention data
  useEffect(() => {
    if (!socket) return;

    // Join room via socket
    socket.emit("room:join", {
      roomCode: code,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
    }, (res) => {
      if (res.success) {
        setTeams(res.room.joinedTeams || []);
      }
    });

    // Fetch retention config + players
    socket.emit("retention:getPlayers", { roomCode: code }, (res) => {
      setLoading(false);
      if (res.success) {
        setConfig(res.config);
        setPlayers(res.players);
      } else {
        setError(res.error);
      }
    });

    // Listen for retention updates
    socket.on("retention:updated", (data) => {
      setTeams(data.joinedTeams || []);
    });

    socket.on("retention:allConfirmed", () => {
      navigate(`/room/${code}/lobby`);
    });

    socket.on("room:updated", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
    });

    return () => {
      socket.off("retention:updated");
      socket.off("retention:allConfirmed");
      socket.off("room:updated");
    };
  }, [socket, code]);

  const handleRetain = useCallback(
    (leaguePlayerId) => {
      if (!socket || retaining || !myTeam) return;
      const slotNumber = (myTeam.retentions?.length || 0) + 1;

      setRetaining(true);
      setError("");

      socket.emit(
        "retention:retain",
        { roomCode: code, userId: user.userId, leaguePlayerId, slotNumber },
        (res) => {
          setRetaining(false);
          if (!res.success) setError(res.error);
        }
      );
    },
    [socket, myTeam, retaining, code, user.userId]
  );

  const handleRemove = useCallback(
    (playerId) => {
      if (!socket) return;
      socket.emit(
        "retention:remove",
        { roomCode: code, userId: user.userId, playerId },
        (res) => {
          if (!res.success) setError(res.error);
        }
      );
    },
    [socket, code, user.userId]
  );

  const handleConfirm = useCallback(() => {
    if (!socket) return;
    socket.emit(
      "retention:confirm",
      { roomCode: code, userId: user.userId },
      (res) => {
        if (!res.success) setError(res.error);
      }
    );
  }, [socket, code, user.userId]);

  const handleSkip = useCallback(() => {
    navigate(`/room/${code}/lobby`);
  }, [navigate, code]);

  if (loading) {
    return (
      <div className="page flex-center" style={{ minHeight: "80vh" }}>
        <p>Loading retention data...</p>
      </div>
    );
  }

  // Get my team's players for retention
  const myTeamPlayers = players[myTeam?.teamName] || [];
  const retainedIds = new Set(
    (myTeam?.retentions || []).map((r) => r.player?.toString())
  );
  const maxRetentions = config?.maxRetentions || 6;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Player Retention</h1>
        <p>
          {myTeam?.teamName} — Purse: {formatPrice(myTeam?.remainingPurse || 0)} / {formatPrice(myTeam?.totalPurse || 0)}
        </p>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", color: "var(--danger)", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14, textAlign: "center" }}>
          {error}
        </div>
      )}

      <div className="grid-2">
        {/* Left: Available Players */}
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Available Players ({myTeamPlayers.length})</h3>
            </div>
            <div style={{ maxHeight: 500, overflowY: "auto" }} className="scrollbar-thin">
              {myTeamPlayers.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  No players from your previous squad found.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {myTeamPlayers.map((p) => {
                    const isRetained = retainedIds.has(p.playerId?.toString());
                    return (
                      <div
                        key={p._id}
                        className={`player-card ${isRetained ? "selected" : ""}`}
                        style={{ cursor: isRetained ? "default" : "pointer" }}
                      >
                        <div className="flex-between">
                          <div>
                            <div className="player-name">{p.name}</div>
                            <div className="player-role">{p.role}</div>
                            <div className="player-nation">
                              {p.nationality} {p.isOverseas && "🌍"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div className="player-price">{formatPrice(p.basePrice)}</div>
                            {isRetained ? (
                              <span className="badge badge-success" style={{ marginTop: 4 }}>Retained</span>
                            ) : myTeam?.retentions?.length < maxRetentions ? (
                              <button
                                className="btn btn-primary btn-sm"
                                style={{ marginTop: 4 }}
                                onClick={() => handleRetain(p._id)}
                                disabled={retaining}
                              >
                                {retaining ? "..." : "Retain"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Retention Slots & Other Teams */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3 className="card-title">
                Your Retentions ({myTeam?.retentions?.length || 0}/{maxRetentions})
              </h3>
            </div>
            {config?.slots?.map((slot, i) => {
              const retention = myTeam?.retentions?.[i];
              return (
                <div
                  key={slot.slot}
                  style={{
                    padding: 12,
                    background: retention ? "rgba(34,197,94,0.1)" : "var(--bg-card)",
                    borderRadius: 8,
                    marginBottom: 8,
                    border: `1px solid ${retention ? "var(--success)" : "var(--border)"}`,
                  }}
                >
                  <div className="flex-between">
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>
                        Slot {slot.slot} ({slot.type})
                      </div>
                      {retention ? (
                        <div style={{ fontWeight: 700, marginTop: 4 }}>
                          Player Retained
                        </div>
                      ) : (
                        <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 13 }}>Empty</div>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, color: "var(--warning)" }}>{formatPrice(slot.cost)}</div>
                      {retention && (
                        <button className="btn btn-danger btn-sm" style={{ marginTop: 4 }} onClick={() => handleRemove(retention.player)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Other teams status */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 className="card-title" style={{ marginBottom: 12 }}>All Teams</h3>
            {teams.map((t) => (
              <div
                key={t.teamName}
                style={{
                  padding: 10,
                  background: "var(--bg-card)",
                  borderRadius: 8,
                  marginBottom: 6,
                }}
                className="flex-between"
              >
                <div>
                  <span style={{ fontWeight: 700 }}>{t.teamShortName}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{t.userName}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12 }}>{t.retentions?.length || 0} retained</span>
                  <span className={`badge ${t.isReady ? "badge-success" : "badge-warning"}`}>
                    {t.isReady ? "Ready" : "Pending"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-success btn-lg" style={{ flex: 1 }} onClick={handleConfirm}>
              Confirm Retentions
            </button>
            <button className="btn btn-outline btn-lg" onClick={handleSkip}>
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
