import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, X, ChevronDown, Star, Wallet, Play } from "lucide-react";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { COLORS, ROLE_COLORS, formatPrice, formatActivity } from "../data/constants";
import { api } from "../services/api";

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
  const [activityFeed, setActivityFeed] = useState([]);
  const [mobileRetentionTab, setMobileRetentionTab] = useState("players"); // "status" | "players" | "activity"

  const myTeam = teams.find((t) => t.userId === user.userId);
  const maxRetentions = config?.maxRetentions || 6;
  const myConfirmed = myTeam?.isReady;

  useEffect(() => {
    if (!socket) return;

    socket.emit("room:join", {
      roomCode: code,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
    }, (res) => {
      if (res.success) setTeams(res.room.joinedTeams || []);
    });

    socket.emit("retention:getPlayers", { roomCode: code }, (res) => {
      setLoading(false);
      if (res.success) {
        setConfig(res.config);
        setPlayers(res.players);
      } else {
        setError(res.error);
      }
    });

    socket.on("retention:updated", (data) => {
      setTeams(data.joinedTeams || []);
    });
    socket.on("retention:allConfirmed", async () => {
      try {
        await api.moveToLobby(code, user.userId);
      } catch (_) { /* room might already be in lobby */ }
      navigate(`/room/${code}/lobby`);
    });
    socket.on("room:updated", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
    });
    socket.on("activity:new", (item) => {
      setActivityFeed((prev) => [item, ...prev]);
    });

    return () => {
      socket.off("retention:updated");
      socket.off("retention:allConfirmed");
      socket.off("room:updated");
      socket.off("activity:new");
    };
  }, [socket, code]);

  const handleRetain = useCallback((leaguePlayerId) => {
    if (!socket || retaining || !myTeam) return;
    const slotNumber = (myTeam.retentions?.length || 0) + 1;
    setRetaining(true);
    setError("");
    socket.emit("retention:retain", { roomCode: code, userId: user.userId, leaguePlayerId, slotNumber }, (res) => {
      setRetaining(false);
      if (!res.success) setError(res.error);
    });
  }, [socket, myTeam, retaining, code, user.userId]);

  const handleRemove = useCallback((playerId) => {
    if (!socket) return;
    socket.emit("retention:remove", { roomCode: code, userId: user.userId, playerId }, (res) => {
      if (!res.success) setError(res.error);
    });
  }, [socket, code, user.userId]);

  const handleConfirm = useCallback(() => {
    if (!socket) return;
    socket.emit("retention:confirm", { roomCode: code, userId: user.userId }, (res) => {
      if (!res.success) setError(res.error);
    });
  }, [socket, code, user.userId]);

  if (loading) {
    return (
      <div style={{ background: COLORS.bgMain }} className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: `${COLORS.primary} transparent ${COLORS.primary} ${COLORS.primary}` }} />
          <p style={{ color: COLORS.textSecondary }}>Loading retention data...</p>
        </div>
      </div>
    );
  }

  const myTeamPlayers = players[myTeam?.teamName] || [];
  const retainedIds = new Set((myTeam?.retentions || []).map((r) => r.player?.toString()));
  const retainedCount = myTeam?.retentions?.length || 0;
  const teamColor = COLORS.primary;

  // Calculate retention cost from actual retained player prices
  const retainedCostTotal = (myTeam?.retentions || []).reduce((sum, r) => sum + (r.price || 0), 0);

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex flex-col h-screen">
      {/* Header */}
      <div style={{ background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.border}` }} className="px-6 sm:px-8 py-5 flex items-center justify-between gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(`/room/${code}/lobby`)} style={{ color: COLORS.textSecondary }} className="p-1 hover:text-white"><ArrowLeft size={20} /></button>
          <div>
            <h1 style={{ color: COLORS.textPrimary }} className="font-black text-xl">Retention Phase</h1>
            <p style={{ color: COLORS.textSecondary }} className="text-sm mt-0.5">Retain up to {maxRetentions} players per team</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={handleConfirm} disabled={myConfirmed}
            style={{
              background: myConfirmed
                ? `${COLORS.success}33`
                : `linear-gradient(135deg, ${COLORS.success}, #00A040)`,
              color: myConfirmed ? COLORS.success : "#fff",
              border: myConfirmed ? `1px solid ${COLORS.success}55` : "none",
              boxShadow: myConfirmed ? "none" : `0 0 20px ${COLORS.success}44`,
              cursor: myConfirmed ? "default" : "pointer",
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all">
            <Check size={16} />
            {myConfirmed ? "Confirmed — Waiting for others..." : "Confirm Retentions"}
          </button>
          <button onClick={() => navigate(`/room/${code}/lobby`)}
            style={{ background: COLORS.bgCard, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` }}
            className="px-5 py-2.5 rounded-xl text-sm font-bold hover:scale-105 transition-all">
            Skip
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: `${COLORS.accent}22`, color: COLORS.accent }} className="px-4 py-3 text-sm text-center">{error}</div>
      )}

      {/* Mobile tab bar (hidden on lg) */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, background: COLORS.bgCard }} className="flex lg:hidden shrink-0">
        {[["players", "Players"], ["status", "Team"], ["activity", "Activity"]].map(([key, label]) => (
          <button key={key} onClick={() => setMobileRetentionTab(key)}
            style={{
              color: mobileRetentionTab === key ? COLORS.primary : COLORS.textSecondary,
              borderBottom: `2px solid ${mobileRetentionTab === key ? COLORS.primary : "transparent"}`,
              background: "transparent",
            }}
            className="flex-1 py-3 text-sm font-bold transition-all">
            {label}
          </button>
        ))}
      </div>

      {/* Main 3-col layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 overflow-hidden min-h-0">
        {/* Left: Team & Purse */}
        <div style={{ borderRight: `1px solid ${COLORS.border}`, overflowY: "auto" }}
          className={`p-5 sm:p-6 ${mobileRetentionTab === "status" ? "block" : "hidden"} lg:block`}>
          <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-base mb-4">Your Team</h2>

          {/* Team Card */}
          <div style={{ background: `${teamColor}15`, border: `1px solid ${teamColor}44` }} className="rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-3 mb-5">
              <div style={{ background: `${teamColor}22`, color: teamColor }} className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black">
                {(myTeam?.teamShortName || "?")[0]}
              </div>
              <div>
                <p style={{ color: COLORS.textPrimary }} className="font-bold text-sm">{myTeam?.teamName}</p>
                <p style={{ color: COLORS.textSecondary }} className="text-xs">{myTeam?.teamShortName}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div style={{ background: COLORS.bgMain, borderRadius: "12px" }} className="p-4">
                <div className="flex justify-between items-center">
                  <span style={{ color: COLORS.textSecondary }} className="text-sm flex items-center gap-1.5"><Wallet size={13} /> Total Purse</span>
                  <span style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-base font-bold">{formatPrice(myTeam?.totalPurse)}</span>
                </div>
              </div>
              <div style={{ background: COLORS.bgMain, borderRadius: "12px" }} className="p-4">
                <div className="flex justify-between items-center">
                  <span style={{ color: COLORS.textSecondary }} className="text-sm flex items-center gap-1.5"><Star size={13} /> Retention Slots</span>
                  <span style={{ color: teamColor, fontFamily: "'JetBrains Mono', monospace" }} className="text-base font-bold">{retainedCount}/{maxRetentions}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  {Array(maxRetentions).fill(0).map((_, i) => (
                    <div key={i} style={{ background: i < retainedCount ? teamColor : COLORS.bgCard, border: `1px solid ${i < retainedCount ? teamColor : COLORS.border}` }}
                      className="flex-1 h-2 rounded-full transition-all" />
                  ))}
                </div>
              </div>
              <div style={{ background: COLORS.bgMain, borderRadius: "12px" }} className="p-4">
                <div className="flex justify-between items-center">
                  <span style={{ color: COLORS.textSecondary }} className="text-sm">Cost Locked</span>
                  <span style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-base font-bold">{formatPrice(retainedCostTotal)}</span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span style={{ color: COLORS.textSecondary }} className="text-sm">Remaining</span>
                  <span style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-base font-bold">{formatPrice(myTeam?.remainingPurse)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Retention Slots */}
          <div>
            <p style={{ color: COLORS.textSecondary }} className="text-xs font-medium mb-2">Retention Slots</p>
            <div className="space-y-2">
              {(config?.slots || []).map((slot, i) => {
                const retention = myTeam?.retentions?.[i];
                const retentionCost = retention?.price || 0;
                return (
                  <div key={slot.slot} style={{ background: retention ? `${COLORS.success}15` : COLORS.bgMain, border: `1px solid ${retention ? COLORS.success + "44" : COLORS.border}` }}
                    className="p-2.5 rounded-lg flex items-center justify-between">
                    <div>
                      <span style={{ color: COLORS.textSecondary }} className="text-xs">Slot {slot.slot} ({slot.type})</span>
                      {retention ? (
                        <p style={{ color: COLORS.textPrimary }} className="text-xs font-bold mt-0.5">Retained</p>
                      ) : (
                        <p style={{ color: COLORS.textSecondary }} className="text-xs mt-0.5">Empty</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{retention ? formatPrice(retentionCost) : "—"}</span>
                      {retention && (
                        <button onClick={() => handleRemove(retention.player)}><X size={14} style={{ color: COLORS.accent }} /></button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* All Teams Status */}
          <div className="mt-6">
            <p style={{ color: COLORS.textSecondary }} className="text-xs font-medium mb-2">All Teams</p>
            <div className="space-y-2">
              {teams.map((t) => (
                <div key={t.teamName} style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}` }} className="p-2.5 rounded-lg flex items-center justify-between">
                  <div>
                    <span style={{ color: COLORS.textPrimary }} className="text-xs font-bold">{t.teamShortName}</span>
                    <span style={{ color: COLORS.textSecondary }} className="text-xs ml-2">{t.userName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ color: COLORS.textSecondary }} className="text-xs">{t.retentions?.length || 0} retained</span>
                    <span style={{
                      background: t.isReady ? `${COLORS.success}22` : `${COLORS.warning}22`,
                      color: t.isReady ? COLORS.success : COLORS.warning,
                    }} className="text-xs px-1.5 py-0.5 rounded font-medium">
                      {t.isReady ? "Ready" : "Pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Player Grid */}
        <div style={{ overflowY: "auto" }}
          className={`lg:col-span-2 p-5 sm:p-6 ${mobileRetentionTab === "players" ? "block" : "hidden"} lg:block`}>
          <div className="flex items-center justify-between mb-5">
            <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-lg">Select Players to Retain</h2>
            <span style={{ color: COLORS.textSecondary }} className="text-sm">{myTeamPlayers.length} players available</span>
          </div>

          {myTeamPlayers.length === 0 ? (
            <div className="text-center py-20">
              <p style={{ color: COLORS.textSecondary }}>No players from your previous squad found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {myTeamPlayers.map((player) => {
                const isRetained = retainedIds.has(player.playerId?.toString()) || retainedIds.has(player._id?.toString());
                const roleColor = ROLE_COLORS[player.role] || COLORS.primary;
                const canRetain = retainedCount < maxRetentions || isRetained;

                return (
                  <div key={player._id} style={{
                    background: isRetained ? `${teamColor}15` : COLORS.bgCard,
                    border: `1px solid ${isRetained ? teamColor + "66" : COLORS.border}`,
                    boxShadow: isRetained ? `0 0 16px ${teamColor}22` : "none",
                  }} className="rounded-2xl overflow-hidden transition-all duration-300">
                    <div className="flex gap-3 p-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span style={{ background: `${roleColor}22`, color: roleColor, border: `1px solid ${roleColor}44` }}
                            className="text-xs px-1.5 py-0.5 rounded font-bold">{player.role}</span>
                          <span style={{ color: COLORS.textSecondary }} className="text-xs">{player.nationality} {player.isOverseas ? "🌍" : ""}</span>
                        </div>
                        <p style={{ color: COLORS.textPrimary }} className="font-bold text-sm">{player.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <p style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">
                            Retain: {formatPrice(player.franchisePrice || player.basePrice)}
                          </p>
                          <p style={{ color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs">
                            Base: {formatPrice(player.basePrice)}
                          </p>
                        </div>
                        {/* Skill Tags */}
                        {player.skills?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {player.skills.map((skill) => (
                              <span key={skill} style={{ background: `${COLORS.primary}15`, color: COLORS.primary, border: `1px solid ${COLORS.primary}33` }}
                                className="text-xs px-1.5 py-0.5 rounded-md">{skill}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Retain Button */}
                    <div className="px-5 pb-4">
                      <button onClick={() => isRetained ? handleRemove(player.playerId || player._id) : handleRetain(player._id)}
                        disabled={!canRetain && !isRetained}
                        style={{
                          background: isRetained ? `${teamColor}33` : !canRetain ? COLORS.bgMain : `${COLORS.success}22`,
                          color: isRetained ? teamColor : !canRetain ? COLORS.textSecondary : COLORS.success,
                          border: `1px solid ${isRetained ? teamColor + "66" : !canRetain ? COLORS.border : COLORS.success + "44"}`,
                          cursor: !canRetain && !isRetained ? "not-allowed" : "pointer",
                        }}
                        className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all">
                        {isRetained ? (<><Check size={13} /> Retained</>) : !canRetain ? "Retention Full" : "Retain Player"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Activity Feed */}
        <div style={{ borderLeft: `1px solid ${COLORS.border}`, overflowY: "auto" }}
          className={`p-5 sm:p-6 ${mobileRetentionTab === "activity" ? "block" : "hidden"} lg:block`}>
          <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-base mb-5">Retention Activity</h2>
          <div className="space-y-4">
            {activityFeed.length === 0 ? (
              <div style={{ background: `${COLORS.primary}11`, border: `1px dashed ${COLORS.primary}44` }} className="p-3 rounded-xl text-center">
                <p style={{ color: COLORS.textSecondary }} className="text-xs">Activity will appear as teams make retention decisions...</p>
              </div>
            ) : (
              activityFeed.map((item, i) => (
                <div key={i} style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}` }} className="p-3 rounded-xl">
                  <p style={{ color: COLORS.textPrimary }} className="text-xs">{formatActivity(item)}</p>
                  <p style={{ color: COLORS.textSecondary }} className="text-xs mt-1">
                    {item.createdAt ? new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : ""}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* RTM Info */}
          <div style={{ background: `${COLORS.warning}11`, border: `1px solid ${COLORS.warning}33` }} className="mt-6 p-4 rounded-xl">
            <p style={{ color: COLORS.warning }} className="text-xs font-bold mb-1">⚡ RTM Cards</p>
            <p style={{ color: COLORS.textSecondary }} className="text-xs">
              Retained players come with Right-to-Match (RTM) protection. Use your RTM card during auction to reclaim any sold player by matching the final bid price.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
