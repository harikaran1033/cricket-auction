import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { formatPrice, getRoleColor } from "../utils";
import ChatPanel from "../components/chat/ChatPanel";
import ActivityPanel from "../components/chat/ActivityPanel";

export default function Auction() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();
  const [searchParams] = useSearchParams();
  const spectateParam = (searchParams.get("spectate") || "").toLowerCase();
  const isSpectatorMode = spectateParam === "1" || spectateParam === "true";
  const spectatorName =
    user.userName?.trim() || `Spectator-${(user.userId || "????").slice(0, 4).toUpperCase()}`;

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
  const [stats, setStats] = useState({ totalPlayersSold: 0, totalPlayersUnsold: 0 });
  const [tab, setTab] = useState("chat"); // chat | activity | squads

  const timerRef = useRef(null);
  const isHost = roomData?.host?.userId === user.userId;
  const myTeam = isSpectatorMode
    ? null
    : teams.find((t) => t.userId === user.userId || t.teamName === user.teamName);

  // ─── Socket Setup ───
  useEffect(() => {
    if (!socket) return;

    // Join room or spectate
    if (isSpectatorMode) {
      socket.emit(
        "room:spectate",
        {
          roomCode: code,
          userId: user.userId,
          userName: spectatorName,
        },
        (res) => {
          if (res.success) {
            setRoomData(res.room);
            setTeams(res.room.joinedTeams || []);
          } else if (res?.error) {
            setError(res.error);
          }
        }
      );
    } else {
      socket.emit(
        "room:join",
        {
          roomCode: code,
          userId: user.userId,
          userName: user.userName,
          teamName: user.teamName,
        },
        (res) => {
          if (res.success) {
            setRoomData(res.room);
            setTeams(res.room.joinedTeams || []);
          } else if (res?.error) {
            setError(res.error);
          }
        }
      );
    }

    // Get current auction state (for reconnects)
    socket.emit("auction:getState", { roomCode: code }, (res) => {
      if (res.success && res.state) {
        applyAuctionState(res.state);
      }
    });

    // ── Event listeners ──

    socket.on("auction:playerNominated", (data) => {
      setSoldOverlay(null);
      setRtmPending(null);
      setIsRtmMatch(false);
      setCurrentPlayer(data.player);
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(null);
      setMinNextBid(data.currentBid);
      setAuctionStatus("BIDDING");
      startClientTimer(data.timerEndsAt);
    });

    socket.on("auction:bidPlaced", (data) => {
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(data.currentBidTeam);
      setMinNextBid(data.minNextBid);
      // If RTM team matched, bidding re-opens; clear RTM pending state
      if (data.isRtmMatch) {
        setRtmPending(null);
        setAuctionStatus("BIDDING");
        setIsRtmMatch(true);
      } else {
        setIsRtmMatch(false);
      }
      startClientTimer(data.timerEndsAt);
    });

    socket.on("auction:playerSold", (data) => {
      clearClientTimer();
      setAuctionStatus("SOLD");
      setTeams(
        data.teams.map((t) => {
          const existing = teams.find((et) => et.teamName === t.teamName);
          return existing ? { ...existing, ...t } : t;
        })
      );
      setSoldOverlay({
        type: "sold",
        player: data.player,
        soldTo: data.soldTo,
        soldPrice: data.soldPrice,
        acquiredVia: data.acquiredVia,
      });
      setStats((s) => ({ ...s, totalPlayersSold: s.totalPlayersSold + 1 }));
      // Auto-dismiss after 3s
      setTimeout(() => setSoldOverlay(null), 3000);
    });

    socket.on("auction:playerUnsold", (data) => {
      clearClientTimer();
      setAuctionStatus("UNSOLD");
      setSoldOverlay({
        type: "unsold",
        player: data.player,
      });
      setStats((s) => ({ ...s, totalPlayersUnsold: s.totalPlayersUnsold + 1 }));
      setTimeout(() => setSoldOverlay(null), 3000);
    });

    socket.on("auction:rtmPending", (data) => {
      clearClientTimer();
      setAuctionStatus("RTM_PENDING");
      setRtmPending(data);
      startClientTimer(data.timerEndsAt);
    });

    socket.on("auction:timerTick", (data) => {
      setTimerRemaining(data.remaining);
    });

    socket.on("auction:paused", () => {
      clearClientTimer();
      setAuctionStatus("PAUSED");
    });

    socket.on("auction:resumed", () => {
      setAuctionStatus("BIDDING");
    });

    socket.on("auction:completed", (data) => {
      clearClientTimer();
      setAuctionStatus("COMPLETED");
      setStats(data.stats);
    });

    socket.on("auction:error", (data) => {
      setError(data.error);
      setTimeout(() => setError(""), 3000);
    });

    socket.on("room:updated", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
    });

    // Server pushes auction state to late joiners
    socket.on("auction:state", (state) => {
      if (state) applyAuctionState(state);
    });

    return () => {
      clearClientTimer();
      socket.off("auction:playerNominated");
      socket.off("auction:bidPlaced");
      socket.off("auction:playerSold");
      socket.off("auction:playerUnsold");
      socket.off("auction:rtmPending");
      socket.off("auction:timerTick");
      socket.off("auction:paused");
      socket.off("auction:resumed");
      socket.off("auction:completed");
      socket.off("auction:error");
      socket.off("auction:state");
      socket.off("room:updated");
    };
  }, [socket, code, isSpectatorMode, spectatorName, user.userId, user.userName, user.teamName]);

  // Apply full state (for reconnect)
  const applyAuctionState = (state) => {
    setAuctionStatus(state.status);
    if (state.currentLeaguePlayer?.player) {
      const p = state.currentLeaguePlayer.player;
      setCurrentPlayer({
        playerId: p._id,
        name: p.name,
        nationality: p.nationality,
        isOverseas: p.isOverseas,
        role: p.role,
        image: p.image,
      });
    }
    setCurrentBid(state.currentBid || 0);
    setCurrentBidTeam(state.currentBidTeam || null);
    setTimerRemaining(state.timerRemaining || 0);
    if (state.teams) setTeams(state.teams);
    setStats({
      totalPlayersSold: state.totalPlayersSold || 0,
      totalPlayersUnsold: state.totalPlayersUnsold || 0,
    });
    if (state.timerEndsAt && ["BIDDING", "RTM_PENDING"].includes(state.status)) {
      startClientTimer(state.timerEndsAt);
    }
    if (state.rtmActive) {
      setRtmPending({
        rtmTeam: state.rtmEligibleTeam,
        currentBid: state.currentBid,
        currentBidTeam: state.currentBidTeam,
      });
    }
  };

  // ─── Client-side timer sync ───
  const startClientTimer = (timerEndsAt) => {
    clearClientTimer();
    const endTime = new Date(timerEndsAt).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setTimerRemaining(remaining);
      if (remaining > 0) {
        timerRef.current = requestAnimationFrame(tick);
      }
    };
    timerRef.current = requestAnimationFrame(tick);
  };

  const clearClientTimer = () => {
    if (timerRef.current) {
      cancelAnimationFrame(timerRef.current);
      timerRef.current = null;
    }
  };

  // ─── Actions ───
  const placeBid = useCallback(
    (amount) => {
      if (isSpectatorMode || !socket) return;
      setError("");
      socket.emit("auction:bid", {
        roomCode: code,
        userId: user.userId,
        teamName: user.teamName,
        amount,
      }, (res) => {
        if (!res.success) {
          setError(res.error);
          setTimeout(() => setError(""), 3000);
        }
      });
    },
    [socket, code, user, isSpectatorMode]
  );

  const handleRtm = useCallback(
    (action) => {
      if (isSpectatorMode || !socket) return;
      const event = action === "use" ? "auction:rtmUse" : "auction:rtmPass";
      socket.emit(event, {
        roomCode: code,
        userId: user.userId,
        teamName: user.teamName,
      });
    },
    [socket, code, user, isSpectatorMode]
  );

  const handlePause = () => {
    if (isSpectatorMode) return;
    socket?.emit("auction:pause", { roomCode: code, userId: user.userId });
  };

  const handleResume = () => {
    if (isSpectatorMode) return;
    socket?.emit("auction:resume", { roomCode: code, userId: user.userId });
  };

  // ─── Compute bid buttons ───
  const bidAmounts = [];
  if (minNextBid > 0) {
    bidAmounts.push(minNextBid);
    const increments = [25, 50, 75, 100];
    increments.forEach((inc) => {
      const val = minNextBid + inc;
      if (val <= (myTeam?.remainingPurse || 0)) {
        bidAmounts.push(val);
      }
    });
  }

  const canBid =
    !isSpectatorMode &&
    auctionStatus === "BIDDING" &&
    currentBidTeam !== user.teamName &&
    myTeam &&
    myTeam.remainingPurse >= minNextBid;

  const isRtmEligible =
    !isSpectatorMode &&
    auctionStatus === "RTM_PENDING" &&
    rtmPending?.rtmTeam === user.teamName;

  // Timer styling
  const timerClass =
    timerRemaining <= 3 ? "danger" : timerRemaining <= 7 ? "warning" : "";

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      {/* Error toast */}
      {error && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: "var(--danger)", color: "white", padding: "12px 24px",
          borderRadius: 8, zIndex: 2000, fontWeight: 600, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {/* Sold/Unsold overlay */}
      {soldOverlay && (
        <div className="sold-overlay" onClick={() => setSoldOverlay(null)}>
          <div className={`sold-card ${soldOverlay.type}`}>
            <div className={`sold-label ${soldOverlay.type}`}>
              {soldOverlay.type === "sold" ? "SOLD!" : "UNSOLD"}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 16 }}>
              {soldOverlay.player?.name}
            </div>
            {soldOverlay.type === "sold" && (
              <>
                <div style={{ fontSize: 18, color: "var(--warning)", marginTop: 8 }}>
                  to {soldOverlay.soldTo}
                </div>
                <div style={{ fontSize: 36, fontWeight: 800, color: "var(--success)", marginTop: 8 }}>
                  {formatPrice(soldOverlay.soldPrice)}
                </div>
                {soldOverlay.acquiredVia === "rtm" && (
                  <span className="badge badge-info" style={{ marginTop: 8, fontSize: 14 }}>via RTM</span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Completed */}
      {auctionStatus === "COMPLETED" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <h1 style={{ fontSize: 48, marginBottom: 16 }}>🏆 Auction Complete!</h1>
          <p style={{ fontSize: 18, color: "var(--text-secondary)", marginBottom: 24 }}>
            {stats.totalPlayersSold} players sold · {stats.totalPlayersUnsold} unsold
          </p>
          <button className="btn btn-primary btn-lg" onClick={() => navigate(`/room/${code}/results`)}>
            View Results
          </button>
        </div>
      )}

      {auctionStatus !== "COMPLETED" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
          {/* ─── Main Auction Area ─── */}
          <div>
            {/* Header */}
            <div className="flex-between" style={{ marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 24 }}>Live Auction</h2>
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  Sold: {stats.totalPlayersSold} · Unsold: {stats.totalPlayersUnsold}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {isSpectatorMode && (
                  <span className="badge badge-info" style={{ fontSize: 14, padding: "8px 16px" }}>
                    Spectating
                  </span>
                )}
                {auctionStatus === "PAUSED" && (
                  <span className="badge badge-warning" style={{ fontSize: 14, padding: "8px 16px" }}>PAUSED</span>
                )}
                {isHost && !isSpectatorMode && auctionStatus === "BIDDING" && (
                  <button className="btn btn-outline btn-sm" onClick={handlePause}>Pause</button>
                )}
                {isHost && !isSpectatorMode && auctionStatus === "PAUSED" && (
                  <button className="btn btn-primary btn-sm" onClick={handleResume}>Resume</button>
                )}
              </div>
            </div>

            {/* Current Player + Timer */}
            {currentPlayer && auctionStatus !== "PAUSED" ? (
              <div className="current-player">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ textAlign: "left", flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                      <span
                        className="badge"
                        style={{ background: getRoleColor(currentPlayer.role) + "33", color: getRoleColor(currentPlayer.role) }}
                      >
                        {currentPlayer.role}
                      </span>
                      {currentPlayer.isOverseas && <span className="badge badge-warning">Overseas</span>}
                    </div>
                    <div className="player-name">{currentPlayer.name}</div>
                    <div style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
                      {currentPlayer.nationality}
                      {currentPlayer.battingStyle && ` · ${currentPlayer.battingStyle}`}
                      {currentPlayer.bowlingStyle && ` · ${currentPlayer.bowlingStyle}`}
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                        Base Price: {formatPrice(currentPlayer.basePrice)}
                      </div>
                      <div className="current-bid">{formatPrice(currentBid)}</div>
                      {currentBidTeam && (
                        <div className="bid-team">
                          Highest: {currentBidTeam}
                          {isRtmMatch && (
                            <span className="badge badge-info" style={{ marginLeft: 8, fontSize: 11 }}>RTM Match</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timer */}
                  <div style={{ textAlign: "center" }}>
                    <div className={`timer ${timerClass}`}>{timerRemaining}</div>
                    {auctionStatus === "RTM_PENDING" && (
                      <div className="badge badge-info" style={{ marginTop: 12, fontSize: 13 }}>
                        RTM Decision
                      </div>
                    )}
                  </div>
                </div>

                {/* RTM Panel */}
                {isRtmEligible && (
                  <div style={{
                    marginTop: 20, padding: 16, background: "rgba(59,130,246,0.15)",
                    borderRadius: 8, border: "2px solid var(--accent)",
                  }}>
                    <p style={{ fontWeight: 700, marginBottom: 12 }}>
                      You can use RTM to match {formatPrice(rtmPending?.currentBid)} by {rtmPending?.currentBidTeam}.
                      If you match, other teams may counter-bid.
                    </p>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button className="btn btn-success btn-lg" style={{ flex: 1 }} onClick={() => handleRtm("use")}>
                        Use RTM ({formatPrice(rtmPending?.currentBid)})
                      </button>
                      <button className="btn btn-danger btn-lg" onClick={() => handleRtm("pass")}>
                        Pass
                      </button>
                    </div>
                  </div>
                )}

                {/* Bid Buttons */}
                {canBid && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>Place your bid:</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {bidAmounts.map((amount) => (
                        <button
                          key={amount}
                          className="btn btn-primary"
                          onClick={() => placeBid(amount)}
                          style={{ minWidth: 100 }}
                        >
                          {formatPrice(amount)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isSpectatorMode && (
                  <div style={{ marginTop: 16, color: "var(--text-muted)", fontWeight: 600, textAlign: "center" }}>
                    Spectators enjoy a live view only — join the room to place bids.
                  </div>
                )}

                {/* Why can't bid */}
                {auctionStatus === "BIDDING" && !isSpectatorMode && !canBid && currentBidTeam === user.teamName && (
                  <div style={{ marginTop: 16, color: "var(--success)", fontWeight: 600, textAlign: "center" }}>
                    You have the highest bid!
                  </div>
                )}
              </div>
            ) : auctionStatus === "WAITING" || auctionStatus === "NOMINATING" ? (
              <div className="current-player" style={{ textAlign: "center", padding: 60 }}>
                <p style={{ fontSize: 18, color: "var(--text-secondary)" }}>
                  {auctionStatus === "WAITING" ? "Auction is starting..." : "Selecting next player..."}
                </p>
              </div>
            ) : null}

            {/* Team Purse Overview */}
            <div style={{ marginTop: 20 }}>
              <h3 style={{ marginBottom: 12 }}>Teams</h3>
              <div className="grid-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(200px, 1fr))` }}>
                {teams.map((t) => (
                  <div
                    key={t.teamName}
                    className="card"
                    style={{
                      padding: 14,
                      border:
                        !isSpectatorMode && t.teamName === user.teamName
                          ? "2px solid var(--accent)"
                          : undefined,
                      background: t.teamName === currentBidTeam ? "rgba(34,197,94,0.1)" : undefined,
                    }}
                  >
                    <div className="flex-between" style={{ marginBottom: 6 }}>
                      <strong>{t.teamShortName || t.teamName}</strong>
                      {t.teamName === currentBidTeam && <span className="badge badge-success" style={{ fontSize: 10 }}>Leading</span>}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent)" }}>
                      {formatPrice(t.remainingPurse)}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                      Squad: {t.squadSize ?? t.squad?.length ?? 0} · {t.userName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Side Panel: Chat / Activity / Squads ─── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 80px)" }}>
            <div style={{ display: "flex", borderBottom: "2px solid var(--border)" }}>
              {["chat", "activity", "squads"].map((t) => (
                <button
                  key={t}
                  className="btn"
                  style={{
                    flex: 1,
                    borderRadius: 0,
                    background: tab === t ? "var(--bg-secondary)" : "transparent",
                    color: tab === t ? "var(--accent)" : "var(--text-muted)",
                    fontWeight: tab === t ? 700 : 500,
                    fontSize: 13,
                    padding: "10px",
                    borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflow: "hidden" }}>
              {tab === "chat" && <ChatPanel roomCode={code} readOnly={isSpectatorMode} />}
              {tab === "activity" && <ActivityPanel roomCode={code} />}
              {tab === "squads" && (
                <div style={{ padding: 12, overflowY: "auto", height: "100%" }} className="scrollbar-thin">
                  {teams.map((t) => (
                    <div key={t.teamName} style={{ marginBottom: 16 }}>
                      <h4 style={{ marginBottom: 8 }}>
                        {t.teamShortName} ({t.squad?.length ?? t.squadSize ?? 0} players)
                      </h4>
                      {(t.squad || []).map((s, i) => (
                        <div key={i} style={{ padding: 6, fontSize: 12, background: "var(--bg-card)", borderRadius: 6, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600 }}>Player</span>
                          <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>{s.acquiredFrom}</span>
                          <span style={{ float: "right", color: "var(--success)" }}>{formatPrice(s.price)}</span>
                        </div>
                      ))}
                      {(!t.squad || t.squad.length === 0) && (
                        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No players yet</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
