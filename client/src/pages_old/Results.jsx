import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useSocket } from "../context/SocketContext";
import { useUser } from "../context/UserContext";
import { formatPrice } from "../utils";

export default function Results() {
  const { code } = useParams();
  const { socket } = useSocket();
  const { user } = useUser();
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!socket) return;

    socket.emit("auction:getState", { roomCode: code }, (res) => {
      if (res.success) setState(res.state);
    });
  }, [socket, code]);

  if (!state) {
    return (
      <div className="page flex-center" style={{ minHeight: "80vh" }}>
        <p>Loading results...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>🏆 Auction Results</h1>
        <p>
          {state.totalPlayersSold} sold · {state.totalPlayersUnsold} unsold ·
          Total spent: {formatPrice(state.totalPurseSpent || 0)}
        </p>
      </div>

      {/* Teams with squads */}
      <div className="grid-2">
        {(state.teams || []).map((team) => (
          <div key={team.teamName} className="card">
            <div className="card-header">
              <h3 className="card-title">{team.teamShortName} — {team.teamName}</h3>
              <div>
                <span className="badge badge-info">{team.squadSize ?? team.squad?.length ?? 0} players</span>
                <span style={{ marginLeft: 8, fontWeight: 700, color: "var(--success)" }}>
                  {formatPrice(team.remainingPurse)} left
                </span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(team.squad || []).map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: 10,
                    background: "var(--bg-card)",
                    borderRadius: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600 }}>Player #{i + 1}</span>
                    {s.isOverseas && <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 10 }}>OS</span>}
                    <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>{s.acquiredFrom}</span>
                  </div>
                  <span style={{ fontWeight: 700, color: "var(--success)" }}>{formatPrice(s.price)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Sold players list */}
      {state.soldPlayers?.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 16 }}>All Sold Players</h2>
          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: 10, textAlign: "left" }}>#</th>
                    <th style={{ padding: 10, textAlign: "left" }}>Player</th>
                    <th style={{ padding: 10, textAlign: "left" }}>Sold To</th>
                    <th style={{ padding: 10, textAlign: "right" }}>Price</th>
                    <th style={{ padding: 10, textAlign: "center" }}>Via</th>
                  </tr>
                </thead>
                <tbody>
                  {state.soldPlayers.map((sp, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: 10 }}>{i + 1}</td>
                      <td style={{ padding: 10, fontWeight: 600 }}>{sp.player?.name || "—"}</td>
                      <td style={{ padding: 10 }}>
                        <span style={{ color: sp.soldTo ? "var(--success)" : "var(--danger)" }}>
                          {sp.soldTo || "Unsold"}
                        </span>
                      </td>
                      <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>
                        {sp.soldPrice > 0 ? formatPrice(sp.soldPrice) : "—"}
                      </td>
                      <td style={{ padding: 10, textAlign: "center" }}>
                        <span className="badge badge-info">{sp.acquiredVia}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
