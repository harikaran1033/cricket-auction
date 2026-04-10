import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Zap, Users, MessageSquare, Shield, TrendingUp, ArrowRight, Trophy, Clock, Eye } from "lucide-react";
import { api } from "../services/api";
import { COLORS, TYPE_SCALE } from "../data/constants";
import StatusBadge from "../components/StatusBadge";
import { Panel, NeonButton, StatusChip } from "../components/ui/primitives";

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

export default function Home() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [showTour, setShowTour] = useState(() => localStorage.getItem("auctionplay_tour_seen") !== "1");

  useEffect(() => {
    api.getPublicRooms().then(setRooms).catch(() => setRooms([]));
  }, []);

  const liveRooms = rooms.filter((r) => r.status === "auction");
  const dismissTour = () => {
    localStorage.setItem("auctionplay_tour_seen", "1");
    setShowTour(false);
  };

  return (
    <div style={{ background: COLORS.bgMain }} className="w-full flex-1">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`, backgroundSize: "64px 64px" }} />
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: COLORS.primary }} />
        <div className="absolute top-40 right-1/4 w-80 h-80 rounded-full opacity-10 blur-3xl" style={{ background: COLORS.accent }} />

        <div className="relative max-w-6xl mx-auto px-6 pt-28 pb-24 text-center">
          {liveRooms.length > 0 && <StatusChip tone="live" pulse label={`${liveRooms.length} LIVE AUCTION${liveRooms.length > 1 ? "S" : ""} NOW`} />}

          <h1 style={{ color: COLORS.textPrimary, fontFamily: "var(--font-display)" }} className={`${TYPE_SCALE.display} mb-8 leading-tight`}>
            The Ultimate<br />
            <span
              style={{
                background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF, ${COLORS.primary})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                fontFamily: "'Orbitron', sans-serif",
                letterSpacing: 2,
              }}
            >
              AuctionPlay
            </span>
          </h1>

          <p style={{ color: COLORS.textSecondary }} className="text-lg md:text-xl mb-12 max-w-2xl mx-auto leading-relaxed">
            Run IPL-style auctions with live bidding, retention, chat, and deep team strategy in one competitive room.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <NeonButton onClick={() => navigate("/create")} className="flex items-center justify-center gap-3 px-8 py-4 text-base">
              <Trophy size={20} /> Create Room <ArrowRight size={18} />
            </NeonButton>
            <NeonButton variant="secondary" onClick={() => navigate("/join")} className="flex items-center justify-center gap-3 px-8 py-4 text-base">
              <Users size={20} /> Join Room
            </NeonButton>
            <NeonButton variant="secondary" onClick={() => navigate("/rooms")} className="flex items-center justify-center gap-3 px-8 py-4 text-base">
              <Eye size={18} /> Spectate
            </NeonButton>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-16 text-left">
            <Panel className="p-5 stagger-enter">
              <p style={{ color: COLORS.primary }} className="font-black text-sm mb-1">Create</p>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Host a room, set squad size, and launch retention + auction flow.</p>
            </Panel>
            <Panel className="p-5 stagger-enter" style={{ animationDelay: "80ms" }}>
              <p style={{ color: COLORS.success }} className="font-black text-sm mb-1">Join</p>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Pick a franchise and bid live with purse and role constraints.</p>
            </Panel>
            <Panel className="p-5 stagger-enter" style={{ animationDelay: "140ms" }}>
              <p style={{ color: COLORS.warning }} className="font-black text-sm mb-1">Spectate</p>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Watch live auctions and review final season simulations.</p>
            </Panel>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        {showTour && (
          <Panel tone="hud" className="p-5 mb-10">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p style={{ color: COLORS.textPrimary }} className="text-sm font-bold">Quick Start: Create room → Invite teams → Start auction.</p>
              <button onClick={dismissTour} style={{ color: COLORS.primary }} className="text-xs font-bold">Got it</button>
            </div>
          </Panel>
        )}
        <div className="text-center mb-14">
          <h2 style={{ color: COLORS.textPrimary }} className={`${TYPE_SCALE.section} mb-4`}>Built for Intense Competition</h2>
          <p style={{ color: COLORS.textSecondary }} className="text-lg max-w-xl mx-auto">Every feature engineered to maximize the thrill of live sports auctions</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((f) => (
            <Panel key={f.title} style={{ background: COLORS.bgCard }} className="p-7 group transition-all duration-300 hover:scale-105 cursor-pointer"
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = f.color + "88"; e.currentTarget.style.boxShadow = `0 0 24px ${f.color}22`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ color: f.color, background: `${f.color}18` }} className="w-14 h-14 rounded-xl flex items-center justify-center mb-5">{f.icon}</div>
              <h3 style={{ color: COLORS.textPrimary }} className={`${TYPE_SCALE.cardTitle} mb-2`}>{f.title}</h3>
              <p style={{ color: COLORS.textSecondary }} className="text-sm leading-relaxed">{f.description}</p>
            </Panel>
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
              <div
                key={room.roomCode}
                style={{
                  background: `linear-gradient(135deg, ${COLORS.bgCard} 0%, #111B2E 100%)`,
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: `0 10px 30px rgba(0,0,0,0.35)`,
                }}
                className="p-6 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02]"
                onClick={() => navigate(`/join/${room.roomCode}`)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="min-w-0">
                    <h3 style={{ color: COLORS.textPrimary }} className="font-bold text-sm truncate">{room.roomName}</h3>
                    <span style={{ color: COLORS.textSecondary }} className="text-xs">{room.league?.name || room.league?.code} · {room.roomCode}</span>
                  </div>
                  <StatusBadge status={room.status} />
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div style={{ background: `${COLORS.primary}22`, border: `1px solid ${COLORS.primary}44` }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider">
                    {room.visibility === "private" ? "Private" : "Public"}
                  </div>
                  {room.retentionEnabled && (
                    <div style={{ background: `${COLORS.warning}22`, border: `1px solid ${COLORS.warning}44`, color: COLORS.warning }} className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider">
                      RTM
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="w-9 h-9 rounded-xl flex items-center justify-center">
                      <Users size={16} />
                    </div>
                    <div>
                      <div style={{ color: COLORS.textPrimary }} className="text-sm font-bold">{room.joinedTeams?.length || 0}/{room.maxTeams} teams</div>
                      <div style={{ color: COLORS.textSecondary }} className="text-[11px]">Slots filled</div>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/join/${room.roomCode}`); }}
                    style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 16px ${COLORS.primary}44` }}
                    className="px-4 py-2 rounded-xl text-xs font-black hover:scale-105 transition-all"
                  >
                    Join Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="max-w-6xl mx-auto px-6 pb-24">
        <Panel tone="hud" className="rounded-3xl p-12 text-center">
          <Clock size={44} style={{ color: COLORS.primary, margin: "0 auto 20px" }} />
          <h2 style={{ color: COLORS.textPrimary }} className="text-3xl font-black mb-4">Ready to Run Your Auction?</h2>
          <p style={{ color: COLORS.textSecondary }} className="mb-10 max-w-lg mx-auto text-lg leading-relaxed">Set up your room in under 60 seconds. Invite your friends, configure your league, and let the bidding wars begin.</p>
          <NeonButton onClick={() => navigate("/create")} className="inline-flex items-center gap-3 px-10 py-4 text-base">
            <Zap size={20} /> Start for Free
          </NeonButton>
          <NeonButton variant="secondary" onClick={() => navigate("/rooms")} className="inline-flex items-center gap-3 px-8 py-4 text-base ml-3 mt-3 sm:mt-0">
            <Eye size={18} /> Spectate Live
          </NeonButton>
        </Panel>
      </div>
    </div>
  );
}
