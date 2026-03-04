import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Crown, Users, Wallet, Play, Clock, Shield, Copy, Check, UserMinus } from "lucide-react";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { COLORS, formatPrice, formatActivity } from "../data/constants";

export default function Lobby() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();

  const [room, setRoom] = useState(null);
  const [teams, setTeams] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timerConfig, setTimerConfig] = useState(15);
  const chatEndRef = useRef(null);

  const isHost = room?.host?.userId === user.userId;
  const myTeam = teams.find((t) => t.userId === user.userId);

  useEffect(() => {
    if (!socket) return;

    // Server pushes chat:history & activity:history after room:join
    socket.on("chat:history", (msgs) => setMessages(msgs || []));
    socket.on("activity:history", (acts) => setActivityLog(acts || []));

    socket.emit("room:join", {
      roomCode: code,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
    }, (res) => {
      if (res.success) {
        setRoom(res.room);
        setTeams(res.room.joinedTeams || []);
      } else {
        setError(res.error);
      }
    });

    socket.on("room:updated", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
    });
    socket.on("room:userJoined", (data) => {
      setTeams(data.joinedTeams || []);
    });
    socket.on("room:userLeft", (data) => {
      setTeams((prev) => prev.map((t) => t.userId === data.userId ? { ...t, isConnected: false } : t));
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
    socket.on("chat:message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    socket.on("activity:new", (item) => {
      setActivityLog((prev) => [...prev, item]);
    });
    socket.on("auction:initialized", () => {
      navigate(`/room/${code}/auction`);
    });

    return () => {
      socket.off("room:updated");
      socket.off("room:userJoined");
      socket.off("room:userLeft");
      socket.off("room:teamKicked");
      socket.off("auction:timerChanged");
      socket.off("chat:message");
      socket.off("activity:new");
      socket.off("auction:initialized");
      socket.off("chat:history");
      socket.off("activity:history");
    };
  }, [socket, code]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!chatInput.trim() || !socket) return;
    socket.emit("chat:send", {
      roomCode: code,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
      message: chatInput,
    });
    setChatInput("");
  };

  const handleReady = () => {
    socket.emit("room:ready", { roomCode: code, userId: user.userId, isReady: true });
  };

  const handleKick = (targetUserId) => {
    if (!socket || !isHost) return;
    if (!confirm("Are you sure you want to kick this team?")) return;
    socket.emit("room:kick", { roomCode: code, userId: user.userId, targetUserId }, (res) => {
      if (!res?.success) { setError(res?.error || "Kick failed"); setTimeout(() => setError(""), 3000); }
    });
  };

  const handleTimerChange = (seconds) => {
    if (!socket || !isHost) return;
    socket.emit("auction:timerConfig", { roomCode: code, userId: user.userId, seconds }, (res) => {
      if (res?.success) setTimerConfig(seconds);
      else { setError(res?.error || "Timer change failed"); setTimeout(() => setError(""), 3000); }
    });
  };

  const handleStart = () => {
    setStarting(true);
    socket.emit("auction:start", { roomCode: code, userId: user.userId }, (res) => {
      setStarting(false);
      if (res.success) {
        navigate(`/room/${code}/auction`);
      } else {
        setError(res.error);
      }
    });
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const readyCount = teams.filter((t) => t.isReady).length;
  const leagueName = room?.league?.name || "";

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex flex-col h-screen">
      {/* Room Header */}
      <div style={{ background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.border}` }}
        className="px-6 sm:px-8 py-5 flex items-center justify-between gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/rooms")} style={{ color: COLORS.textSecondary }} className="hover:text-white p-1">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 style={{ color: COLORS.textPrimary }} className="font-black text-xl">{room?.roomName || "Lobby"}</h1>
              {leagueName && (
                <span style={{ background: `${COLORS.warning}22`, color: COLORS.warning, border: `1px solid ${COLORS.warning}44`, fontFamily: "'JetBrains Mono', monospace" }}
                  className="text-xs px-2 py-0.5 rounded-md font-bold">{leagueName}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <p style={{ color: COLORS.textSecondary }} className="text-xs flex items-center gap-1">
                <Clock size={11} /> Waiting for host to start · Room
              </p>
              <button onClick={copyCode} style={{ color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace" }}
                className="text-xs font-bold flex items-center gap-1 hover:opacity-80">
                #{code} {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span style={{ color: COLORS.textSecondary }} className="text-sm flex items-center gap-1">
            <Users size={14} /> {readyCount}/{teams.length} teams ready
          </span>
          {isHost && (
            <button onClick={handleStart} disabled={starting}
              style={{ background: `linear-gradient(135deg, ${COLORS.success}, #00A040)`, color: "#fff", boxShadow: `0 0 20px ${COLORS.success}44` }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black hover:scale-105 transition-all disabled:opacity-50">
              <Play size={16} fill="white" /> {starting ? "Starting..." : "Start Auction"}
            </button>
          )}
          {!isHost && !myTeam?.isReady && (
            <button onClick={handleReady}
              style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A", boxShadow: `0 0 20px ${COLORS.primary}44` }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black hover:scale-105 transition-all">
              <Check size={16} /> Ready Up
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: `${COLORS.accent}22`, color: COLORS.accent }} className="px-4 py-3 text-sm text-center">{error}</div>
      )}

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr_1fr] overflow-hidden min-h-0">
        {/* Left: Team List */}
        <div style={{ borderRight: `1px solid ${COLORS.border}`, overflowY: "auto" }} className="lg:col-span-1 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-base flex items-center gap-2">
              <Users size={18} style={{ color: COLORS.primary }} /> Teams ({teams.length}/{room?.maxTeams || "?"})
            </h2>
          </div>

          <div className="space-y-4">
            {teams.map((team, i) => {
              const isMe = team.userId === user.userId;
              const teamColor = isMe ? COLORS.primary : COLORS.textSecondary;
              return (
                <div key={team.teamName}
                  style={{ background: isMe ? `${COLORS.primary}15` : COLORS.bgMain, border: `1px solid ${isMe ? COLORS.primary + "44" : COLORS.border}` }}
                  className="p-5 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div style={{ background: `${teamColor}22`, color: teamColor, border: `1px solid ${teamColor}44` }}
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-black flex-shrink-0">
                      {(team.teamShortName || team.teamName || "?")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p style={{ color: COLORS.textPrimary }} className="font-bold text-base truncate">{team.teamName}</p>
                        {team.userId === room?.host?.userId && <Crown size={14} style={{ color: COLORS.warning }} />}
                      </div>
                      <p style={{ color: COLORS.textSecondary }} className="text-sm mt-0.5">{team.userName} {isMe ? "(You)" : ""}</p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <p style={{ color: COLORS.success, fontFamily: "'JetBrains Mono', monospace" }} className="text-sm font-bold">
                          {formatPrice(team.remainingPurse)}
                        </p>
                        <span style={{
                          background: team.isReady ? `${COLORS.success}22` : team.isConnected === false ? `${COLORS.accent}22` : `${COLORS.warning}22`,
                          color: team.isReady ? COLORS.success : team.isConnected === false ? COLORS.accent : COLORS.warning,
                        }} className="text-xs px-2 py-1 rounded-md font-medium inline-block mt-1">
                          {team.isReady ? "Ready" : team.isConnected === false ? "Offline" : "Waiting"}
                        </span>
                      </div>
                      {isHost && team.userId !== user.userId && (
                        <button onClick={() => handleKick(team.userId)} title="Kick team"
                          style={{ color: COLORS.accent }} className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors">
                          <UserMinus size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Purse bar */}
                  <div className="mt-4">
                    <div style={{ background: COLORS.bgCard, height: "5px", borderRadius: "99px", overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.max(0, ((team.remainingPurse || 0) / (team.totalPurse || 1)) * 100)}%`,
                        background: `linear-gradient(90deg, ${teamColor}, ${teamColor}88)`,
                        height: "100%", borderRadius: "99px",
                      }} />
                    </div>
                    <div className="flex justify-between mt-2">
                      <span style={{ color: COLORS.textSecondary }} className="text-xs flex items-center gap-1">
                        <Wallet size={11} /> {formatPrice(team.remainingPurse)} remaining
                      </span>
                      <span style={{ color: COLORS.textSecondary }} className="text-xs">
                        {team.retentions?.length || 0} retained
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {teams.length < (room?.maxTeams || 10) && (
              <div style={{ border: `2px dashed ${COLORS.border}` }} className="p-5 rounded-2xl text-center">
                <p style={{ color: COLORS.textSecondary }} className="text-sm">Waiting for more teams...</p>
              </div>
            )}
          </div>

          {/* Retention Button */}
          {room?.retentionEnabled && (
            <button onClick={() => navigate(`/room/${code}/retention`)}
              style={{ background: `${COLORS.warning}22`, color: COLORS.warning, border: `1px solid ${COLORS.warning}44` }}
              className="w-full mt-5 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:opacity-80 transition-opacity">
              <Shield size={15} /> Configure Retention
            </button>
          )}

          {/* Timer Config (Host only) */}
          {isHost && (
            <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }} className="mt-5 rounded-2xl p-5">
              <p style={{ color: COLORS.textPrimary }} className="text-sm font-bold flex items-center gap-2 mb-3">
                <Clock size={15} style={{ color: COLORS.primary }} /> Bid Timer Duration
              </p>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map(s => (
                  <button key={s} onClick={() => handleTimerChange(s)}
                    style={{
                      background: timerConfig === s ? `${COLORS.primary}22` : COLORS.bgMain,
                      color: timerConfig === s ? COLORS.primary : COLORS.textSecondary,
                      border: `1px solid ${timerConfig === s ? COLORS.primary + "44" : COLORS.border}`,
                    }}
                    className="py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-105">
                    {s}s
                  </button>
                ))}
              </div>
              <p style={{ color: COLORS.textSecondary }} className="text-xs mt-2">Each bid resets the timer to {timerConfig} seconds</p>
            </div>
          )}
        </div>

        {/* Right: Chat + Activity */}
        <div className="lg:col-span-2 grid grid-rows-1 md:grid-cols-2 h-full overflow-hidden min-h-0">
          {/* Chat Panel */}
          <div style={{ borderRight: `1px solid ${COLORS.border}` }} className="flex flex-col overflow-hidden min-h-0">
            <div style={{ borderBottom: `1px solid ${COLORS.border}` }} className="px-5 py-4 flex items-center gap-2 shrink-0">
              <div style={{ background: COLORS.primary }} className="w-2.5 h-2.5 rounded-full animate-pulse" />
              <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-base">Live Chat</h2>
              <span style={{ color: COLORS.textSecondary }} className="text-xs ml-auto">{messages.length} messages</span>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.map((msg, i) => {
                const isMe = msg.userId === user.userId || msg.userName === user.userName;
                const msgColor = COLORS.primary;
                return (
                  <div key={msg._id || i} className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
                    <div style={{ background: `${msgColor}22`, color: msgColor, border: `1px solid ${msgColor}44` }}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0">
                      {(msg.userName || "?")[0]}
                    </div>
                    <div className={isMe ? "items-end flex flex-col" : ""}>
                      <p style={{ color: msgColor }} className="text-xs font-bold mb-1">
                        {msg.userName || "User"} · {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </p>
                      <div style={{
                        background: isMe ? `${COLORS.primary}22` : COLORS.bgCard,
                        border: `1px solid ${isMe ? COLORS.primary + "33" : COLORS.border}`,
                        color: COLORS.textPrimary,
                      }} className="px-4 py-2.5 rounded-2xl text-sm max-w-xs leading-relaxed">
                        {msg.message}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
            <div style={{ borderTop: `1px solid ${COLORS.border}` }} className="p-4 shrink-0">
              <div className="flex gap-3">
                <input type="text" placeholder="Type a message..." value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, outline: "none" }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm" />
                <button onClick={sendMessage}
                  style={{ background: `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`, color: "#0F172A" }}
                  className="p-3 rounded-xl hover:scale-105 transition-transform">
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Activity Feed */}
          <div className="flex flex-col overflow-hidden min-h-0">
            <div style={{ borderBottom: `1px solid ${COLORS.border}` }} className="px-5 py-4 flex items-center gap-2 shrink-0">
              <h2 style={{ color: COLORS.textPrimary }} className="font-bold text-base">Activity Feed</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {activityLog.map((item, i) => {
                const isJoin = item.type?.includes("JOIN");
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div style={{ background: isJoin ? `${COLORS.success}22` : `${COLORS.primary}22` }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      {isJoin ? <Users size={13} style={{ color: COLORS.success }} /> : <Clock size={13} style={{ color: COLORS.primary }} />}
                    </div>
                    <div>
                      <p style={{ color: COLORS.textPrimary }} className="text-sm">{formatActivity(item)}</p>
                      <p style={{ color: COLORS.textSecondary }} className="text-xs">
                        {item.createdAt ? new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
              {activityLog.length === 0 && (
                <div style={{ background: `${COLORS.primary}11`, border: `1px dashed ${COLORS.primary}44` }} className="p-4 rounded-xl text-center">
                  <p style={{ color: COLORS.textSecondary }} className="text-sm">Activity will appear here as teams join...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
