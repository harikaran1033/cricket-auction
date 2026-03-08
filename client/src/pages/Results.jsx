import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Download, Trophy, Wallet, Users, ArrowLeft, Star, TrendingUp, BarChart3, Copy, Check } from "lucide-react";
import { useSocket } from "../context/SocketContext";
import { useUser } from "../context/UserContext";
import { COLORS, ROLE_COLORS, formatPrice } from "../data/constants";
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

export default function Results() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { user } = useUser();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedTeam, setCopiedTeam] = useState(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit("auction:getState", { roomCode: code }, (res) => {
      setLoading(false);
      if (res?.success) setState(res.state);
    });
  }, [socket, code]);

  if (loading) {
    return (
      <div style={{ background: COLORS.bgMain }} className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: `${COLORS.primary} transparent ${COLORS.primary} ${COLORS.primary}` }} />
          <p style={{ color: COLORS.textSecondary }}>Loading results...</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div style={{ background: COLORS.bgMain }} className="flex items-center justify-center h-screen">
        <p style={{ color: COLORS.textSecondary }}>No results available.</p>
      </div>
    );
  }

  const teams = state.teams || [];
  const soldPlayers = state.soldPlayers || [];
  const totalSpent = state.totalPurseSpent || teams.reduce((s, t) => s + (t.totalPurse - t.remainingPurse), 0);
  const totalPlayersSold = state.totalPlayersSold || soldPlayers.length;
  const totalPlayersUnsold = state.totalPlayersUnsold || 0;

  // Most expensive player
  const mostExpensive = soldPlayers.length > 0 ? soldPlayers.reduce((max, p) => (p.soldPrice > max.soldPrice ? p : max), soldPlayers[0]) : null;

  // Biggest spender
  const biggestSpender = [...teams].sort((a, b) => (b.totalPurse - b.remainingPurse) - (a.totalPurse - a.remainingPurse))[0];

  // Chart data
  const chartData = teams.map((t) => ({
    name: t.teamShortName || t.teamName?.substring(0, 6) || "?",
    spent: Number(((t.totalPurse - t.remainingPurse) / 100).toFixed(1)),
    remaining: Number((t.remainingPurse / 100).toFixed(1)),
    color: COLORS.primary,
  }));

  const handleCopyTeam = (team) => {
    const squad = team.squad || [];
    const spent = team.totalPurse - team.remainingPurse;
    const lines = [
      `🏏 ${team.teamName} (${team.teamShortName})`,
      `💰 Spent: ${formatPrice(spent)} | Remaining: ${formatPrice(team.remainingPurse)}`,
      `👥 Squad: ${squad.length} players`,
      "",
      "#  | Player                 | Role           | Price     | FP",
      "---|------------------------|----------------|-----------|----",
    ];
    squad.forEach((s, i) => {
      const name = (s.player?.name || "Unknown").padEnd(22);
      const role = (s.player?.role || "—").padEnd(14);
      const price = formatPrice(s.price).padEnd(9);
      const fp = s.leaguePlayer?.fairPoint ?? "—";
      lines.push(`${String(i + 1).padStart(2)} | ${name} | ${role} | ${price} | ${fp}`);
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopiedTeam(team.teamName);
      setTimeout(() => setCopiedTeam(null), 2000);
    });
  };

  const handleDownload = () => {
    const data = teams.map((t) => ({
      team: t.teamName,
      shortName: t.teamShortName,
      players: (t.squad || []).map((s) => ({
        name: s.player?.name || `Player`,
        price: formatPrice(s.price),
        via: s.acquiredFrom,
      })),
      totalSpent: formatPrice(t.totalPurse - t.remainingPurse),
      remaining: formatPrice(t.remainingPurse),
    }));
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auction_results_${code}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-10 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/rooms")} style={{ color: COLORS.textSecondary }}><ArrowLeft size={20} /></button>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 style={{ color: COLORS.textPrimary }} className="text-2xl sm:text-3xl font-black">Auction Results</h1>
                <span style={{ background: `${COLORS.success}22`, color: COLORS.success, border: `1px solid ${COLORS.success}44`, fontFamily: "'JetBrains Mono', monospace" }}
                  className="text-xs px-2 py-0.5 rounded-full font-bold">COMPLETED</span>
              </div>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Room #{code}</p>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={handleDownload}
              style={{ background: `${COLORS.success}22`, color: COLORS.success, border: `1px solid ${COLORS.success}44` }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold hover:scale-105 transition-all">
              <Download size={16} /> Download
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
          {[
            { icon: <Wallet size={20} />, label: "Total Spent", value: formatPrice(totalSpent), color: COLORS.primary },
            { icon: <Users size={20} />, label: "Players Sold", value: `${totalPlayersSold}`, color: COLORS.success },
            { icon: <Star size={20} />, label: "Most Expensive", value: mostExpensive ? formatPrice(mostExpensive.soldPrice) : "—", color: COLORS.warning, sub: mostExpensive?.player?.name },
            { icon: <TrendingUp size={20} />, label: "Biggest Spender", value: biggestSpender?.teamShortName || "—", color: COLORS.accent },
          ].map((stat) => (
            <div key={stat.label} style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="p-5 rounded-2xl">
              <div style={{ color: stat.color, background: `${stat.color}18` }} className="w-9 h-9 rounded-lg flex items-center justify-center mb-3">{stat.icon}</div>
              <p style={{ color: COLORS.textSecondary }} className="text-xs mb-1">{stat.label}</p>
              <p style={{ color: stat.color, fontFamily: "'JetBrains Mono', monospace" }} className="text-xl font-black">{stat.value}</p>
              {stat.sub && <p style={{ color: COLORS.textSecondary }} className="text-xs mt-0.5">{stat.sub}</p>}
            </div>
          ))}
        </div>

        {/* Chart + Top Picks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
          <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="lg:col-span-2 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={16} style={{ color: COLORS.primary }} />
              <h2 style={{ color: COLORS.textPrimary }} className="font-bold">Purse Utilization</h2>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: COLORS.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: COLORS.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, borderRadius: "12px", color: COLORS.textPrimary }} />
                <Bar dataKey="spent" name="Spent (Cr)" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
                <Bar dataKey="remaining" name="Remaining (Cr)" fill={COLORS.primary + "55"} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="rounded-2xl p-5">
            <h2 style={{ color: COLORS.textPrimary }} className="font-bold mb-4 flex items-center gap-2">
              <Trophy size={16} style={{ color: COLORS.warning }} /> Top Picks
            </h2>
            <div className="space-y-3">
              {[...soldPlayers].sort((a, b) => b.soldPrice - a.soldPrice).slice(0, 5).map((sp, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span style={{ color: i === 0 ? COLORS.warning : COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }} className="text-sm font-black w-5 text-center">{i + 1}</span>
                  <div style={{ background: `${ROLE_COLORS[sp.player?.role] || COLORS.primary}22`, color: ROLE_COLORS[sp.player?.role] || COLORS.primary }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0">{(sp.player?.role || "?")[0]}</div>
                  <div className="flex-1 min-w-0">
                    <p style={{ color: COLORS.textPrimary }} className="text-xs font-bold truncate">{sp.player?.name || "Player"}</p>
                    <p style={{ color: COLORS.textSecondary }} className="text-xs">{sp.soldTo}</p>
                  </div>
                  <p style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-black">{formatPrice(sp.soldPrice)}</p>
                </div>
              ))}
              {soldPlayers.length === 0 && <p style={{ color: COLORS.textSecondary }} className="text-xs text-center py-4">No data</p>}
            </div>
          </div>
        </div>

        {/* Final Squad Cards */}
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl font-black mb-6">Final Squads</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {teams.map((team) => {
            const squad = team.squad || [];
            const spent = team.totalPurse - team.remainingPurse;
            const remaining = team.remainingPurse;
            const tColor = COLORS.primary;

            return (
              <div key={team.teamName} style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
                className="rounded-2xl overflow-hidden hover:scale-[1.02] transition-all duration-200">
                {/* Team Header */}
                <div style={{ background: `${tColor}22`, borderBottom: `1px solid ${tColor}33` }} className="p-4 flex items-center gap-3">
                  <div style={{ background: `${tColor}33`, border: `1px solid ${tColor}66`, color: tColor }}
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black">{(team.teamShortName || team.teamName || "?")[0]}</div>
                  <div className="flex-1">
                    <h3 style={{ color: COLORS.textPrimary }} className="font-black">{team.teamName}</h3>
                    <p style={{ color: tColor, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">
                      {squad.length} players · {formatPrice(spent)} spent
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p style={{ color: COLORS.textSecondary }} className="text-xs">Remaining</p>
                      <p style={{ color: remaining > 3000 ? COLORS.success : remaining > 1000 ? COLORS.warning : COLORS.accent, fontFamily: "'JetBrains Mono', monospace" }} className="font-black text-sm">{formatPrice(remaining)}</p>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleCopyTeam(team); }}
                      title="Copy squad"
                      style={{ background: copiedTeam === team.teamName ? `${COLORS.success}22` : `${COLORS.primary}11`, color: copiedTeam === team.teamName ? COLORS.success : COLORS.textSecondary, border: `1px solid ${copiedTeam === team.teamName ? COLORS.success + '44' : COLORS.border}` }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:scale-110 transition-all flex-shrink-0">
                      {copiedTeam === team.teamName ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {/* Purse Bar */}
                <div style={{ background: COLORS.bgMain, height: "4px" }}>
                  <div style={{ width: `${(spent / (team.totalPurse || 1)) * 100}%`, background: `linear-gradient(90deg, ${tColor}, ${tColor}88)`, height: "100%" }} />
                </div>

                {/* Players */}
                <div className="p-4 space-y-2">
                  {squad.length === 0 ? (
                    <p style={{ color: COLORS.textSecondary }} className="text-xs text-center py-4">No players acquired</p>
                  ) : (
                    squad.map((s, i) => {
                      const roleColor = ROLE_COLORS[s.player?.role] || COLORS.primary;
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p style={{ color: COLORS.textPrimary }} className="text-xs font-bold truncate">{s.player?.name || `Player #${i + 1}`}</p>
                              {s.acquiredFrom === "rtm" && (
                                <span style={{ background: `${COLORS.warning}22`, color: COLORS.warning }} className="text-xs px-1 rounded">RTM</span>
                              )}
                            </div>
                            <p style={{ color: COLORS.textSecondary }} className="text-xs">{s.player?.nationality || ""}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span style={{ background: `${roleColor}22`, color: roleColor }} className="text-xs px-1.5 py-0.5 rounded font-bold">{s.player?.role || "?"}</span>
                            <p style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold mt-0.5">{formatPrice(s.price)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* All Sold Players Table */}
        {soldPlayers.length > 0 && (
          <div className="mt-10">
            <h2 style={{ color: COLORS.textPrimary }} className="text-2xl font-black mb-6">All Sold Players</h2>
            <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="rounded-2xl overflow-hidden">
              <div style={{ overflowX: "auto" }}>
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
                      {["#", "Player", "Role", "Sold To", "Price", "Via"].map((h) => (
                        <th key={h} style={{ color: COLORS.textSecondary, padding: "12px 16px", textAlign: h === "Price" ? "right" : "left", fontSize: 12, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {soldPlayers.map((sp, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "10px 16px", color: COLORS.textSecondary, fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: "10px 16px", color: COLORS.textPrimary, fontSize: 12, fontWeight: 700 }}>{sp.player?.name || "—"}</td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ background: `${ROLE_COLORS[sp.player?.role] || COLORS.primary}22`, color: ROLE_COLORS[sp.player?.role] || COLORS.primary }}
                            className="text-xs px-1.5 py-0.5 rounded font-bold">{sp.player?.role || "?"}</span>
                        </td>
                        <td style={{ padding: "10px 16px", color: sp.soldTo ? COLORS.success : COLORS.accent, fontSize: 12, fontWeight: 600 }}>{sp.soldTo || "Unsold"}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700 }}>
                          {sp.soldPrice > 0 ? formatPrice(sp.soldPrice) : "—"}
                        </td>
                        <td style={{ padding: "10px 16px" }}>
                          <span style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="text-xs px-1.5 py-0.5 rounded font-bold">{sp.acquiredVia || "bid"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Play Again */}
        <div className="flex gap-4 justify-center mt-10 mb-8 flex-wrap">
          <button onClick={() => navigate("/")}
            style={{ background: COLORS.bgCard, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` }}
            className="px-6 py-3 rounded-xl font-bold text-sm hover:scale-105 transition-all">Back to Home</button>
          <button onClick={() => navigate("/create")}
            style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 24px ${COLORS.primary}44` }}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm hover:scale-105 transition-all">
            <Trophy size={16} /> Host Another Auction
          </button>
        </div>
      </div>
    </div>
  );
}