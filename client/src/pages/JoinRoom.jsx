import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, LogIn, ChevronDown, Users } from "lucide-react";
import { api } from "../services/api";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { COLORS } from "../data/constants";
import StatusBadge from "../components/StatusBadge";

export default function JoinRoom() {
  const navigate = useNavigate();
  const { code: urlCode } = useParams();
  const { user, updateUser } = useUser();
  const { socket } = useSocket();

  const [roomCode, setRoomCode] = useState(urlCode || "");
  const [room, setRoom] = useState(null);
  const [league, setLeague] = useState(null);
  const [userName, setUserName] = useState(user.userName || "");
  const [teamName, setTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch room details when code changes
  useEffect(() => {
    if (roomCode.length >= 4) {
      api.getRoom(roomCode).then((data) => {
        setRoom(data);
        setError("");
        if (data.league) {
          api.getLeague(typeof data.league === "string" ? data.league : data.league._id)
            .then(setLeague)
            .catch(() => {});
        }
      }).catch((err) => {
        setRoom(null);
        setError(err.message);
      });
    }
  }, [roomCode]);

  const takenTeams = room?.joinedTeams?.map((t) => t.teamName) || [];
  const availableTeams = league?.teams?.filter((t) => !takenTeams.includes(t.name)) || [];
  const isAuctionLive = room && ["auction", "paused"].includes(room.status);
  const isRetentionPhase = room && room.status === "retention";
  const isAlreadyJoined = room?.joinedTeams?.some((t) => t.userId === user.userId);
  const canJoin = room && availableTeams.length > 0;

  const handleJoin = async () => {
    if (!roomCode || !userName || !teamName) return;
    if (!socket) { setError("Not connected to server"); return; }
    setLoading(true);
    setError("");

    socket.emit("room:join", {
      roomCode,
      userId: user.userId,
      userName,
      teamName,
    }, (res) => {
      setLoading(false);
      if (res?.success) {
        const roomData = res.room;
        const team = roomData.joinedTeams?.find((t) => t.userId === user.userId);
        updateUser({
          userName,
          teamName,
          teamShortName: team?.teamShortName || "",
          roomCode,
          isHost: false,
        });
        if (roomData.status === "retention") {
          navigate(`/room/${roomCode}/retention`);
        } else if (roomData.status === "lobby" || roomData.status === "waiting") {
          navigate(`/room/${roomCode}/lobby`);
        } else if (roomData.status === "auction" || roomData.status === "paused") {
          navigate(`/room/${roomCode}/auction`);
        } else if (roomData.status === "completed") {
          navigate(`/room/${roomCode}/results`);
        }
      } else {
        setError(res?.error || "Failed to join room");
      }
    });
  };

  const handleSpectate = () => {
    if (!socket || !roomCode) return;
    socket.emit("room:spectate", {
      roomCode,
      userId: user.userId,
      userName: userName || "Spectator",
    }, (res) => {
      if (res?.success) {
        updateUser({ roomCode, isHost: false, teamName: "", userName: userName || "Spectator" });
        navigate(`/room/${roomCode}/auction?spectate=1`);
      } else {
        setError(res?.error || "Cannot spectate");
      }
    });
  };

  return (
    <div style={{ background: COLORS.bgMain, fontFamily: "'Inter', sans-serif" }} className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="fixed inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: `linear-gradient(${COLORS.border} 1px, transparent 1px), linear-gradient(90deg, ${COLORS.border} 1px, transparent 1px)`, backgroundSize: "48px 48px" }} />

      <div className="relative w-full max-w-xl">
        <button onClick={() => navigate("/")} style={{ color: COLORS.textSecondary }} className="flex items-center gap-2 text-sm mb-6 hover:text-white transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </button>

        <div style={{ background: "rgba(30, 41, 59, 0.8)", border: `1px solid ${COLORS.border}`, backdropFilter: "blur(20px)" }} className="rounded-3xl p-10">
          <div className="flex items-center gap-4 mb-10">
            <div style={{ background: `linear-gradient(135deg, ${COLORS.success}, #00A040)`, boxShadow: `0 0 20px ${COLORS.success}55` }} className="w-12 h-12 rounded-xl flex items-center justify-center">
              <LogIn size={20} color="#0F172A" />
            </div>
            <div>
              <h1 style={{ color: COLORS.textPrimary }} className="font-black text-2xl">Join Auction Room</h1>
              <p style={{ color: COLORS.textSecondary }} className="text-sm">Enter a room code to join</p>
            </div>
          </div>

          {error && (
            <div style={{ background: `${COLORS.accent}22`, border: `1px solid ${COLORS.accent}44`, color: COLORS.accent }} className="text-sm px-4 py-3 rounded-xl mb-4">{error}</div>
          )}

          <div className="space-y-7">
            {/* Your Name */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">Your Name <span style={{ color: COLORS.accent }}>*</span></label>
              <input type="text" placeholder="Enter your name" value={userName} onChange={(e) => setUserName(e.target.value)}
                style={{ background: COLORS.bgMain, border: `1px solid ${COLORS.border}`, color: COLORS.textPrimary, outline: "none" }}
                className="w-full px-4 py-3 rounded-xl text-sm" />
            </div>

            {/* Room Code */}
            <div>
              <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">Room Code <span style={{ color: COLORS.accent }}>*</span></label>
              <input type="text" placeholder="Enter room code (e.g. ABCD)" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} maxLength={10}
                style={{ background: COLORS.bgMain, border: `1px solid ${room ? COLORS.success + "66" : COLORS.border}`, color: COLORS.textPrimary, outline: "none", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "4px", boxShadow: room ? `0 0 12px ${COLORS.success}22` : "none" }}
                className="w-full px-4 py-3 rounded-xl text-sm text-center font-bold" />
            </div>

            {/* Room Info */}
            {room && (
              <div style={{ background: `${COLORS.primary}11`, border: `1px solid ${COLORS.primary}33` }} className="rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 style={{ color: COLORS.textPrimary }} className="font-bold text-sm">{room.roomName}</h3>
                  <StatusBadge status={room.status} />
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: COLORS.textSecondary }}>
                  <span className="flex items-center gap-1"><Users size={12} /> {room.joinedTeams?.length || 0}/{room.maxTeams} teams</span>
                  {room.retentionEnabled && <span style={{ color: COLORS.warning }}>RTM Enabled</span>}
                </div>
              </div>
            )}

            {/* Retention phase — info banner */}
            {isRetentionPhase && !isAlreadyJoined && (
              <div style={{ background: `${COLORS.primary}15`, border: `1px solid ${COLORS.primary}33` }} className="rounded-xl p-4 text-center">
                <p style={{ color: COLORS.primary }} className="font-bold text-sm mb-1">Retention Phase Active</p>
                <p style={{ color: COLORS.textSecondary }} className="text-xs">You can join now and configure your retentions before the auction starts.</p>
              </div>
            )}

            {/* Late join info */}
            {isAuctionLive && !isAlreadyJoined && availableTeams.length > 0 && (
              <div style={{ background: `${COLORS.primary}15`, border: `1px solid ${COLORS.primary}33` }} className="rounded-xl p-4 text-center">
                <p style={{ color: COLORS.primary }} className="font-bold text-sm mb-1">Auction is Live — You Can Still Join!</p>
                <p style={{ color: COLORS.textSecondary }} className="text-xs">Pick a team to join mid-auction. {room.retentionEnabled ? "You'll get full RTM cards since you skipped retention." : ""}</p>
              </div>
            )}

            {/* Team Selection */}
            {room && availableTeams.length > 0 && (
              <div>
                <label style={{ color: COLORS.textSecondary }} className="block text-sm mb-2">Pick Your Team <span style={{ color: COLORS.accent }}>*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {availableTeams.map((team) => (
                    <button key={team.name} type="button" onClick={() => setTeamName(team.name)}
                      style={{
                        background: teamName === team.name ? `${COLORS.primary}22` : COLORS.bgMain,
                        border: `1px solid ${teamName === team.name ? COLORS.primary : COLORS.border}`,
                        color: teamName === team.name ? COLORS.primary : COLORS.textSecondary,
                      }}
                      className="px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left">
                      <div>{team.shortName}</div>
                      <div className="font-normal text-xs opacity-70 truncate">{team.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {room && availableTeams.length === 0 && room.joinedTeams?.length >= room.maxTeams && (
              <div style={{ color: COLORS.warning }} className="text-sm text-center py-4">Room is full — you can spectate instead.</div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={handleJoin} disabled={loading || !room || !teamName || !userName}
                style={{
                  background: !room || !teamName || !userName ? COLORS.border : `linear-gradient(135deg, ${COLORS.primary}, #0090FF)`,
                  color: !room || !teamName || !userName ? COLORS.textSecondary : "#0F172A",
                  cursor: !room || !teamName || !userName ? "not-allowed" : "pointer",
                  boxShadow: room && teamName ? `0 0 24px ${COLORS.primary}44` : "none",
                }}
                className="flex-1 py-4 rounded-xl font-black text-base flex items-center justify-center gap-2 transition-all hover:scale-[1.02]">
                {loading ? <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <><LogIn size={18} /> {isAlreadyJoined ? "Rejoin" : isAuctionLive ? "Join Auction" : isRetentionPhase ? "Join & Retain" : "Join Room"}</>}
              </button>
              {room && (room.visibility === "public" || isAuctionLive) && (
                <button onClick={handleSpectate}
                  style={{ background: COLORS.bgCard, color: COLORS.textPrimary, border: `1px solid ${COLORS.border}` }}
                  className="px-6 py-4 rounded-xl font-bold text-sm transition-all hover:scale-[1.02]">
                  Spectate
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
