import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, Lock, Globe, ChevronDown } from "lucide-react";
import { api } from "../services/api";
import { useUser } from "../context/UserContext";
import { COLORS } from "../data/constants";

export default function CreateRoom() {
  const navigate = useNavigate();
  const { user, updateUser } = useUser();
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [form, setForm] = useState({
    roomName: "",
    leagueId: "",
    teamName: "",
    userName: user.userName || "",
    retention: true,
    visibility: "public",
    playersPerTeam: 25,
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getLeagues().then((data) => {
      setLeagues(data);
      if (data.length > 0) {
        setForm((f) => ({ ...f, leagueId: data[0]._id }));
        setSelectedLeague(data[0]);
      }
    }).catch((err) => {
      console.error("[CreateRoom] Failed to load leagues:", err);
      setError("Failed to load leagues. Please refresh.");
    });
  }, []);

  useEffect(() => {
    if (form.leagueId) {
      const league = leagues.find((l) => l._id === form.leagueId);
      setSelectedLeague(league || null);
      setForm((f) => ({ ...f, teamName: "" }));
    }
  }, [form.leagueId, leagues]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.roomName.trim() || !form.userName.trim() || !form.teamName) return;
    setLoading(true);
    setError("");
    try {
      const room = await api.createRoom({
        roomName: form.roomName,
        leagueId: form.leagueId,
        userId: user.userId,
        userName: form.userName,
        teamName: form.teamName,
        teamShortName: selectedLeague?.teams?.find((t) => t.name === form.teamName)?.shortName || "",
        visibility: form.visibility,
        retentionEnabled: form.retention,
        playersPerTeam: form.playersPerTeam,
      });
      updateUser({
        userName: form.userName,
        teamName: form.teamName,
        teamShortName: selectedLeague?.teams?.find((t) => t.name === form.teamName)?.shortName || "",
        roomCode: room.roomCode,
        isHost: true,
      });
      setSuccess(true);
      const dest = form.retention
        ? `/room/${room.roomCode}/retention`
        : `/room/${room.roomCode}/lobby`;
      setTimeout(() => navigate(dest), 1000);
    } catch (err) {
      setError(err.message || "Failed to create room");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-16">
      <div className="fixed inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full opacity-10 blur-3xl pointer-events-none" style={{ background: COLORS.primary }} />

      <div className="relative w-full max-w-xl">
        <button onClick={() => navigate("/")} style={{ color: COLORS.textSecondary }} className="flex items-center gap-2 text-sm mb-6 hover:text-white transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </button>

        <div style={{ background: "rgba(30, 41, 59, 0.8)", border: `1px solid ${COLORS.border}`, backdropFilter: "blur(20px)", boxShadow: `0 0 60px ${COLORS.primary}11` }} className="rounded-3xl p-6 sm:p-10">
          <div className="flex items-center gap-4 mb-10">
            <div style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, boxShadow: `0 0 20px ${COLORS.primary}55` }} className="w-12 h-12 rounded-xl flex items-center justify-center">
              <Zap size={20} fill="#0F172A" color="#0F172A" />
            </div>
            <div>
              <h1 style={{ color: COLORS.textPrimary }} className="font-black text-2xl">Create Auction Room</h1>
              <p style={{ color: COLORS.textSecondary }} className="text-sm mt-0.5">Configure your league settings</p>
            </div>
          </div>

          {error && (
            <div style={{ background: `${COLORS.accent}22`, border: `1px solid ${COLORS.accent}44`, color: COLORS.accent }} className="text-sm px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-7">
            {/* User Name */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">Your Name <span style={{ color: COLORS.accent }}>*</span></label>
              <input type="text" placeholder="Enter your name" value={form.userName} onChange={(e) => setForm({ ...form, userName: e.target.value })}
                style={{ background: COLORS.bgMain, border: `1px solid ${form.userName ? COLORS.primary + "66" : COLORS.border}`, color: COLORS.textPrimary, outline: "none" }}
                className="w-full px-4 py-3 rounded-xl text-sm transition-all duration-200 focus:border-cyan-400" />
            </div>

            {/* Room Name */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">Room Name <span style={{ color: COLORS.accent }}>*</span></label>
              <input type="text" placeholder="e.g. IPL Mega Auction 2026" value={form.roomName} onChange={(e) => setForm({ ...form, roomName: e.target.value })}
                style={{ background: COLORS.bgMain, border: `1px solid ${form.roomName ? COLORS.primary + "66" : COLORS.border}`, color: COLORS.textPrimary, outline: "none", boxShadow: form.roomName ? `0 0 12px ${COLORS.primary}22` : "none" }}
                className="w-full px-4 py-3 rounded-xl text-sm transition-all duration-200 focus:border-cyan-400" />
            </div>

            {/* League */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">League</label>
              <div className="relative">
                <select value={form.leagueId} onChange={(e) => setForm({ ...form, leagueId: e.target.value })}
                  style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, appearance: "none", outline: "none" }}
                  className="w-full px-4 py-3 rounded-xl text-sm cursor-pointer">
                  {leagues.map((l) => (<option key={l._id} value={l._id}>{l.name} ({l.code})</option>))}
                </select>
                <ChevronDown size={16} style={{ color: COLORS.textSecondary }} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Team */}
            {selectedLeague && (
              <div>
                <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">
                  Pick Your Team <span style={{ color: COLORS.accent }}>*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {selectedLeague.teams?.map((team) => (
                    <button key={team.name} type="button" onClick={() => setForm({ ...form, teamName: team.name })}
                      style={{
                        background: form.teamName === team.name ? `${COLORS.primary}22` : COLORS.bgMain,
                        border: `1px solid ${form.teamName === team.name ? COLORS.primary : COLORS.border}`,
                        color: form.teamName === team.name ? COLORS.primary : COLORS.textSecondary,
                        boxShadow: form.teamName === team.name ? `0 0 12px ${COLORS.primary}33` : "none",
                      }}
                      className="px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left">
                      <div>{team.shortName}</div>
                      <div className="font-normal text-xs opacity-70 truncate">{team.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Squad Size */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">
                Squad Size per Team <span style={{ color: COLORS.accent }}>*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 11, label: "11", sub: "4 Overseas", desc: "Quick & High-Risk" },
                  { value: 15, label: "15", sub: "6 Overseas", desc: "Moderate Strategy" },
                  { value: 25, label: "25", sub: "8 Overseas", desc: "Deep Strategy" },
                ].map(({ value, label, sub, desc }) => (
                  <button key={value} type="button" onClick={() => setForm({ ...form, playersPerTeam: value })}
                    style={{
                      background: form.playersPerTeam === value ? `${COLORS.primary}22` : COLORS.bgMain,
                      border: `1px solid ${form.playersPerTeam === value ? COLORS.primary : COLORS.border}`,
                      color: form.playersPerTeam === value ? COLORS.primary : COLORS.textSecondary,
                      boxShadow: form.playersPerTeam === value ? `0 0 12px ${COLORS.primary}33` : "none",
                    }}
                    className="px-2 py-3 rounded-xl flex flex-col items-center gap-0.5 transition-all">
                    <span className="font-black text-xl">{label}</span>
                    <span className="text-xs font-semibold">{sub}</span>
                    <span className="text-xs opacity-60 text-center leading-tight">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-2 gap-4">
              <div style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}` }} className="p-4 rounded-xl flex items-center justify-between">
                <div>
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-medium">Retention</p>
                  <p style={{ color: COLORS.textSecondary }} className="text-xs">Allow RTM cards</p>
                </div>
                <button type="button" onClick={() => setForm({ ...form, retention: !form.retention })}
                  style={{ background: form.retention ? COLORS.primary : COLORS.border, boxShadow: form.retention ? `0 0 10px ${COLORS.primary}55` : "none" }}
                  className="relative w-11 h-6 rounded-full transition-all duration-300">
                  <span style={{ background: "white" }} className={`absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-300 ${form.retention ? "left-[22px]" : "left-0.5"}`} />
                </button>
              </div>
              <div style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}` }} className="p-4 rounded-xl flex items-center justify-between">
                <div>
                  <p style={{ color: COLORS.textPrimary }} className="text-sm font-medium">{form.visibility === "public" ? "Public" : "Private"}</p>
                  <p style={{ color: COLORS.textSecondary }} className="text-xs">Room visibility</p>
                </div>
                <button type="button" onClick={() => setForm({ ...form, visibility: form.visibility === "public" ? "private" : "public" })} className="flex items-center gap-1">
                  {form.visibility === "public" ? <Globe size={22} style={{ color: COLORS.success }} /> : <Lock size={22} style={{ color: COLORS.warning }} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" disabled={loading || !form.roomName.trim() || !form.userName.trim() || !form.teamName}
              style={{
                background: loading || !form.roomName.trim() ? COLORS.border : success ? `linear-gradient(135deg, ${COLORS.success}, #00A040)` : `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`,
                color: loading || !form.roomName.trim() ? COLORS.textSecondary : "#0F172A",
                boxShadow: !loading && form.roomName.trim() && !success ? `0 0 30px ${COLORS.primary}55` : success ? `0 0 30px ${COLORS.success}55` : "none",
                cursor: loading || !form.roomName.trim() ? "not-allowed" : "pointer",
              }}
              className="w-full py-4 rounded-xl font-black text-base transition-all duration-300 hover:scale-[1.02] flex items-center justify-center gap-2">
              {loading ? (<><span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Creating Room...</>)
                : success ? "✅ Room Created! Redirecting..."
                : (<><Zap size={18} /> Create Room</>)}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
