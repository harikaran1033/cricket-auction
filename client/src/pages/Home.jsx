import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Zap, Users, MessageSquare, Shield, TrendingUp, ArrowRight, Trophy, Clock } from "lucide-react";
import { api } from "../services/api";
import { COLORS } from "../data/constants";
import StatusBadge from "../components/StatusBadge";

const FEATURES = [
  {
    icon: <Zap size={28} />,
    title: "Realtime Bidding",
    description: "Lightning-fast bid processing with sub-100ms latency. Every bid is reflected instantly across all participants.",
    color: "#00E5FF",
  },
  {
    icon: <Shield size={28} />,
    title: "Retention Mode",
    description: "Teams can retain star players before the auction begins. Full RTM (Right to Match) card system included.",
    color: "#FFD600",
  },
  {
    icon: <MessageSquare size={28} />,
    title: "Live Chat",
    description: "In-auction chat with team-based identity. Taunt opponents, celebrate wins, and negotiate in real time.",
    color: "#00C853",
  },
  {
    icon: <TrendingUp size={28} />,
    title: "Team Dashboard",
    description: "Track purse usage, player compositions, and rival team spending with detailed live analytics.",
    color: "#FF3D00",
  },
];

const STATS = [
  { value: "50K+", label: "Auctions Hosted" },
  { value: "2M+", label: "Bids Placed" },
  { value: "180+", label: "Leagues Supported" },
  { value: "99.9%", label: "Uptime" },
];

export default function Home() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    api.getPublicRooms().then(setRooms).catch(() => setRooms([]));
  }, []);

  const liveRooms = rooms.filter((r) => r.status === "auction");

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="w-full flex-1">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`, backgroundSize: "64px 64px" }} />
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: COLORS.primary }} />
        <div className="absolute top-40 right-1/4 w-80 h-80 rounded-full opacity-10 blur-3xl" style={{ background: COLORS.accent }} />

        <div className="relative max-w-6xl mx-auto px-6 pt-28 pb-24 text-center">
          {liveRooms.length > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8" style={{ background: `${COLORS.accent}22`, border: `1px solid ${COLORS.accent}44` }}>
              <span style={{ background: COLORS.accent }} className="w-2 h-2 rounded-full animate-pulse" />
              <span style={{ color: COLORS.accent, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold tracking-widest">
                {liveRooms.length} LIVE AUCTION{liveRooms.length > 1 ? "S" : ""} NOW
              </span>
            </div>
          )}

          <h1 style={{ color: COLORS.textPrimary }} className="text-5xl md:text-7xl font-black mb-8 leading-tight">
            The Ultimate<br />
            <span style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF, ${COLORS.primary})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Auction Arena
            </span>
          </h1>

          <p style={{ color: COLORS.textSecondary }} className="text-lg md:text-xl mb-12 max-w-2xl mx-auto leading-relaxed">
            Host world-class multiplayer sports auctions with real-time bidding, retention mechanics, live chat, and an immersive esports-grade dashboard.
          </p>

          <div className="flex flex-col sm:flex-row gap-5 justify-center">
            <button onClick={() => navigate("/create")} style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 30px ${COLORS.primary}66` }} className="flex items-center justify-center gap-3 px-10 py-4.5 rounded-2xl text-base font-black transition-all duration-200 hover:scale-105 hover:shadow-2xl">
              <Trophy size={20} /> Create Room <ArrowRight size={18} />
            </button>
            <button onClick={() => navigate("/join")} style={{ background: COLORS.bgCard, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` }} className="flex items-center justify-center gap-3 px-10 py-4.5 rounded-2xl text-base font-bold transition-all duration-200 hover:border-cyan-400 hover:scale-105">
              <Users size={20} /> Join Room
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-24">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div style={{ color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace" }} className="text-3xl md:text-4xl font-bold mb-2">{stat.value}</div>
                <div style={{ color: COLORS.textSecondary }} className="text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 style={{ color: COLORS.textPrimary }} className="text-3xl font-black mb-4">Built for Intense Competition</h2>
          <p style={{ color: COLORS.textSecondary }} className="text-lg max-w-xl mx-auto">Every feature engineered to maximize the thrill of live sports auctions</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="p-7 rounded-2xl group transition-all duration-300 hover:scale-105 cursor-pointer"
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = f.color + "88"; e.currentTarget.style.boxShadow = `0 0 24px ${f.color}22`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ color: f.color, background: `${f.color}18` }} className="w-14 h-14 rounded-xl flex items-center justify-center mb-5">{f.icon}</div>
              <h3 style={{ color: COLORS.textPrimary }} className="font-bold text-base mb-2">{f.title}</h3>
              <p style={{ color: COLORS.textSecondary }} className="text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Live Rooms */}
      {rooms.length > 0 && (
        <div className="max-w-6xl mx-auto px-6 py-10 pb-24">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 style={{ color: COLORS.textPrimary }} className="text-2xl font-black mb-1">Live Right Now</h2>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Join an active auction in progress</p>
            </div>
            <button onClick={() => navigate("/rooms")} style={{ color: COLORS.primary }} className="text-sm font-bold flex items-center gap-1 hover:underline">
              View All <ArrowRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {rooms.slice(0, 6).map((room) => (
              <div key={room.roomCode} style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="p-6 rounded-2xl cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                onClick={() => navigate(`/join/${room.roomCode}`)}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 style={{ color: COLORS.textPrimary }} className="font-bold text-sm">{room.roomName}</h3>
                    <span style={{ color: COLORS.textSecondary }} className="text-xs">{room.league?.name || room.league?.code} · {room.roomCode}</span>
                  </div>
                  <StatusBadge status={room.status} />
                </div>
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-1.5">
                    <Users size={14} style={{ color: COLORS.textSecondary }} />
                    <span style={{ color: COLORS.textSecondary }} className="text-xs">{room.joinedTeams?.length || 0}/{room.maxTeams} teams</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="max-w-6xl mx-auto px-6 pb-24">
        <div style={{ background: `linear-gradient(135deg, ${COLORS.bgCard}, #162032)`, border: `1px solid ${COLORS.primary}33`, boxShadow: `0 0 40px ${COLORS.primary}11` }} className="rounded-3xl p-12 text-center">
          <Clock size={44} style={{ color: COLORS.primary, margin: "0 auto 20px" }} />
          <h2 style={{ color: COLORS.textPrimary }} className="text-3xl font-black mb-4">Ready to Run Your Auction?</h2>
          <p style={{ color: COLORS.textSecondary }} className="mb-10 max-w-lg mx-auto text-lg leading-relaxed">Set up your room in under 60 seconds. Invite your friends, configure your league, and let the bidding wars begin.</p>
          <button onClick={() => navigate("/create")} style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 24px ${COLORS.primary}55` }} className="inline-flex items-center gap-3 px-12 py-4.5 rounded-2xl font-black text-base hover:scale-105 transition-all">
            <Zap size={20} /> Start for Free
          </button>
        </div>
      </div>
    </div>
  );
}
