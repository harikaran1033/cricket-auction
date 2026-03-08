import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Gavel, ChevronUp, AlertTriangle, TrendingUp, Wallet, Trophy, Pause, Play, ChevronRight, Zap, UserMinus, ChevronDown, Clock, Info } from "lucide-react";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { useAudio } from "../context/AudioContext";
import { COLORS, ROLE_COLORS, SET_CONFIG, PHASE_LABELS, PHASE_COLORS, formatPrice } from "../data/constants";
import ParticleEffect from "../components/ParticleEffect";
import SoundControls from "../components/SoundControls";

export default function Auction() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();
  const [searchParams] = useSearchParams();
  const isSpectatorMode = searchParams.get("spectate") === "1";

  // State
  const [auctionStatus, setAuctionStatus] = useState("WAITING");
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [currentBid, setCurrentBid] = useState(0);
  const [currentBidTeam, setCurrentBidTeam] = useState(null);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [teams, setTeams] = useState([]);
  const [minNextBid, setMinNextBid] = useState(0);
  const [soldOverlay, setSoldOverlay] = useState(null);
  const [rtmPending, setRtmPending] = useState(null);
  const [isRtmMatch, setIsRtmMatch] = useState(false);
  const [error, setError] = useState("");
  const [roomData, setRoomData] = useState(null);
  const [stats, setStats] = useState({ totalPlayersSold: 0, totalPlayersUnsold: 0, currentPlayerIndex: 0, totalPlayers: 0 });
  const [isPricePulsing, setIsPricePulsing] = useState(false);

  // Set tracking
  const [setInfo, setSetInfo] = useState(null);
  const [playerIndexInSet, setPlayerIndexInSet] = useState(0);
  const [totalPlayersInSet, setTotalPlayersInSet] = useState(0);
  const [setTransition, setSetTransition] = useState(null); // { setCode, setName, phase }
  const [setPoolPlayers, setSetPoolPlayers] = useState([]);
  const [showSetPlayers, setShowSetPlayers] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [showParticles, setShowParticles] = useState(false);
  const [particleColor, setParticleColor] = useState("#00E5FF");
  const [timerConfig, setTimerConfig] = useState(15);
  const [showTimerConfig, setShowTimerConfig] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [timerDuration, setTimerDuration] = useState(15); // dynamic max for progress bar

  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const timerEndRef = useRef(null);
  const prevTimerSecRef = useRef(-1);

  // Audio
  const { playTimerTick, playTimerAlert, playBidSound, playSoldMusic, playUnsoldSound, playRtmSound } = useAudio();

  const isHost = roomData?.host?.userId === user.userId;
  const myTeam = isSpectatorMode ? null : teams.find((t) => t.userId === user.userId || t.teamName === user.teamName);
  const leadingBid = currentBidTeam ? teams.find((t) => t.teamName === currentBidTeam) : null;
  const remainingPurse = myTeam?.remainingPurse || 0;

  // Current set config
  const currentSetCode = setInfo?.currentSet || "M1";
  const currentSetConfig = SET_CONFIG[currentSetCode] || { name: currentSetCode, short: currentSetCode, phase: "primary", color: COLORS.primary };
  const currentPhaseColor = PHASE_COLORS[currentSetConfig.phase] || COLORS.primary;

  // ─── Socket Setup ───
  useEffect(() => {
    if (!socket) return;

    if (isSpectatorMode) {
      socket.emit("room:spectate", { roomCode: code, userId: user.userId, userName: user.userName || "Spectator" }, (res) => {
        if (res?.success) { setRoomData(res.room); setTeams(res.room.joinedTeams || []); }
        else if (res?.error) setError(res.error);
      });
    } else {
      socket.emit("room:join", { roomCode: code, userId: user.userId, userName: user.userName, teamName: user.teamName }, (res) => {
        if (res?.success) { setRoomData(res.room); setTeams(res.room.joinedTeams || []); }
        else if (res?.error) setError(res.error);
      });
    }

    socket.emit("auction:getState", { roomCode: code }, (res) => {
      if (res?.success && res.state) applyAuctionState(res.state);
    });

    // Server pushes chat:history after room:join
    socket.on("chat:history", (msgs) => setChatMessages(msgs || []));

    // Event listeners
    socket.on("auction:playerNominated", (data) => {
      setSoldOverlay(null); setRtmPending(null); setIsRtmMatch(false); setSetTransition(null);
      setCurrentPlayer(data.player);
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(null);
      setMinNextBid(data.currentBid);
      setAuctionStatus("BIDDING");
      setStats((s) => ({ ...s, currentPlayerIndex: data.playerIndexInSet || (s.currentPlayerIndex + 1) }));
      if (data.setInfo) setSetInfo(data.setInfo);
      if (data.playerIndexInSet != null) setPlayerIndexInSet(data.playerIndexInSet);
      if (data.totalPlayersInSet != null) setTotalPlayersInSet(data.totalPlayersInSet);
      if (data.setPoolPlayers) setSetPoolPlayers(data.setPoolPlayers);
      prevTimerSecRef.current = -1; // reset so first tick doesn't beep
      startClientTimer(data.timerEndsAt);
    });

    socket.on("auction:bidPlaced", (data) => {
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(data.currentBidTeam);
      setMinNextBid(data.minNextBid);
      setIsPricePulsing(true);
      setTimeout(() => setIsPricePulsing(false), 600);
      setIsRtmMatch(false);
      startClientTimer(data.timerEndsAt);
      playBidSound();
    });

    socket.on("auction:playerSold", (data) => {
      clearClientTimer(); setAuctionStatus("SOLD");
      setRtmPending(null); setIsRtmMatch(false);
      if (data.teams) {
        setTeams((prev) => prev.map((t) => {
          const upd = data.teams.find((u) => u.teamName === t.teamName);
          return upd ? { ...t, remainingPurse: upd.remainingPurse, squadSize: upd.squadSize, squad: upd.squad || t.squad } : t;
        }));
      }
      setSoldOverlay({ type: "sold", player: data.player, soldTo: data.soldTo, soldPrice: data.soldPrice, acquiredVia: data.acquiredVia });
      setStats((s) => ({ ...s, totalPlayersSold: s.totalPlayersSold + 1 }));
      // Celebration for the winning team only
      if (data.soldTo === user.teamName) {
        playSoldMusic();
        setParticleColor(COLORS.success);
        setShowParticles(true);
        setTimeout(() => setShowParticles(false), 3500);
      }
      setTimeout(() => setSoldOverlay(null), 4000);
    });

    socket.on("auction:playerUnsold", (data) => {
      clearClientTimer(); setAuctionStatus("UNSOLD");
      setSoldOverlay({ type: "unsold", player: data.player });
      setStats((s) => ({ ...s, totalPlayersUnsold: s.totalPlayersUnsold + 1 }));
      playUnsoldSound();
      setTimeout(() => setSoldOverlay(null), 3000);
    });

    socket.on("auction:rtmPending", (data) => {
      clearClientTimer(); setAuctionStatus("RTM_PENDING");
      setRtmPending(data); startClientTimer(data.timerEndsAt);
      playRtmSound();
    });

    // Set changed event — show transition splash
    socket.on("auction:setChanged", (data) => {
      if (data.setInfo) setSetInfo(data.setInfo);
      if (data.setPoolPlayers) setSetPoolPlayers(data.setPoolPlayers);
      const sc = SET_CONFIG[data.setInfo?.currentSet] || {};
      setSetTransition({
        setCode: data.setInfo?.currentSet,
        setName: sc.name || data.setInfo?.currentSet,
        phase: sc.phase || "primary",
        playersInSet: data.playersInSet,
        isAccelerated: data.isAccelerated,
      });
      // Auto-dismiss after 3s (nomination will dismiss it too)
      setTimeout(() => setSetTransition(null), 4000);
    });

    socket.on("auction:timerTick", (data) => {
      // Server tick is authoritative sync — recalibrate our end-time
      if (data.remaining > 0 && timerEndRef.current) {
        const correctedEnd = Date.now() + data.remaining * 1000;
        const drift = Math.abs(correctedEnd - timerEndRef.current);
        // Only correct if drift > 500ms to avoid jitter
        if (drift > 500) {
          timerEndRef.current = correctedEnd;
        }
      }
      setTimerRemaining(data.remaining);
    });
    socket.on("auction:paused", () => { clearClientTimer(); setAuctionStatus("PAUSED"); });
    socket.on("auction:resumed", () => setAuctionStatus("BIDDING"));
    socket.on("auction:completed", (data) => {
      clearClientTimer(); setAuctionStatus("COMPLETED");
      const s = data.stats || data;
      setStats((prev) => ({ ...prev, totalPlayersSold: s.totalSold ?? s.totalPlayersSold ?? prev.totalPlayersSold, totalPlayersUnsold: s.totalUnsold ?? s.totalPlayersUnsold ?? prev.totalPlayersUnsold }));
    });
    socket.on("auction:error", (data) => { setError(data.error); setTimeout(() => setError(""), 3000); });
    socket.on("auction:state", (state) => { if (state) applyAuctionState(state); });
    socket.on("room:updated", (data) => {
      if (data.joinedTeams) {
        setTeams((prev) => {
          // Merge: preserve squad data from previous state if new data doesn't have populated squads
          return data.joinedTeams.map((nt) => {
            const existing = prev.find((p) => p.teamName === nt.teamName);
            if (existing && (!nt.squad || nt.squad.length === 0 || (nt.squad[0]?.player && !nt.squad[0].player?.name))) {
              return { ...nt, squad: existing.squad || [] };
            }
            return nt;
          });
        });
      }
    });
    socket.on("room:userJoined", (data) => {
      if (data.joinedTeams) {
        setTeams((prev) => {
          return data.joinedTeams.map((nt) => {
            const existing = prev.find((p) => p.teamName === nt.teamName);
            if (existing && existing.squad?.length > 0) {
              return { ...nt, squad: existing.squad };
            }
            return nt;
          });
        });
      }
    });
    socket.on("room:teamKicked", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
      if (data.kickedUserId === user.userId) {
        navigate("/");
      }
    });
    socket.on("auction:timerChanged", (data) => {
      if (data.seconds) setTimerConfig(data.seconds);
    });
    socket.on("chat:message", (msg) => setChatMessages((prev) => [...prev, msg]));

    return () => {
      clearClientTimer();
      ["auction:playerNominated", "auction:bidPlaced", "auction:playerSold", "auction:playerUnsold",
       "auction:rtmPending", "auction:timerTick", "auction:paused", "auction:resumed",
       "auction:completed", "auction:error", "auction:state", "auction:setChanged", "auction:timerChanged",
       "room:updated", "room:userJoined", "room:teamKicked", "chat:message", "chat:history", "activity:history"
      ].forEach((e) => socket.off(e));
    };
  }, [socket, code, isSpectatorMode]);

  // Timer sounds — only fire on actual second transitions
  useEffect(() => {
    const sec = timerRemaining;
    if (sec === prevTimerSecRef.current || sec <= 0) return;
    const prev = prevTimerSecRef.current;
    prevTimerSecRef.current = sec;
    if (prev === -1) return; // first set, don't beep
    if (auctionStatus !== "BIDDING" && auctionStatus !== "RTM_PENDING") return;
    if (sec <= 3) playTimerAlert();
    else if (sec <= 10) playTimerTick();
  }, [timerRemaining, auctionStatus, playTimerTick, playTimerAlert]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const applyAuctionState = (state) => {
    setAuctionStatus(state.status);
    if (state.currentLeaguePlayer?.player) {
      const p = state.currentLeaguePlayer.player;
      setCurrentPlayer({ playerId: p._id, name: p.name, nationality: p.nationality, isOverseas: p.isOverseas, isCapped: p.isCapped, role: p.role, image: p.image, skills: p.skills || [], basePrice: state.currentLeaguePlayer.basePrice || p.basePrice, previousTeam: state.currentLeaguePlayer.previousTeam || "", stats2024: state.currentLeaguePlayer.stats2024 || null, stats2025: state.currentLeaguePlayer.stats2025 || null, fairPoint: state.currentLeaguePlayer.fairPoint || 0 });
    }
    setCurrentBid(state.currentBid || 0);
    setCurrentBidTeam(state.currentBidTeam || null);
    setTimerRemaining(state.timerRemaining || 0);
    if (state.timerDurationMs) {
      setTimerDuration(Math.ceil(state.timerDurationMs / 1000));
      setTimerConfig(Math.ceil(state.timerDurationMs / 1000));
    }
    if (state.teams) setTeams(state.teams);
    if (state.setInfo) setSetInfo(state.setInfo);
    if (state.playerIndexInSet != null) setPlayerIndexInSet(state.playerIndexInSet);
    if (state.totalPlayersInSet != null) setTotalPlayersInSet(state.totalPlayersInSet);
    if (state.setPoolPlayers) setSetPoolPlayers(state.setPoolPlayers);
    const poolLen = state.playerPool?.length || 0;
    const soldLen = state.soldPlayers?.length || 0;
    const unsoldLen = state.unsoldPlayers?.length || 0;
    setStats({ totalPlayersSold: state.totalPlayersSold || 0, totalPlayersUnsold: state.totalPlayersUnsold || 0, currentPlayerIndex: state.nominationIndex || 0, totalPlayers: poolLen + soldLen + unsoldLen });
    if (state.timerEndsAt && ["BIDDING", "RTM_PENDING"].includes(state.status)) startClientTimer(state.timerEndsAt);
    if (state.status === "RTM_PENDING" && state.rtmEligibleTeam) {
      setRtmPending({ rtmTeam: state.rtmEligibleTeam, currentBid: state.currentBid, currentBidTeam: state.currentBidTeam });
    }
  };

  const startClientTimer = (timerEndsAt) => {
    clearClientTimer();
    const endTime = new Date(timerEndsAt).getTime();
    timerEndRef.current = endTime;
    // Calculate total duration for progress bar
    const totalSec = Math.ceil((endTime - Date.now()) / 1000);
    if (totalSec > 0) setTimerDuration(totalSec);
    prevTimerSecRef.current = -1; // reset so first set doesn't beep
    // Use setInterval at 200ms — smooth enough, not wasteful
    const tick = () => {
      const now = Date.now();
      const end = timerEndRef.current || endTime;
      const remaining = Math.max(0, Math.ceil((end - now) / 1000));
      setTimerRemaining(remaining);
      if (remaining <= 0) clearClientTimer();
    };
    tick(); // immediate first tick
    timerRef.current = setInterval(tick, 200);
  };
  const clearClientTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    timerEndRef.current = null;
    setTimerRemaining(0);        // prevent stale timer sounds
    prevTimerSecRef.current = -1; // reset so next start won't false-trigger
  };

  // Actions
  const placeBid = useCallback((amount) => {
    if (isSpectatorMode || !socket) return;
    setError("");
    socket.emit("auction:bid", { roomCode: code, userId: user.userId, teamName: user.teamName, amount }, (res) => {
      if (!res?.success) { setError(res?.error || "Bid failed"); setTimeout(() => setError(""), 3000); }
    });
  }, [socket, code, user, isSpectatorMode]);

  const handleRtm = useCallback((action) => {
    if (isSpectatorMode || !socket) return;
    socket.emit(action === "use" ? "auction:rtmUse" : "auction:rtmPass", { roomCode: code, userId: user.userId, teamName: user.teamName });
  }, [socket, code, user, isSpectatorMode]);

  const handlePause = () => { socket?.emit("auction:pause", { roomCode: code, userId: user.userId }); };
  const handleResume = () => { socket?.emit("auction:resume", { roomCode: code, userId: user.userId }); };

  const handleKick = (targetUserId) => {
    if (!socket || !isHost) return;
    if (!confirm("Are you sure you want to kick this team?")) return;
    socket.emit("room:kick", { roomCode: code, userId: user.userId, targetUserId }, (res) => {
      if (!res?.success) { setError(res?.error || "Kick failed"); setTimeout(() => setError(""), 3000); }
    });
  };

  const handleNominate = (leaguePlayerId) => {
    if (!socket || !isHost) return;
    socket.emit("auction:nominate", { roomCode: code, userId: user.userId, leaguePlayerId }, (res) => {
      if (!res?.success) { setError(res?.error || "Nominate failed"); setTimeout(() => setError(""), 3000); }
    });
  };

  const handleTimerChange = (seconds) => {
    if (!socket || !isHost) return;
    socket.emit("auction:timerConfig", { roomCode: code, userId: user.userId, seconds }, (res) => {
      if (res?.success) { setTimerConfig(seconds); setShowTimerConfig(false); }
      else { setError(res?.error || "Timer change failed"); setTimeout(() => setError(""), 3000); }
    });
  };

  const sendChat = () => {
    if (!chatInput.trim() || !socket) return;
    socket.emit("chat:send", { roomCode: code, userId: user.userId, userName: user.userName, teamName: user.teamName, message: chatInput });
    setChatInput("");
  };

  // Bid amounts — calculate increment based on IPL-style brackets
  const bidAmounts = [];
  if (minNextBid > 0) {
    bidAmounts.push(minNextBid);
    // Generate additional bid options at 2x and 3x above the min increment
    const getIncrement = (val) => val < 100 ? 10 : val < 500 ? 25 : 100;
    let nextVal = minNextBid;
    for (let i = 0; i < 3; i++) {
      nextVal = nextVal + getIncrement(nextVal);
      if (nextVal <= remainingPurse && !bidAmounts.includes(nextVal)) bidAmounts.push(nextVal);
    }
  }
  const canBid = !isSpectatorMode && auctionStatus === "BIDDING" && currentBidTeam !== user.teamName && myTeam && remainingPurse >= minNextBid;
  const isRtmEligible = !isSpectatorMode && auctionStatus === "RTM_PENDING" && rtmPending?.rtmTeam === user.teamName;
  const timerColor = timerRemaining <= 5 ? COLORS.accent : timerRemaining <= 10 ? COLORS.warning : COLORS.success;
  const timerPct = timerDuration > 0 ? (timerRemaining / timerDuration) * 100 : 0;

  // ─── COMPLETED VIEW ───
  if (auctionStatus === "COMPLETED") {
    return (
      <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex items-center justify-center h-screen px-4">
        <div className="text-center px-4 sm:px-6 w-full max-w-lg">
          <div className="text-5xl sm:text-7xl mb-4 sm:mb-6">🏆</div>
          <h1 style={{ color: COLORS.textPrimary }} className="text-3xl sm:text-5xl font-black mb-3 sm:mb-4">Auction Complete!</h1>
          <p style={{ color: COLORS.textSecondary }} className="text-base sm:text-xl mb-6 sm:mb-10">
            {stats.totalPlayersSold} sold · {stats.totalPlayersUnsold} unsold
          </p>
          <button onClick={() => navigate(`/room/${code}/results`)}
            style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 24px ${COLORS.primary}44` }}
            className="px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-black text-base sm:text-lg hover:scale-105 transition-all flex items-center gap-2 mx-auto">
            <Trophy size={20} /> View Results
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex flex-col h-screen overflow-hidden">
      {/* Error toast */}
      {error && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: COLORS.accent, color: "white", padding: "12px 24px", borderRadius: 12, zIndex: 2000, fontWeight: 700, fontSize: 14, boxShadow: `0 0 20px ${COLORS.accent}66` }}>
          {error}
        </div>
      )}

      {/* Celebration Particles */}
      <ParticleEffect active={showParticles} color={particleColor} count={60} />

      {/* Top Bar */}
      <div style={{ background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.border}` }} className="px-3 sm:px-5 py-2.5 sm:py-4 flex items-center justify-between gap-2 sm:gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
          <button onClick={() => navigate(`/room/${code}/lobby`)} style={{ color: COLORS.textSecondary }} className="p-1 hover:text-white flex-shrink-0"><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 style={{ color: COLORS.textPrimary }} className="font-black text-sm sm:text-lg truncate">{roomData?.roomName || "Live Auction"}</h1>
              <span style={{ background: `${COLORS.accent}22`, color: COLORS.accent, border: `1px solid ${COLORS.accent}44`, fontFamily: "'JetBrains Mono', monospace" }}
                className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-bold flex items-center gap-1 flex-shrink-0">
                <span style={{ background: COLORS.accent }} className="w-1.5 h-1.5 rounded-full animate-pulse" />
                {auctionStatus === "PAUSED" ? "PAUSED" : "LIVE"}
              </span>
              {isSpectatorMode && <span style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full font-bold">SPECTATING</span>}
            </div>
            <p style={{ color: COLORS.textSecondary }} className="text-[10px] sm:text-xs">
              Player {playerIndexInSet}/{totalPlayersInSet || "?"} · Sold: {stats.totalPlayersSold} · Unsold: {stats.totalPlayersUnsold}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
          {myTeam && (
            <div style={{ background: `${COLORS.success}15`, border: `1px solid ${COLORS.success}33` }} className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg">
              <p style={{ color: COLORS.textSecondary }} className="text-[9px] sm:text-xs">Purse</p>
              <p style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs sm:text-sm font-bold">{formatPrice(remainingPurse)}</p>
            </div>
          )}
          {myTeam && (
            <div style={{ background: `${COLORS.primary}15`, border: `1px solid ${COLORS.primary}33` }} className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg hidden md:block">
              <p style={{ color: COLORS.textSecondary }} className="text-[9px] sm:text-xs">Playing As</p>
              <p style={{ color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs sm:text-sm font-bold">{myTeam.teamShortName || myTeam.teamName}</p>
            </div>
          )}
          {isHost && auctionStatus === "BIDDING" && (
            <button onClick={handlePause} style={{ background: `${COLORS.warning}22`, color: COLORS.warning, border: `1px solid ${COLORS.warning}44` }}
              className="p-2 rounded-lg"><Pause size={16} /></button>
          )}
          {isHost && auctionStatus === "PAUSED" && (
            <button onClick={handleResume} style={{ background: `${COLORS.success}22`, color: COLORS.success, border: `1px solid ${COLORS.success}44` }}
              className="p-2 rounded-lg"><Play size={16} /></button>
          )}
          {/* Timer Config */}
          {isHost && (
            <div className="relative">
              <button onClick={() => setShowTimerConfig(!showTimerConfig)}
                style={{ background: `${COLORS.primary}22`, color: COLORS.primary, border: `1px solid ${COLORS.primary}44` }}
                className="p-2 rounded-lg flex items-center gap-1" title="Timer config">
                <Clock size={16} /><span className="text-xs font-bold hidden sm:inline">{timerConfig}s</span>
              </button>
              {showTimerConfig && (
                <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, boxShadow: `0 8px 24px rgba(0,0,0,0.4)` }}
                  className="absolute right-0 top-full mt-2 rounded-xl p-3 z-50 min-w-[140px]">
                  <p style={{ color: COLORS.textSecondary }} className="text-xs mb-2 font-medium">Bid Timer</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[5, 10, 15, 20].map(s => (
                      <button key={s} onClick={() => handleTimerChange(s)}
                        style={{
                          background: timerConfig === s ? `${COLORS.primary}22` : COLORS.bgMain,
                          color: timerConfig === s ? COLORS.primary : COLORS.textSecondary,
                          border: `1px solid ${timerConfig === s ? COLORS.primary + "44" : COLORS.border}`,
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-bold transition-all hover:scale-105">
                        {s}s
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <SoundControls compact />
        </div>
      </div>

      {/* SET PROGRESS STRIP */}
      {setInfo && setInfo.sets?.length > 0 && (
        <div style={{ background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.border}` }} className="px-4 py-2 shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 min-w-max">
            {setInfo.sets.map((s, i) => {
              const sc = SET_CONFIG[s.code] || {};
              const isCurrent = s.isCurrent;
              const isDone = s.isCompleted;
              const dotColor = isCurrent ? (sc.color || COLORS.primary) : isDone ? COLORS.success : COLORS.border;
              return (
                <div key={s.code} className="flex items-center gap-1.5">
                  {i > 0 && <div style={{ width: 12, height: 2, background: isDone ? COLORS.success + "66" : COLORS.border, borderRadius: 2 }} />}
                  <div
                    title={sc.name || s.name}
                    style={{
                      background: isCurrent ? `${dotColor}22` : isDone ? `${COLORS.success}15` : `${COLORS.border}22`,
                      border: `1.5px solid ${isCurrent ? dotColor : isDone ? COLORS.success + "44" : COLORS.border}`,
                      color: isCurrent ? dotColor : isDone ? COLORS.success : COLORS.textSecondary,
                      fontFamily: "'JetBrains Mono', monospace",
                      boxShadow: isCurrent ? `0 0 10px ${dotColor}33` : "none",
                    }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap transition-all ${isCurrent ? "scale-110" : ""}`}
                  >
                    {isDone ? "✓" : ""} {sc.short || s.code}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SET TRANSITION SPLASH */}
      {setTransition && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 3000,
          background: "rgba(15,23,42,0.85)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div className="text-center animate-pulse">
            <div style={{
              color: PHASE_COLORS[setTransition.phase] || COLORS.primary,
              fontSize: 14, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase",
              marginBottom: 8, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {PHASE_LABELS[setTransition.phase] || "NEXT SET"}
            </div>
            <div style={{
              color: COLORS.textPrimary, fontSize: 36, fontWeight: 900, marginBottom: 8,
              textShadow: `0 0 30px ${PHASE_COLORS[setTransition.phase] || COLORS.primary}`,
            }}>
              {setTransition.setName}
            </div>
            <div style={{ color: COLORS.textSecondary, fontSize: 14 }}>
              {setTransition.playersInSet} player{setTransition.playersInSet !== 1 ? "s" : ""} in this set
            </div>
            {setTransition.isAccelerated && (
              <div style={{ color: "#F97316", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Zap size={18} /> <span style={{ fontWeight: 700 }}>Reduced base prices apply</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[260px_1fr] xl:grid-cols-[280px_1fr_280px] overflow-hidden min-h-0">

        {/* LEFT: Teams Sidebar */}
        <div style={{ borderRight: `1px solid ${COLORS.border}`, overflowY: "auto" }} className="hidden lg:block p-3 xl:p-5">
          <p style={{ color: COLORS.textSecondary }} className="text-xs font-medium mb-4 uppercase tracking-wider">Teams & Purse</p>
          <div className="space-y-3">
            {teams.map((team) => {
              const remaining = team.remainingPurse || 0;
              const total = team.totalPurse || 1;
              const usedPct = ((total - remaining) / total) * 100;
              const isLeading = currentBidTeam === team.teamName;
              const tColor = team.userId === user.userId ? COLORS.primary : COLORS.textSecondary;
              const canKick = isHost && team.userId !== user.userId;
              const isExpanded = expandedTeam === team.teamName;
              const squadList = team.squad || [];
              return (
                <div key={team.teamName} style={{
                  background: isLeading ? `${COLORS.success}18` : COLORS.bgCard,
                  border: `1px solid ${isLeading ? COLORS.success + "66" : COLORS.border}`,
                  boxShadow: isLeading ? `0 0 12px ${COLORS.success}22` : "none",
                }} className="rounded-xl transition-all overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3 cursor-pointer" onClick={() => setExpandedTeam(isExpanded ? null : team.teamName)}>
                      <div style={{ background: `${tColor}22`, color: tColor }} className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black">
                        {(team.teamShortName || team.teamName || "?")[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ color: isLeading ? COLORS.success : COLORS.textPrimary }} className="text-sm font-bold truncate">{team.teamShortName || team.teamName}</p>
                        {isLeading && <p style={{ color: COLORS.success }} className="text-xs">🏆 Leading</p>}
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <div>
                          <p style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{formatPrice(remaining)}</p>
                          <p style={{ color: COLORS.textSecondary }} className="text-xs">{team.squadSize ?? squadList.length ?? 0}pl</p>
                        </div>
                        {canKick && (
                          <button onClick={(e) => { e.stopPropagation(); handleKick(team.userId); }} title="Kick team"
                            style={{ color: COLORS.accent }} className="p-1 rounded-md hover:bg-red-500/10 transition-colors">
                            <UserMinus size={14} />
                          </button>
                        )}
                        <ChevronDown size={14} style={{ color: COLORS.textSecondary, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
                      </div>
                    </div>
                    <div style={{ background: COLORS.bgMain, height: "4px", borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{
                        width: `${100 - usedPct}%`,
                        background: remaining < (total * 0.2) ? COLORS.accent : `linear-gradient(90deg, ${tColor}, ${tColor}88)`,
                        height: "100%", borderRadius: "99px", transition: "width 0.5s ease",
                      }} />
                    </div>
                  </div>
                  {/* Expandable Squad List */}
                  {isExpanded && (
                    <div style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.bgMain }} className="px-4 py-3">
                      {squadList.length === 0 ? (
                        <p style={{ color: COLORS.textSecondary }} className="text-xs text-center py-2">No players yet</p>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {squadList.map((sp, idx) => {
                            const pName = sp.player?.name || sp.name || `Player ${idx + 1}`;
                            const pRole = sp.player?.role || sp.role || "";
                            const isOS = sp.player?.isOverseas ?? sp.isOverseas;
                            const roleColor = ROLE_COLORS[pRole] || COLORS.textSecondary;
                            return (
                              <div key={sp.leaguePlayer || idx} className="flex items-center gap-2 py-1">
                                <div style={{ background: `${roleColor}22`, color: roleColor, width: 6, height: 6, borderRadius: "50%" }} />
                                <p style={{ color: COLORS.textPrimary }} className="text-xs font-medium flex-1 truncate">{pName}</p>
                                {isOS && <span style={{ color: COLORS.warning }} className="text-[9px] font-bold">OS</span>}
                                {sp.acquiredFrom === "rtm" && <span style={{ color: COLORS.primary }} className="text-[9px] font-bold">RTM</span>}
                                <span style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-[10px] font-bold">{formatPrice(sp.price)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* SET PLAYERS */}
          {setPoolPlayers.length > 0 && (
            <div className="mt-5">
              <button onClick={() => setShowSetPlayers(!showSetPlayers)}
                className="flex items-center justify-between w-full mb-3">
                <p style={{ color: currentPhaseColor }} className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                  <ChevronRight size={12} className={`transition-transform ${showSetPlayers ? "rotate-90" : ""}`} />
                  Set Players ({setPoolPlayers.filter(p => p.status === "upcoming").length} upcoming)
                </p>
                <span style={{ color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }} className="text-[10px]">
                  {currentSetConfig.short || currentSetCode}
                </span>
              </button>
              {showSetPlayers && (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {setPoolPlayers.map((p) => {
                    const isDone = p.status === "done";
                    const isCurr = p.status === "current";
                    const isUp = p.status === "upcoming";
                    const roleColor = ROLE_COLORS[p.role] || COLORS.textSecondary;
                    const canNominate = isHost && isUp && ["WAITING", "NOMINATING", "SOLD", "UNSOLD"].includes(auctionStatus);
                    return (
                      <div key={p.leaguePlayerId}
                        onClick={() => canNominate && handleNominate(p.leaguePlayerId)}
                        style={{
                          background: isCurr ? `${currentPhaseColor}15` : isDone ? `${COLORS.bgMain}` : COLORS.bgCard,
                          border: `1px solid ${isCurr ? currentPhaseColor + "44" : COLORS.border}`,
                          opacity: isDone ? 0.5 : 1,
                          cursor: canNominate ? "pointer" : "default",
                        }}
                        className={`px-3 py-2 rounded-lg flex items-center gap-2.5 ${canNominate ? "hover:border-blue-400/50 hover:bg-blue-500/5" : ""}`}
                        title={canNominate ? "Click to nominate this player" : ""}>
                        <div style={{ background: `${roleColor}22`, color: roleColor, width: 6, height: 6, borderRadius: "50%" }} />
                        <div className="flex-1 min-w-0">
                          <p style={{ color: isDone ? COLORS.textSecondary : COLORS.textPrimary }} className="text-xs font-semibold truncate">
                            {p.name}
                            {isCurr && <span style={{ color: currentPhaseColor }} className="ml-1 text-[10px]">● LIVE</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {p.fairPoint > 0 && (
                            <span title="Fair Point — position-based ideal rating" style={{ color: "#FFD700", fontFamily: "'JetBrains Mono', monospace", cursor: "help" }} className="text-[9px] font-bold">
                              FP:{p.fairPoint.toFixed(0)}
                            </span>
                          )}
                          {p.isOverseas && <span style={{ color: COLORS.warning }} className="text-[9px] font-bold">OS</span>}
                          {p.isCapped === false && <span style={{ color: "#A78BFA" }} className="text-[9px] font-bold">UC</span>}
                          <span style={{ color: COLORS.textSecondary, fontFamily: "'JetBrains Mono', monospace" }} className="text-[10px]">
                            {formatPrice(p.basePrice)}
                          </span>
                          {canNominate && <Gavel size={10} style={{ color: COLORS.primary }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* CENTER: Main Auction */}
        <div style={{ overflowY: "auto" }} className="flex flex-col p-3 sm:p-5 lg:p-6 gap-3 sm:gap-5">

          {/* SOLD Overlay */}
          {soldOverlay && (
            <div style={{
              background: soldOverlay.type === "sold" ? `${COLORS.success}22` : `${COLORS.accent}22`,
              border: `2px solid ${soldOverlay.type === "sold" ? COLORS.success : COLORS.accent}`,
              boxShadow: `0 0 40px ${soldOverlay.type === "sold" ? COLORS.success : COLORS.accent}44`,
            }} className="rounded-xl sm:rounded-2xl p-4 sm:p-6 text-center">
              <p style={{ color: soldOverlay.type === "sold" ? COLORS.success : COLORS.accent }} className="text-2xl sm:text-4xl font-black mb-1">
                {soldOverlay.type === "sold" ? "SOLD!" : "UNSOLD"}
              </p>
              <p style={{ color: COLORS.textPrimary }} className="text-base sm:text-lg font-bold">{soldOverlay.player?.name}</p>
              {soldOverlay.type === "sold" && (
                <>
                  <p style={{ color: COLORS.textSecondary }} className="text-xs sm:text-sm mb-1 sm:mb-2">to</p>
                  <p style={{ color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace" }} className="text-lg sm:text-2xl font-black">{soldOverlay.soldTo}</p>
                  <p style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="text-xl sm:text-3xl font-black mt-1 sm:mt-2">{formatPrice(soldOverlay.soldPrice)}</p>
                  {soldOverlay.acquiredVia === "rtm" && (
                    <span style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="text-xs sm:text-sm px-2 sm:px-3 py-1 rounded-full font-bold mt-2 inline-block">via RTM</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Player Focus Card */}
          {currentPlayer && auctionStatus !== "PAUSED" && (
            <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="rounded-xl sm:rounded-2xl overflow-hidden">
              <div className="p-3 sm:p-6">
                <div className="flex items-start justify-between gap-3 sm:gap-4 mb-3 sm:mb-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 flex-wrap">
                      <span style={{ background: `${ROLE_COLORS[currentPlayer.role] || COLORS.primary}22`, color: ROLE_COLORS[currentPlayer.role] || COLORS.primary, border: `1px solid ${ROLE_COLORS[currentPlayer.role] || COLORS.primary}66`, fontFamily: "'JetBrains Mono', monospace" }}
                        className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-md font-bold">{currentPlayer.role}</span>
                      {currentPlayer.isOverseas && <span style={{ background: `${COLORS.warning}22`, color: COLORS.warning }} className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-md">OS</span>}
                      {currentPlayer.isCapped === false && <span style={{ background: "#A78BFA22", color: "#A78BFA", border: "1px solid #A78BFA44" }} className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-md font-bold">UC</span>}
                      {currentPlayer.fairPoint > 0 && (
                        <span title="Fair Point — Rating based on batting/bowling position & stats across seasons. Reflects the player's ideal value."
                          style={{ background: "linear-gradient(135deg, #FFD70033, #FF8C0033)", color: "#FFD700", border: "1px solid #FFD70066", fontFamily: "'JetBrains Mono', monospace", cursor: "help" }}
                          className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                          <TrendingUp size={10} /> FP: {currentPlayer.fairPoint.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <h2 style={{ color: COLORS.textPrimary }} className="text-lg sm:text-2xl font-black truncate">{currentPlayer.name}</h2>
                    <p style={{ color: COLORS.textSecondary }} className="text-xs sm:text-sm">
                      {currentPlayer.nationality} · Base: <span style={{ color: COLORS.warning, fontFamily: "'JetBrains Mono', monospace" }} className="font-bold">{formatPrice(currentPlayer.basePrice)}</span>
                      {currentPlayer.previousTeam && (
                        <> · <span style={{ color: COLORS.primary }}>Prev: {currentPlayer.previousTeam}</span></>
                      )}
                    </p>
                    {/* Skill Tags */}
                    {currentPlayer.skills?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {currentPlayer.skills.map((skill) => (
                          <span key={skill} style={{ background: `${COLORS.primary}15`, color: COLORS.primary, border: `1px solid ${COLORS.primary}33` }}
                            className="text-xs px-2 py-0.5 rounded-md">{skill}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Timer */}
                  <div className="text-right flex-shrink-0">
                    <div style={{ color: timerColor, fontFamily: "'JetBrains Mono', monospace", textShadow: timerRemaining <= 5 ? `0 0 20px ${timerColor}` : "none" }}
                      className="text-3xl sm:text-5xl font-black leading-none">{String(timerRemaining).padStart(2, "0")}</div>
                    <p style={{ color: COLORS.textSecondary }} className="text-[10px] sm:text-xs mt-1">seconds</p>
                  </div>
                </div>

                {/* Timer bar */}
                <div style={{ background: COLORS.bgMain, borderRadius: "99px", overflow: "hidden" }} className="h-1 sm:h-1.5 mb-3 sm:mb-5">
                  <div style={{ width: `${timerPct}%`, background: `linear-gradient(90deg, ${timerColor}, ${timerColor}88)`, height: "100%", borderRadius: "99px", boxShadow: `0 0 8px ${timerColor}88`, transition: "width 1s linear, background 0.5s ease" }} />
                </div>

                {/* Player Stats Panel */}
                {(currentPlayer.stats2025 || currentPlayer.stats2024) && (
                  <div style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}` }} className="rounded-lg sm:rounded-xl p-3 sm:p-4 mb-3 sm:mb-5">
                    <div className="flex items-center justify-between mb-3">
                      <p style={{ color: COLORS.textSecondary }} className="text-xs font-medium uppercase tracking-wider">Season Stats</p>
                      {currentPlayer.fairPoint > 0 && (
                        <div style={{ background: "linear-gradient(135deg, #FFD70022, #FF8C0022)", border: "1px solid #FFD70044" }} className="px-3 py-1 rounded-lg">
                          <p style={{ color: "#FFD700", fontFamily: "'JetBrains Mono', monospace" }} className="text-sm font-black">Fair Point: {currentPlayer.fairPoint.toFixed(1)}</p>
                        </div>
                      )}
                    </div>
                    {/* FP Hint */}
                    <div style={{ background: `${COLORS.textSecondary}08`, border: `1px solid ${COLORS.border}`, borderRadius: "8px" }} className="px-3 py-2 mb-3 flex items-start gap-2">
                      <Info size={12} style={{ color: COLORS.textSecondary, marginTop: "2px", flexShrink: 0 }} />
                      <p style={{ color: COLORS.textSecondary }} className="text-[10px] leading-relaxed">
                        <span style={{ color: "#FFD700" }} className="font-bold">Fair Point</span> is based on the player's ideal position &amp; performance — <span style={{ color: COLORS.primary }}>70% current season</span> + <span style={{ color: COLORS.warning }}>30% previous season</span>. The <span style={{ color: COLORS.warning }}>Pos</span> column shows their batting/bowling rank from 2024.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      {/* 2025 Stats */}
                      {currentPlayer.stats2025 && (currentPlayer.stats2025.batting?.matches > 0 || currentPlayer.stats2025.bowling?.matches > 0) && (
                        <div style={{ background: `${COLORS.primary}08`, border: `1px solid ${COLORS.primary}22` }} className="rounded-lg p-2.5 sm:p-3">
                          <p style={{ color: COLORS.primary }} className="text-[9px] sm:text-[10px] font-bold mb-1.5 sm:mb-2 uppercase">2025 (Current · 70%)</p>
                          {currentPlayer.stats2025.batting?.matches > 0 && (
                            <div className="grid grid-cols-4 gap-1.5 mb-2">
                              {[{ label: "Mat", val: currentPlayer.stats2025.batting.matches },
                                { label: "Runs", val: currentPlayer.stats2025.batting.runs },
                                { label: "Avg", val: currentPlayer.stats2025.batting.average?.toFixed(1) },
                                { label: "SR", val: currentPlayer.stats2025.batting.strikeRate?.toFixed(1) },
                              ].map((s) => (
                                <div key={s.label} className="text-center">
                                  <p style={{ color: COLORS.textSecondary }} className="text-[9px]">{s.label}</p>
                                  <p style={{ color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{s.val || "-"}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {currentPlayer.stats2025.bowling?.matches > 0 && (
                            <div className="grid grid-cols-4 gap-1.5">
                              {[{ label: "Mat", val: currentPlayer.stats2025.bowling.matches },
                                { label: "Wkts", val: currentPlayer.stats2025.bowling.wickets },
                                { label: "Econ", val: currentPlayer.stats2025.bowling.economy?.toFixed(1) },
                                { label: "SR", val: currentPlayer.stats2025.bowling.strikeRate?.toFixed(1) },
                              ].map((s) => (
                                <div key={s.label} className="text-center">
                                  <p style={{ color: COLORS.textSecondary }} className="text-[9px]">{s.label}</p>
                                  <p style={{ color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{s.val || "-"}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* 2024 Stats */}
                      {currentPlayer.stats2024 && (currentPlayer.stats2024.batting?.matches > 0 || currentPlayer.stats2024.bowling?.matches > 0) && (
                        <div style={{ background: `${COLORS.warning}08`, border: `1px solid ${COLORS.warning}22` }} className="rounded-lg p-2.5 sm:p-3">
                          <p style={{ color: COLORS.warning }} className="text-[9px] sm:text-[10px] font-bold mb-1.5 sm:mb-2 uppercase">2024 (History · 30%)</p>
                          {currentPlayer.stats2024.batting?.matches > 0 && (
                            <div className="grid grid-cols-4 gap-1.5 mb-2">
                              {[{ label: "Pos", val: currentPlayer.stats2024.batting.position || "-" },
                                { label: "Runs", val: currentPlayer.stats2024.batting.runs },
                                { label: "Avg", val: currentPlayer.stats2024.batting.average?.toFixed(1) },
                                { label: "SR", val: currentPlayer.stats2024.batting.strikeRate?.toFixed(1) },
                              ].map((s) => (
                                <div key={s.label} className="text-center">
                                  <p style={{ color: COLORS.textSecondary }} className="text-[9px]">{s.label}</p>
                                  <p style={{ color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{s.val || "-"}</p>
                                </div>
                              ))}
                            </div>
                          )}
                          {currentPlayer.stats2024.bowling?.matches > 0 && (
                            <div className="grid grid-cols-4 gap-1.5">
                              {[{ label: "Pos", val: currentPlayer.stats2024.bowling.position || "-" },
                                { label: "Wkts", val: currentPlayer.stats2024.bowling.wickets },
                                { label: "Econ", val: currentPlayer.stats2024.bowling.economy?.toFixed(1) },
                                { label: "SR", val: currentPlayer.stats2024.bowling.strikeRate?.toFixed(1) },
                              ].map((s) => (
                                <div key={s.label} className="text-center">
                                  <p style={{ color: COLORS.textSecondary }} className="text-[9px]">{s.label}</p>
                                  <p style={{ color: COLORS.textPrimary, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs font-bold">{s.val || "-"}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Current Bid */}
                <div className="flex items-end gap-3 sm:gap-5 mb-3 sm:mb-5 flex-wrap">
                  <div>
                    <p style={{ color: COLORS.textSecondary }} className="text-[10px] sm:text-xs mb-1">Current Highest Bid</p>
                    <div style={{ color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace", textShadow: `0 0 30px ${COLORS.primary}`, transition: "all 0.3s ease", transform: isPricePulsing ? "scale(1.12)" : "scale(1)", filter: isPricePulsing ? `drop-shadow(0 0 16px ${COLORS.primary})` : "none" }}
                      className="text-2xl sm:text-4xl font-black">{formatPrice(currentBid)}</div>
                  </div>
                  {currentBidTeam && (
                    <div style={{ background: `${COLORS.success}22`, border: `1px solid ${COLORS.success}44` }} className="px-3 py-1.5 rounded-lg mb-1">
                      <p style={{ color: COLORS.textSecondary }} className="text-xs">Leader</p>
                      <p style={{ color: COLORS.success }} className="text-xs font-black">{currentBidTeam}</p>
                    </div>
                  )}
                  {isRtmMatch && <span style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="text-xs px-2 py-1 rounded-full font-bold mb-2">RTM Match</span>}
                </div>
              </div>
            </div>
          )}

          {/* Waiting / Paused */}
          {(!currentPlayer || auctionStatus === "PAUSED") && auctionStatus !== "COMPLETED" && (
            <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="rounded-2xl p-12 text-center">
              <p style={{ color: COLORS.textSecondary }} className="text-lg">
                {auctionStatus === "PAUSED" ? "⏸️ Auction Paused" : auctionStatus === "WAITING" ? "Auction is starting..." : "Selecting next player..."}
              </p>
            </div>
          )}

          {/* RTM Panel */}
          {isRtmEligible && (
            <div style={{ background: `${COLORS.warning}11`, border: `2px solid ${COLORS.warning}44` }} className="rounded-2xl p-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p style={{ color: COLORS.warning }} className="text-sm font-bold flex items-center gap-2"><AlertTriangle size={16} /> RTM Available</p>
                  <p style={{ color: COLORS.textSecondary }} className="text-xs mt-1">Match {formatPrice(rtmPending?.currentBid)} to reclaim {currentPlayer?.name}</p>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleRtm("use")}
                    style={{ background: `linear-gradient(135deg, ${COLORS.warning}, #CC9A00)`, color: "#0F172A" }}
                    className="px-5 py-2.5 rounded-xl text-sm font-black hover:scale-105 transition-all">Use RTM ({formatPrice(rtmPending?.currentBid)})</button>
                  <button onClick={() => handleRtm("pass")}
                    style={{ background: COLORS.bgCard, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` }}
                    className="px-5 py-2.5 rounded-xl text-sm font-bold">Pass</button>
                </div>
              </div>
            </div>
          )}

          {/* Bid Controls */}
          {canBid && !soldOverlay && (
            <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="rounded-xl sm:rounded-2xl p-3 sm:p-6">
              <p style={{ color: COLORS.textSecondary }} className="text-xs sm:text-sm mb-2 sm:mb-4 font-medium">Place your bid:</p>
              <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3 items-stretch sm:flex-wrap">
                {bidAmounts.map((amount) => (
                  <button key={amount} onClick={() => placeBid(amount)}
                    style={{ background: COLORS.bgMain, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}`, fontFamily: "'JetBrains Mono', monospace" }}
                    className="px-3 sm:px-6 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold hover:scale-105 transition-all sm:min-w-[110px]">
                    {formatPrice(amount)}
                  </button>
                ))}
                <button onClick={() => placeBid(minNextBid)}
                  style={{ background: `linear-gradient(135deg, ${COLORS.accent}, #CC2000)`, color: "#fff", boxShadow: `0 0 24px ${COLORS.accent}44` }}
                  className="col-span-2 sm:col-span-1 px-6 sm:px-10 py-2.5 sm:py-3.5 rounded-lg sm:rounded-xl font-black text-sm sm:text-base flex items-center justify-center gap-2 hover:scale-105 transition-all">
                  <Gavel size={18} /> BID!
                </button>
              </div>
            </div>
          )}

          {/* Current highest bidder notice */}
          {auctionStatus === "BIDDING" && !isSpectatorMode && currentBidTeam === user.teamName && (
            <div style={{ background: `${COLORS.success}15`, border: `1px solid ${COLORS.success}44` }} className="rounded-xl p-4 text-center">
              <p style={{ color: COLORS.success }} className="font-bold">You have the highest bid! 🎯</p>
            </div>
          )}

          {/* Mobile Teams Grid */}
          <div className="lg:hidden">
            <p style={{ color: COLORS.textSecondary }} className="text-[10px] sm:text-xs font-medium mb-2 uppercase">Teams</p>
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 sm:gap-2">
              {teams.map((t) => (
                <div key={t.teamName} style={{
                  background: currentBidTeam === t.teamName ? `${COLORS.success}15` : COLORS.bgCard,
                  border: `1px solid ${currentBidTeam === t.teamName ? COLORS.success + "44" : COLORS.border}`,
                }} className="p-2 sm:p-3 rounded-lg sm:rounded-xl">
                  <p style={{ color: COLORS.textPrimary }} className="text-[10px] sm:text-xs font-bold truncate">{t.teamShortName || t.teamName}</p>
                  <p style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-xs sm:text-sm font-bold">{formatPrice(t.remainingPurse)}</p>
                  <p style={{ color: COLORS.textSecondary }} className="text-[9px] sm:text-xs">{t.squadSize ?? 0} pl</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Chat */}
        <div style={{ borderLeft: `1px solid ${COLORS.border}` }} className="hidden xl:flex flex-col overflow-hidden min-h-0">
          <div style={{ borderBottom: `1px solid ${COLORS.border}` }} className="px-4 py-3.5 flex items-center gap-2 shrink-0">
            <div style={{ background: COLORS.primary }} className="w-2.5 h-2.5 rounded-full animate-pulse" />
            <p style={{ color: COLORS.textPrimary }} className="text-sm font-bold">Auction Chat</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, i) => {
              const isMe = msg.userId === user.userId;
              return (
                <div key={msg._id || i} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
                  <div style={{ background: `${COLORS.primary}22`, color: COLORS.primary }} className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0">
                    {(msg.userName || "?")[0]}
                  </div>
                  <div>
                    <p style={{ color: COLORS.primary }} className="text-xs font-bold mb-0.5">{msg.userName}</p>
                    <div style={{ background: isMe ? `${COLORS.primary}22` : COLORS.bgCard, border: `1px solid ${isMe ? COLORS.primary + "33" : COLORS.border}`, color: COLORS.textPrimary }}
                      className="px-3 py-2 rounded-xl text-sm max-w-[200px] mt-0.5 leading-relaxed">{msg.message}</div>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          {!isSpectatorMode && (
            <div style={{ borderTop: `1px solid ${COLORS.border}` }} className="p-4 shrink-0">
              <div className="flex gap-2">
                <input type="text" placeholder="Message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, outline: "none" }}
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm" />
                <button onClick={sendChat} style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A" }} className="p-2.5 rounded-xl hover:scale-105 transition-transform">
                  <Send size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}