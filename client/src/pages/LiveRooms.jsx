import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Users, Filter, ChevronDown, Plus, Eye } from "lucide-react";
import { api } from "../services/api";
import { COLORS, LEAGUE_COLORS } from "../data/constants";
import StatusBadge from "../components/StatusBadge";

const ALL_LEAGUES = ["All", "IPL", "BBL", "CPL", "PSL", "T20", "WC", "PL", "CT"];

export default function LiveRooms() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [search, setSearch] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("All");
  const [liveOnly, setLiveOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPublicRooms()
      .then((data) => setRooms(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = rooms.filter((r) => {
    const matchSearch =
      (r.roomName || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.host?.userName || "").toLowerCase().includes(search.toLowerCase());
    const matchLeague =
      leagueFilter === "All" || (r.league?.name || "").toUpperCase().includes(leagueFilter);
    const matchLive = !liveOnly || r.status === "auction";
    return matchSearch && matchLeague && matchLive;
  });

  const getStatusAction = (status, roomCode) => {
    switch (status) {
      case "auction": return { label: "Watch Live", path: `/room/${roomCode}/auction?spectate=1`, color: COLORS.accent };
      case "waiting": case "lobby": return { label: "Join Lobby", path: `/join/${roomCode}`, color: COLORS.primary };
      case "retention": return { label: "View Retention", path: `/join/${roomCode}`, color: COLORS.warning };
      case "completed": return { label: "View Results", path: `/room/${roomCode}/results`, color: COLORS.textSecondary };
      default: return { label: "View", path: `/join/${roomCode}`, color: COLORS.primary };
    }
  };

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex-1 w-full px-6 sm:px-8 py-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-10">
          <div>
            <h1 style={{ color: COLORS.textPrimary }} className="text-3xl font-black">Live Auction Rooms</h1>
            <p style={{ color: COLORS.textSecondary }} className="text-sm mt-1">
              {filtered.length} rooms found · {rooms.filter((r) => r.status === "auction").length} live now
            </p>
          </div>
          <button onClick={() => navigate("/create")}
            style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 20px ${COLORS.primary}44` }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black hover:scale-105 transition-all">
            <Plus size={17} /> Create Room
          </button>
        </div>

        {/* Filters */}
        <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
          className="rounded-2xl p-5 mb-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="relative flex-1">
            <Search size={16} style={{ color: COLORS.textSecondary }} className="absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="Search rooms or hosts..." value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, outline: "none" }}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm" />
          </div>
          <div className="relative">
            <select value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)}
              style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, outline: "none", appearance: "none", paddingRight: "2.5rem" }}
              className="pl-4 pr-10 py-2.5 rounded-xl text-sm cursor-pointer">
              {ALL_LEAGUES.map((l) => (<option key={l} value={l}>{l}</option>))}
            </select>
            <ChevronDown size={14} style={{ color: COLORS.textSecondary }} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button onClick={() => setLiveOnly(!liveOnly)}
            style={{ background: liveOnly ? `${COLORS.accent}22` : COLORS.bgMain, border: `1px solid ${liveOnly ? COLORS.accent : COLORS.border}`, color: liveOnly ? COLORS.accent : COLORS.textSecondary, boxShadow: liveOnly ? `0 0 12px ${COLORS.accent}33` : "none" }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all">
            <span style={{ background: liveOnly ? COLORS.accent : COLORS.textSecondary }} className="w-2 h-2 rounded-full animate-pulse" />
            Live Only
          </button>
        </div>

        {/* Room Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: `${COLORS.primary} transparent ${COLORS.primary} ${COLORS.primary}` }} />
            <p style={{ color: COLORS.textSecondary }}>Loading rooms...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Filter size={40} style={{ color: COLORS.textSecondary, margin: "0 auto 12px" }} />
            <p style={{ color: COLORS.textSecondary }} className="text-base">No rooms match your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((room) => {
              const action = getStatusAction(room.status, room.roomCode);
              const leagueName = room.league?.name || "";
              const leagueColor = LEAGUE_COLORS[leagueName.toUpperCase()] || COLORS.primary;
              const teamsJoined = room.joinedTeams?.length || 0;
              const maxTeams = room.maxTeams || 10;
              const fillPct = Math.round((teamsJoined / maxTeams) * 100);

              return (
                <div key={room._id || room.roomCode}
                  style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
                  className="rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.02] cursor-pointer group"
                  onClick={() => navigate(action.path)}>
                  <div style={{ height: "3px", background: `linear-gradient(90deg, ${leagueColor}, transparent)` }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 style={{ color: COLORS.textPrimary }} className="font-bold truncate">{room.roomName}</h3>
                        <p style={{ color: COLORS.textSecondary }} className="text-xs mt-0.5">by {room.host?.userName || "Host"}</p>
                      </div>
                      <StatusBadge status={room.status} />
                    </div>
                    <div className="flex items-center gap-2 mb-4">
                      <span style={{ background: `${leagueColor}22`, color: leagueColor, border: `1px solid ${leagueColor}44`, fontFamily: "'JetBrains Mono', monospace" }}
                        className="text-xs px-2 py-0.5 rounded-md font-bold">
                        {leagueName || "Custom"}
                      </span>
                      {room.retentionEnabled && (
                        <span style={{ background: `${COLORS.warning}22`, color: COLORS.warning, border: `1px solid ${COLORS.warning}44` }}
                          className="text-xs px-2 py-0.5 rounded-md font-medium">RTM</span>
                      )}
                      {room.visibility === "private" && (
                        <span style={{ background: `${COLORS.textSecondary}22`, color: COLORS.textSecondary }}
                          className="text-xs px-2 py-0.5 rounded-md">🔒 Private</span>
                      )}
                    </div>
                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-1.5">
                        <span style={{ color: COLORS.textSecondary }} className="text-xs flex items-center gap-1"><Users size={12} /> Teams</span>
                        <span style={{ color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{teamsJoined}/{maxTeams}</span>
                      </div>
                      <div style={{ background: COLORS.bgMain, height: "5px", borderRadius: "99px", overflow: "hidden" }}>
                        <div style={{ width: `${fillPct}%`, background: fillPct === 100 ? `linear-gradient(90deg, ${COLORS.success}, #00A040)` : `linear-gradient(90deg, ${leagueColor}, ${leagueColor}88)`, height: "100%", borderRadius: "99px", transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); navigate(action.path); }}
                      style={{ background: `${action.color}22`, color: action.color, border: `1px solid ${action.color}44`, boxShadow: room.status === "auction" ? `0 0 12px ${action.color}33` : "none" }}
                      className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:opacity-80 transition-opacity">
                      <Eye size={15} /> {action.label}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
