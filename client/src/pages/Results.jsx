import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Download,
  Trophy,
  Users,
  ArrowLeft,
  Copy,
  Check,
  Swords,
  AlertTriangle,
  Crown,
  Play,
  LoaderCircle,
} from "lucide-react";
import { useSocket } from "../context/SocketContext";
import { useUser } from "../context/UserContext";
import { COLORS, ROLE_COLORS, formatPrice, formatActivity } from "../data/constants";
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { api } from "../services/api";

const XI_SLOT_LABELS = ["Opener", "Opener", "Top Order", "Anchor", "Middle", "Middle", "Finisher", "Utility", "Bowling", "Bowling", "Tail"];

const T = {
  bg: "#080C14",
  card: "#0D1422",
  border: "rgba(255,255,255,0.07)",
  gold: "#F5C842",
  green: "#22C55E",
  blue: "#3B82F6",
  orange: "#F97316",
  red: "#EF4444",
  purple: "#A855F7",
  cyan: "#06B6D4",
  text: "#F1F5F9",
  mid: "#94A3B8",
  dim: "#475569",
  font: "'Inter', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

function xiPositionFactor(player, slotIndex) {
  const role = player?.player?.role || player?.role || "";
  const skills = (player?.player?.skills || player?.skills || []).map((s) =>
    String(s).toLowerCase().replace(/\s+/g, "_")
  );
  const slot = slotIndex + 1;
  if (role === "Bowler") { if (slot >= 8) return 1; if (slot >= 6) return 0.95; return 0.9; }
  if (role === "Wicket-Keeper") { if (slot >= 3 && slot <= 6) return 1; if (slot <= 2 || slot === 7) return 0.9; return 0.75; }
  if (role === "All-Rounder") { if (slot >= 5 && slot <= 8) return 1; if (slot >= 4 && slot <= 9) return 0.9; return 0.75; }
  if (skills.includes("finisher") || skills.includes("power_hitter")) { if (slot >= 5 && slot <= 7) return 1; if (slot >= 4 && slot <= 8) return 0.9; return 0.75; }
  if (skills.includes("middle_order") || skills.includes("anchor")) { if (slot >= 3 && slot <= 5) return 1; if (slot >= 2 && slot <= 6) return 0.9; return 0.75; }
  if (slot <= 3) return 1;
  if (slot <= 4) return 0.9;
  return 0.75;
}

function buildStrengthMap(data) {
  const map = {};
  (data?.teams || data || []).forEach((team) => {
    if (team?.teamName) map[team.teamName] = team;
  });
  return map;
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scoreLine(match) {
  return `${match?.teamA?.name || "Team A"} ${match?.teamA?.score || "-"} vs ${match?.teamB?.name || "Team B"} ${match?.teamB?.score || "-"}`;
}

function matchReportSummary(report) {
  if (!report) return "";
  if (typeof report === "string") return report;
  if (typeof report?.summary === "string") return report.summary;
  return "";
}

function matchHighlights(report) {
  if (!report || typeof report !== "object") return [];
  const batters = Array.isArray(report.standout_batters) ? report.standout_batters : [];
  const bowlers = Array.isArray(report.standout_bowlers) ? report.standout_bowlers : [];
  return [
    ...batters.slice(0, 2).map((item) => `${item.player}: ${item.performance || ""}`.trim()),
    ...bowlers.slice(0, 2).map((item) => `${item.player}: ${item.performance || ""}`.trim()),
  ].filter(Boolean);
}

function renderDismissal(dismissal) {
  if (!dismissal) return "not out";
  return dismissal;
}

function inningsOversFromBatting(batting = []) {
  const balls = batting.reduce((sum, batter) => sum + Number(batter?.balls || 0), 0);
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function stageLabel(stage) {
  return String(stage || "").replaceAll("_", " ").toUpperCase();
}

function ScoreTable({ title, columns, rows, emptyLabel = "No data" }) {
  // columns: [nameCol, subCol?, ...chipCols]
  // For batting: name | dismissal | R | B | SR | 4s | 6s
  // For bowling: name | overs | W | R | Eco | M
  const [nameCol, subCol, ...chipCols] = columns;
  const primaryChip = chipCols[0];   // R for batting, W for bowling
  const secondChip  = chipCols[1];   // B for batting, R for bowling
  const restChips   = chipCols.slice(2);

  return (
    <div style={{ overflow: "hidden" }}>
      {rows.length === 0 ? (
        <div style={{ padding: "10px 0", color: T.dim, fontSize: 11 }}>{emptyLabel}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {rows.map((row, index) => (
            <div key={`${title}-${index}`} style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              borderBottom: index === rows.length - 1 ? "none" : `1px solid rgba(255,255,255,0.05)`,
            }}>
              {/* Left: name + sub */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row[nameCol.key]}
                </div>
                {subCol && row[subCol.key] && (
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row[subCol.key]}
                  </div>
                )}
                {/* secondary chips on new line */}
                {restChips.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
                    {restChips.map(({ key, label }) => row[key] != null && row[key] !== "" && (
                      <span key={key} style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>
                        {label} <span style={{ color: T.mid }}>{row[key]}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Right: primary 2 stats */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                {primaryChip && row[primaryChip.key] != null && (
                  <div style={{ textAlign: "center", minWidth: 32 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 900, color: T.text }}>{row[primaryChip.key]}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>{primaryChip.label}</div>
                  </div>
                )}
                {secondChip && row[secondChip.key] != null && (
                  <div style={{ textAlign: "center", minWidth: 28 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mid }}>{row[secondChip.key]}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>{secondChip.label}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InningsScorecard({ team, opponent, accent }) {
  const [tab, setTab] = useState("bat");

  const battingRows = (team?.batting || []).map((b) => ({
    player: b.player,
    dismissal: renderDismissal(b.dismissal),
    runs: b.runs,
    balls: b.balls,
    strike_rate: b.strike_rate != null ? Number(b.strike_rate).toFixed(1) : null,
    fours: b.fours,
    sixes: b.sixes,
  }));

  const bowlingRows = (opponent?.bowling || []).map((b) => ({
    player: b.player,
    overs: b.overs,
    wickets: b.wickets,
    runs: b.runs,
    economy: b.economy != null ? Number(b.economy).toFixed(2) : null,
    maidens: b.maidens,
  }));

  const overs = inningsOversFromBatting(team?.batting || []);

  return (
    <div style={{ background: `${accent}0C`, border: `1px solid ${accent}30`, borderRadius: 14 }}>
      {/* Team header */}
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${accent}22`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team?.name}</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, marginTop: 1 }}>{overs} ov</div>
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 900, color: accent, flexShrink: 0 }}>{team?.score || "—"}</div>
      </div>

      {/* Bat / Bowl tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        {[{ id: "bat", label: "Batting" }, { id: "bowl", label: "Bowling" }].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: "7px 0", background: "none", border: "none", cursor: "pointer",
            fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: tab === id ? accent : T.dim,
            borderBottom: `2px solid ${tab === id ? accent : "transparent"}`,
            textTransform: "uppercase",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "0 14px 10px" }}>
        {tab === "bat" ? (
          <ScoreTable
            title="Batting"
            columns={[
              { key: "player",      label: "Batter"  },
              { key: "dismissal",   label: ""        },
              { key: "runs",        label: "R"       },
              { key: "balls",       label: "B"       },
              { key: "strike_rate", label: "SR"      },
              { key: "fours",       label: "4s"      },
              { key: "sixes",       label: "6s"      },
            ]}
            rows={battingRows}
          />
        ) : (
          <ScoreTable
            title="Bowling"
            columns={[
              { key: "player",   label: "Bowler" },
              { key: "overs",    label: "O"      },
              { key: "wickets",  label: "W"      },
              { key: "runs",     label: "R"      },
              { key: "economy",  label: "Eco"    },
              { key: "maidens",  label: "M"      },
            ]}
            rows={bowlingRows}
          />
        )}
      </div>
    </div>
  );
}

export default function Results() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { user } = useUser();

  const [state, setState] = useState(null);
  const [room, setRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedTeam, setCopiedTeam] = useState(null);
  const [teamStrengths, setTeamStrengths] = useState({});
  const [strengthLoading, setStrengthLoading] = useState(false);
  const [seasonData, setSeasonData] = useState(null);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [seasonError, setSeasonError] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState("");
  const [selectedMatchKey, setSelectedMatchKey] = useState(null);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [replayEvents, setReplayEvents] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayLoading, setReplayLoading] = useState(false);

  const [xiOpen, setXiOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [capId, setCapId] = useState(null);
  const [vcpId, setVcpId] = useState(null);
  const [xiSaving, setXiSaving] = useState(false);
  const [xiErr, setXiErr] = useState("");
  const [xiFilter, setXiFilter] = useState("ALL");
  const xiHydrated = useRef(false);
  const saveTimerRef = useRef(null);

  const isHost = room?.host?.userId === user.userId;

  const refreshStrengths = useCallback(async () => {
    setStrengthLoading(true);
    try {
      const data = await api.getMatchStrengths(code);
      setTeamStrengths(buildStrengthMap(data));
    } catch (_) {
      // Keep current screen usable even if this request flakes.
    } finally {
      setStrengthLoading(false);
    }
  }, [code]);

  const loadSeasonSimulation = useCallback(async () => {
    setSeasonLoading(true);
    try {
      const data = await api.getSeasonSimulation(code);
      setSeasonData(data);
      setSeasonError("");
    } catch (err) {
      setSeasonData(null);
      setSeasonError(err.message || "Season simulation not available yet");
    } finally {
      setSeasonLoading(false);
    }
  }, [code]);

  const loadReplay = useCallback(async () => {
    setReplayLoading(true);
    try {
      const data = await api.getRoomReplay(code, 600);
      const events = data?.events || [];
      setReplayEvents(events);
      setReplayIndex(events.length ? events.length - 1 : 0);
    } catch (_) {
      setReplayEvents([]);
      setReplayIndex(0);
    } finally {
      setReplayLoading(false);
    }
  }, [code]);

  useEffect(() => {
    let active = true;
    if (!socket) return undefined;

    socket.emit("auction:getState", { roomCode: code }, (res) => {
      if (!active) return;
      setLoading(false);
      if (res?.success) setState(res.state);
    });

    api.getRoom(code).then((data) => {
      if (active) setRoom(data);
    }).catch(() => {});

    refreshStrengths();
    loadSeasonSimulation();
    loadReplay();

    return () => {
      active = false;
    };
  }, [socket, code, refreshStrengths, loadSeasonSimulation, loadReplay]);

  useEffect(() => {
    if (xiHydrated.current || Object.keys(teamStrengths).length === 0) return;
    const myTs = Object.values(teamStrengths).find(
      (team) => team.userName === user.userName || team.teamName === user.teamName
    );
    if (!myTs) return;
    const profiles = myTs.playerProfiles || [];
    if (myTs.savedPlayingXI?.length > 0) {
      const restored = myTs.savedPlayingXI.filter((id) => profiles.some((p) => p.playerId === id));
      if (restored.length > 0) setSelectedIds(restored);
    }
    if (myTs.savedCaptainId) setCapId(myTs.savedCaptainId);
    if (myTs.savedViceCaptainId) setVcpId(myTs.savedViceCaptainId);
    xiHydrated.current = true;
  }, [teamStrengths, user.userName, user.teamName]);

  useEffect(() => {
    if (!socket) return undefined;

    const handleRoomUpdated = (data) => {
      setRoom((prev) => prev ? { ...prev, ...data } : prev);
      if (data?.joinedTeams) {
        setState((prev) => prev ? { ...prev, teams: data.joinedTeams } : prev);
      }
    };

    const handleXIConfirmed = ({ teamName, teamStrength, breakdown }) => {
      setTeamStrengths((prev) => ({
        ...prev,
        [teamName]: {
          ...(prev[teamName] || {}),
          teamName,
          teamStrength: teamStrength ?? prev[teamName]?.teamStrength ?? 0,
          total: teamStrength ?? prev[teamName]?.total ?? 0,
          breakdown: breakdown || prev[teamName]?.breakdown || null,
          xiConfirmed: true,
        },
      }));
    };

    const handleMatchResults = (data) => {
      setSeasonData({
        simulationType: data.simulationType,
        standings: data.standings,
        season: data.season,
        generatedAt: new Date().toISOString(),
      });
      setSeasonError("");
      setSimulating(false);
    };

    socket.on("room:updated", handleRoomUpdated);
    socket.on("match:strengthUpdate", refreshStrengths);
    socket.on("match:xiConfirmed", handleXIConfirmed);
    socket.on("match:results", handleMatchResults);

    return () => {
      socket.off("room:updated", handleRoomUpdated);
      socket.off("match:strengthUpdate", refreshStrengths);
      socket.off("match:xiConfirmed", handleXIConfirmed);
      socket.off("match:results", handleMatchResults);
    };
  }, [socket, refreshStrengths]);

  const myStrengthData = Object.values(teamStrengths).find(
    (team) => team.userName === user.userName || team.teamName === user.teamName
  );
  const myProfiles = myStrengthData?.playerProfiles || [];
  const profileMap = Object.fromEntries(myProfiles.map((player) => [player.playerId, player]));
  const selectedProfiles = selectedIds.map((id) => profileMap[id]).filter(Boolean);
  const overseasInXI = selectedProfiles.filter((player) => player.isOverseas).length;
  const xiRoleCounts = {
    bat: selectedProfiles.filter((player) => player.role === "Batsman").length,
    wk: selectedProfiles.filter((player) => player.role === "Wicket-Keeper").length,
    ar: selectedProfiles.filter((player) => player.role === "All-Rounder").length,
    bowl: selectedProfiles.filter((player) => player.role === "Bowler").length,
  };

  const calcLiveStrength = useCallback(() => {
    if (selectedIds.length === 0) return 0;
    let raw = 0;
    selectedIds.forEach((id, index) => {
      const player = profileMap[id];
      if (!player) return;
      const fp = Number(player.fairPoint || player.overallRating || 10);
      const contextMult = Math.max(0.82, Math.min(1.18, 1 + Number(player.context?.contextModifier || 0) / 50));
      const factor = xiPositionFactor(player, index);
      const leader = id === capId ? 2 : id === vcpId ? 1.5 : 1;
      raw += fp * contextMult * leader * factor;
    });
    const penPct =
      (xiRoleCounts.wk === 0 ? 10 : 0) +
      (xiRoleCounts.bowl === 0 ? 20 : xiRoleCounts.bowl === 1 ? 10 : 0) +
      (xiRoleCounts.ar === 0 ? 5 : 0) +
      (xiRoleCounts.bat === 0 ? 15 : 0) +
      (overseasInXI > 4 ? 20 + (overseasInXI - 4) * 5 : 0);
    const capped = Math.min(penPct, 50);
    return Math.max(0, Math.round(raw * ((100 - capped) / 100) * 10) / 10);
  }, [selectedIds, profileMap, capId, vcpId, xiRoleCounts, overseasInXI]);

  const livePreview = calcLiveStrength();
  const savedPlayingXI = myStrengthData?.savedPlayingXI || [];
  const savedCaptainId = myStrengthData?.savedCaptainId || null;
  const savedViceCaptainId = myStrengthData?.savedViceCaptainId || null;
  const savedStrength = myStrengthData?.teamStrength ?? myStrengthData?.breakdown?.total ?? 0;
  const sameXIAsSaved =
    selectedIds.length === savedPlayingXI.length &&
    selectedIds.every((id, index) => id === savedPlayingXI[index]) &&
    capId === savedCaptainId &&
    vcpId === savedViceCaptainId;
  const displayedStrength = sameXIAsSaved && savedStrength > 0 ? savedStrength : livePreview;
  const displayedStrengthLabel = sameXIAsSaved && savedStrength > 0 ? "Saved Strength" : "Live Preview";

  const toggleXI = useCallback((playerId) => {
    setSelectedIds((prev) => {
      if (prev.includes(playerId)) {
        if (capId === playerId) setCapId(null);
        if (vcpId === playerId) setVcpId(null);
        return prev.filter((id) => id !== playerId);
      }
      if (prev.length >= 11) {
        setXiErr("Playing XI already has 11");
        return prev;
      }
      const player = profileMap[playerId];
      if (player?.isOverseas && overseasInXI >= 4) {
        setXiErr("Max 4 overseas");
        return prev;
      }
      setXiErr("");
      return [...prev, playerId];
    });
  }, [capId, vcpId, profileMap, overseasInXI]);

  const setCaptain = useCallback((playerId) => {
    if (vcpId === playerId) setVcpId(null);
    setCapId((prev) => (prev === playerId ? null : playerId));
  }, [vcpId]);

  const setViceCaptain = useCallback((playerId) => {
    if (capId === playerId) setCapId(null);
    setVcpId((prev) => (prev === playerId ? null : playerId));
  }, [capId]);

  const movePlayer = useCallback((playerId, direction) => {
    setSelectedIds((prev) => {
      const index = prev.indexOf(playerId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const movePlayerTo = useCallback((playerId, targetIndex) => {
    setSelectedIds((prev) => {
      const currentIndex = prev.indexOf(playerId);
      if (currentIndex === -1 || targetIndex < 0 || targetIndex > 10) return prev;
      const next = [...prev];
      next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, playerId);
      return next.slice(0, 11);
    });
  }, []);

  const saveXI = useCallback(async () => {
    if (selectedIds.length !== 11 || !capId || !vcpId || capId === vcpId) return;
    setXiSaving(true);
    setXiErr("");
    try {
      await api.submitPlayingXI(code, {
        userId: user.userId,
        playingXIPlayerIds: selectedIds,
        captainId: capId,
        viceCaptainId: vcpId,
      });
      await refreshStrengths();
    } catch (err) {
      setXiErr(err.message || "Failed to save");
    } finally {
      setXiSaving(false);
    }
  }, [selectedIds, capId, vcpId, code, user.userId, refreshStrengths]);

  useEffect(() => {
    if (!xiHydrated.current) return undefined;
    if (selectedIds.length === 11 && capId && vcpId && capId !== vcpId) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveXI();
      }, 800);
    }
    return () => clearTimeout(saveTimerRef.current);
  }, [selectedIds, capId, vcpId, saveXI]);

  const handleCopyTeam = (team) => {
    const squad = team.squad || [];
    const spent = team.totalPurse - team.remainingPurse;
    const lines = [
      `${team.teamName} (${team.teamShortName})`,
      `Spent: ${formatPrice(spent)} | Remaining: ${formatPrice(team.remainingPurse)}`,
      `Squad: ${squad.length} players`,
      "",
      "# | Player | Role | Price | FP",
    ];
    squad.forEach((entry, index) => {
      lines.push(
        `${index + 1} | ${entry.player?.name || "Unknown"} | ${entry.player?.role || "-"} | ${formatPrice(entry.price || 0)} | ${entry.leaguePlayer?.fairPoint ?? "-"}`
      );
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopiedTeam(team.teamName);
      setTimeout(() => setCopiedTeam(null), 2000);
    });
  };

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleDownload = () => {
    const teamsData = state?.teams || [];
    // Build CSV rows
    const rows = [["Team","Short","Player","Role","Price","Acquired Via","Overseas"]];
    teamsData.forEach((team) => {
      (team.squad || []).forEach((entry) => {
        rows.push([
          team.teamName,
          team.teamShortName || "",
          entry.player?.name || "Unknown",
          entry.player?.role || "",
          entry.price || 0,
          entry.acquiredFrom || "auction",
          entry.isOverseas ? "Yes" : "No",
        ]);
      });
    });
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `auction_results_${code}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ── Print summary ──────────────────────────────────────────────────────────
  const handlePrint = () => { window.print(); };

  const handleCopySummary = async () => {
    const lines = [
      `Auction Room: ${room?.roomName || code}`,
      `League: ${room?.league?.name || room?.league?.code || "IPL"}`,
      `Teams: ${teams.length}`,
      winner ? `Top Team Strength: ${winner.teamName} (${Math.round(winnerStrength?.teamStrength || 0)})` : "",
      mostExpensive ? `Most Expensive: ${mostExpensive.player?.name || "Player"} ${formatPrice(mostExpensive.soldPrice || 0)}` : "",
      seasonData?.generatedAt ? `Season Simulated: ${formatTimestamp(seasonData.generatedAt)}` : "",
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join("\n"));
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 1800);
  };

  const handleSimulate = async () => {
    setSimulationError("");
    setSimulating(true);
    try {
      if (socket) {
        socket.emit("match:simulate", { roomCode: code, userId: user.userId }, async (res) => {
          if (!res?.success) {
            setSimulationError(res?.error || "Simulation failed");
            setSimulating(false);
            return;
          }
          setSeasonData({
            simulationType: res.data?.simulationType,
            standings: res.data?.standings,
            season: res.data?.season,
            generatedAt: new Date().toISOString(),
          });
          await refreshStrengths();
          setSimulating(false);
        });
      } else {
        const data = await api.simulateMatch(code, { userId: user.userId });
        setSeasonData({
          simulationType: data.simulationType,
          standings: data.standings,
          season: data.season,
          generatedAt: new Date().toISOString(),
        });
        await refreshStrengths();
        setSimulating(false);
      }
    } catch (err) {
      setSimulationError(err.message || "Simulation failed");
      setSimulating(false);
    }
  };

  const season = seasonData?.season;
  const seasonMatches = [
    ...(season?.league_stage_matches || []),
    ...(season?.playoffs?.semi_finals || []),
    ...(season?.playoffs?.final ? [season.playoffs.final] : []),
  ];

  useEffect(() => {
    if (!seasonMatches.length) {
      setSelectedMatchKey(null);
      return;
    }
    setSelectedMatchKey((prev) => {
      if (prev && seasonMatches.some((match) => `${match.stage}-${match.match_no}` === prev)) {
        return prev;
      }
      return `${seasonMatches[0].stage}-${seasonMatches[0].match_no}`;
    });
  }, [seasonMatches.length, seasonData?.generatedAt]);

  if (loading) {
    return (
      <div style={{ background: COLORS.bgMain }} className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div
            className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: `${COLORS.primary} transparent ${COLORS.primary} ${COLORS.primary}` }}
          />
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
  const totalSpent = state.totalPurseSpent || teams.reduce((sum, team) => sum + (team.totalPurse - team.remainingPurse), 0);
  const totalPlayersSold = state.totalPlayersSold || soldPlayers.length;
  const mostExpensive = soldPlayers.length > 0
    ? soldPlayers.reduce((max, player) => (player.soldPrice > max.soldPrice ? player : max), soldPlayers[0])
    : null;

  const rankedTeams = Object.keys(teamStrengths).length > 0
    ? [...teams].sort((a, b) => (teamStrengths[b.teamName]?.teamStrength ?? 0) - (teamStrengths[a.teamName]?.teamStrength ?? 0))
    : [...teams];
  const winner = rankedTeams[0];
  const winnerStrength = teamStrengths[winner?.teamName];
  const chartData = teams.map((team) => ({
    name: team.teamShortName || team.teamName?.substring(0, 6) || "?",
    spent: Number((((team.totalPurse - team.remainingPurse) || 0) / 100).toFixed(1)),
    remaining: Number(((team.remainingPurse || 0) / 100).toFixed(1)),
  }));

  const readinessRows = teams.map((team) => {
    const strength = teamStrengths[team.teamName] || {};
    return {
      teamName: team.teamName,
      teamShortName: team.teamShortName,
      userName: team.userName,
      xiConfirmed: Boolean(strength.xiConfirmed),
      savedCount: strength.savedPlayingXI?.length || 0,
      teamStrength: strength.teamStrength ?? strength.total ?? 0,
    };
  });
  const confirmedCount = readinessRows.filter((row) => row.xiConfirmed).length;
  const allTeamsConfirmed = teams.length > 0 && confirmedCount === teams.length;
  const myTeamSnapshot = teams.find((team) => team.userId === user.userId || team.teamName === user.teamName) || null;
  const mySquad = myTeamSnapshot?.squad || [];
  const roleCount = mySquad.reduce((acc, entry) => {
    const role = entry?.player?.role || "Batsman";
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const squadTarget = room?.playersPerTeam || 25;
  const slotsRemaining = Math.max(0, squadTarget - mySquad.length);
  const minimumReserveNeeded = slotsRemaining * 20;
  const myRemainingPurse = myTeamSnapshot?.remainingPurse || 0;
  const budgetRiskLabel = myRemainingPurse < minimumReserveNeeded ? "High Risk" : myRemainingPurse < minimumReserveNeeded * 1.6 ? "Medium Risk" : "Stable";
  const strategyHints = [
    { key: "BAT", label: "Batsman", need: Math.max(0, 3 - (roleCount.Batsman || 0)) },
    { key: "WK", label: "Wicket-Keeper", need: Math.max(0, 1 - (roleCount["Wicket-Keeper"] || 0)) },
    { key: "AR", label: "All-Rounder", need: Math.max(0, 2 - (roleCount["All-Rounder"] || 0)) },
    { key: "BWL", label: "Bowler", need: Math.max(0, 3 - (roleCount.Bowler || 0)) },
  ].filter((item) => item.need > 0);

  const standings = seasonData?.standings || [];
  const simulationLocked = Boolean(season);
  const selectedMatch =
    seasonMatches.find((match) => `${match.stage}-${match.match_no}` === selectedMatchKey) ||
    seasonMatches[0] ||
    null;
  const replayCurrent = replayEvents[Math.min(replayIndex, Math.max(0, replayEvents.length - 1))] || null;

  const rc = (role) => ROLE_COLORS[role] || T.blue;
  const sColor = (value) => value == null ? T.dim : value >= 700 ? T.green : value >= 400 ? T.orange : T.red;

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: T.font, color: T.text }}>
      <div style={{ background: "#060912", borderBottom: `1px solid ${T.border}`, padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/rooms")} style={{ background: "none", border: "none", cursor: "pointer", color: T.mid, padding: 4 }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <span style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: 1 }}>Auction Results</span>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, marginLeft: 8 }}>#{code}</span>
          </div>
          <span style={{ background: `${T.green}22`, color: T.green, border: `1px solid ${T.green}44`, fontFamily: T.mono, fontSize: 9, padding: "2px 8px", borderRadius: 99, letterSpacing: 1 }}>
            COMPLETED
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setXiOpen((prev) => !prev)} style={{ background: xiOpen ? `${T.blue}44` : `${T.blue}22`, color: T.blue, border: `1px solid ${T.blue}44`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <Swords size={14} /> {xiOpen ? "Close XI" : "Select XI"}
          </button>
          <button onClick={handleCopySummary} style={{ background: `${T.cyan}18`, color: T.cyan, border: `1px solid ${T.cyan}44`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            {summaryCopied ? <Check size={14} /> : <Copy size={14} />} {summaryCopied ? "Copied" : "Share Summary"}
          </button>
          <button onClick={handleDownload} style={{ background: `${T.green}18`, color: T.green, border: `1px solid ${T.green}44`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            <Download size={14} /> Export CSV
          </button>
          <button onClick={handlePrint} style={{ background: "rgba(255,255,255,0.06)", color: T.mid, border: `1px solid ${T.border}`, borderRadius: 10, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            🖨 Print
          </button>
        </div>
      </div>

      {xiOpen && myProfiles.length > 0 && (
        <div style={{ background: "#060912", borderBottom: `1px solid ${T.border}`, padding: "16px 20px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase" }}>
                  PLAYING XI - {user.teamName}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mid, marginTop: 2 }}>
                  {selectedIds.length}/11 selected{capId ? " · C ✓" : ""}{vcpId ? " · VC ✓" : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 900, color: displayedStrength >= 700 ? T.green : displayedStrength >= 400 ? T.gold : T.orange }}>
                  {displayedStrength.toFixed(0)} <span style={{ fontSize: 11, fontWeight: 600, color: T.mid }}>pts</span>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>{displayedStrengthLabel}</div>
              </div>
            </div>

            <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 12 }}>
              <div style={{ height: "100%", width: `${Math.min(100, (displayedStrength / 1000) * 100)}%`, borderRadius: 99, transition: "width 0.3s ease", background: displayedStrength >= 700 ? T.green : displayedStrength >= 400 ? T.gold : T.orange }} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              {[
                { label: "BAT", val: xiRoleCounts.bat, c: T.blue },
                { label: "WK", val: xiRoleCounts.wk, c: T.green },
                { label: "AR", val: xiRoleCounts.ar, c: T.purple },
                { label: "BOWL", val: xiRoleCounts.bowl, c: T.orange },
                { label: "OS", val: overseasInXI, c: T.gold },
              ].map(({ label, val, c }) => (
                <span key={label} style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}33`, padding: "2px 8px", borderRadius: 6 }}>
                  {label} {val}
                </span>
              ))}
              {xiSaving && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.blue }}>Saving...</span>}
              {xiErr && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.red }}>{xiErr}</span>}
            </div>

            {selectedIds.length > 0 && (
              <div style={{ marginBottom: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Batting Order / Position</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {selectedIds.map((id, index) => {
                    const player = profileMap[id];
                    if (!player) return null;
                    const factor = xiPositionFactor(player, index);
                    const fp = Math.round(Number(player.fairPoint || player.overallRating || 10));
                    const isCap = capId === id;
                    const isVc = vcpId === id;
                    const color = ROLE_COLORS[player.role] || T.blue;
                    return (
                      <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: factor === 1 ? `${T.green}10` : factor >= 0.9 ? `${T.gold}10` : `${T.red}10`, border: `1px solid ${(factor === 1 ? T.green : factor >= 0.9 ? T.gold : T.red) + "30"}`, borderRadius: 8 }}>
                        <div style={{ width: 22, textAlign: "center", fontFamily: T.mono, fontSize: 10, color: T.text, fontWeight: 800 }}>#{index + 1}</div>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {player.name}
                            {isCap && <span style={{ color: T.gold, fontSize: 8, marginLeft: 4, fontWeight: 900 }}>C</span>}
                            {isVc && <span style={{ color: T.purple, fontSize: 8, marginLeft: 4, fontWeight: 900 }}>VC</span>}
                          </div>
                          <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>
                            {XI_SLOT_LABELS[index]} · {player.role} · FP {Math.round(fp * factor)}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 3 }} onClick={(event) => event.stopPropagation()}>
                          <select value={index} onChange={(event) => movePlayerTo(id, Number(event.target.value))} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: T.text, borderRadius: 5, padding: "1px 3px", fontSize: 9, fontFamily: T.mono }}>
                            {XI_SLOT_LABELS.map((label, optionIndex) => (
                              <option key={optionIndex} value={optionIndex}>#{optionIndex + 1} {label}</option>
                            ))}
                          </select>
                          <button onClick={() => movePlayer(id, -1)} disabled={index === 0} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: index === 0 ? T.dim : T.text, borderRadius: 5, padding: "1px 5px", cursor: index === 0 ? "not-allowed" : "pointer", fontSize: 9 }}>↑</button>
                          <button onClick={() => movePlayer(id, 1)} disabled={index === selectedIds.length - 1} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: index === selectedIds.length - 1 ? T.dim : T.text, borderRadius: 5, padding: "1px 5px", cursor: index === selectedIds.length - 1 ? "not-allowed" : "pointer", fontSize: 9 }}>↓</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {["ALL", "BAT", "WK", "AR", "BWL"].map((filter) => (
                <button key={filter} onClick={() => setXiFilter(filter)} style={{ background: xiFilter === filter ? `${T.blue}22` : "transparent", border: `1px solid ${xiFilter === filter ? T.blue + "55" : T.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: xiFilter === filter ? T.blue : T.dim }}>
                  {filter}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 6, maxHeight: 340, overflowY: "auto" }}>
              {myProfiles.filter((player) => {
                if (xiFilter === "ALL") return true;
                if (xiFilter === "BAT") return player.role === "Batsman";
                if (xiFilter === "WK") return player.role === "Wicket-Keeper";
                if (xiFilter === "AR") return player.role === "All-Rounder";
                if (xiFilter === "BWL") return player.role === "Bowler";
                return true;
              }).map((player) => {
                const isSelected = selectedIds.includes(player.playerId);
                const isCap = capId === player.playerId;
                const isVc = vcpId === player.playerId;
                const color = ROLE_COLORS[player.role] || T.blue;
                const slotIndex = selectedIds.indexOf(player.playerId);
                const fp = Math.round(Number(player.fairPoint || player.overallRating || 10));

                return (
                  <div key={player.playerId} onClick={() => toggleXI(player.playerId)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: isSelected ? (isCap ? `${T.gold}14` : isVc ? `${T.purple}14` : `${T.blue}12`) : T.card, border: `1px solid ${isSelected ? (isCap ? T.gold + "55" : isVc ? T.purple + "55" : T.blue + "44") : T.border}`, borderRadius: 10, cursor: selectedIds.length < 11 || isSelected ? "pointer" : "not-allowed", opacity: !isSelected && selectedIds.length >= 11 ? 0.4 : 1 }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `2px solid ${isSelected ? T.blue : T.dim + "55"}`, background: isSelected ? T.blue : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isSelected && <div style={{ width: 6, height: 6, borderRadius: 2, background: "#fff" }} />}
                    </div>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}22`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 800, fontFamily: T.mono, flexShrink: 0 }}>
                      {player.role?.slice(0, 3).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {player.name}
                        {isCap && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.gold, marginLeft: 4 }}>C</span>}
                        {isVc && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.purple, marginLeft: 4 }}>VC</span>}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>
                        {player.isOverseas ? "OS · " : ""}{formatPrice(player.price || 0)} · FP {fp}{slotIndex >= 0 ? ` · #${slotIndex + 1}` : ""}
                      </div>
                    </div>
                    {isSelected && (
                      <div style={{ display: "flex", gap: 3 }} onClick={(event) => event.stopPropagation()}>
                        <button onClick={() => setCaptain(player.playerId)} style={{ width: 20, height: 20, borderRadius: 4, background: isCap ? T.gold : "rgba(255,255,255,0.06)", border: `1px solid ${isCap ? T.gold + "66" : T.border}`, color: isCap ? "#000" : T.dim, cursor: "pointer", fontFamily: T.mono, fontSize: 8, fontWeight: 900 }}>C</button>
                        <button onClick={() => setViceCaptain(player.playerId)} style={{ width: 20, height: 20, borderRadius: 4, background: isVc ? T.purple : "rgba(255,255,255,0.06)", border: `1px solid ${isVc ? T.purple + "66" : T.border}`, color: isVc ? "#fff" : T.dim, cursor: "pointer", fontFamily: T.mono, fontSize: 8, fontWeight: 900 }}>V</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "16px 18px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                Auction Replay Timeline
              </div>
              <div style={{ fontSize: 12, color: T.mid }}>
                {replayLoading ? "Loading timeline..." : `${replayEvents.length} events captured`}
              </div>
            </div>
            {replayEvents.length > 0 && (
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mid }}>
                Event {Math.min(replayIndex + 1, replayEvents.length)}/{replayEvents.length}
              </div>
            )}
          </div>

          {replayEvents.length > 0 && (
            <>
              <input
                type="range"
                min={0}
                max={Math.max(0, replayEvents.length - 1)}
                value={Math.min(replayIndex, Math.max(0, replayEvents.length - 1))}
                onChange={(e) => setReplayIndex(Number(e.target.value))}
                className="w-full mt-3"
              />
              <div style={{ marginTop: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 5 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.gold }}>{replayCurrent?.type || "EVENT"}</span>
                  <span style={{ fontSize: 10, color: T.dim }}>{formatTimestamp(replayCurrent?.at)}</span>
                </div>
                <div style={{ fontSize: 12, color: T.text }}>
                  {formatActivity({ type: replayCurrent?.type, payload: replayCurrent?.payload || {} })}
                </div>
              </div>
            </>
          )}
        </div>

        {myTeamSnapshot && (
          <div style={{ background: T.card, border: `1px solid ${T.blue}44`, borderRadius: 18, padding: "16px 18px", marginBottom: 18 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
              Team Strategy Assistant
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: T.mid }}>Budget Risk</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: budgetRiskLabel === "High Risk" ? T.red : budgetRiskLabel === "Medium Risk" ? T.orange : T.green }}>
                  {budgetRiskLabel}
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: T.mid }}>Min Purse Needed</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.gold }}>{formatPrice(minimumReserveNeeded)}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: T.mid }}>Best Remaining Roles</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {strategyHints.length ? strategyHints.map((h) => `${h.label} x${h.need}`).join(" · ") : "Core XI balance covered"}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ background: T.card, border: `1px solid ${allTeamsConfirmed ? T.green + "44" : T.border}`, borderRadius: 18, padding: "18px 20px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                League Simulation Control
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: T.text }}>
                {confirmedCount}/{teams.length} teams ready
              </div>
              <div style={{ fontSize: 12, color: T.mid, marginTop: 4 }}>
                Every team must lock a full XI before the Python season simulation can run.
              </div>
            </div>

            {isHost ? (
              <button onClick={handleSimulate} disabled={!allTeamsConfirmed || simulating || simulationLocked} style={{ background: allTeamsConfirmed && !simulating && !simulationLocked ? `linear-gradient(135deg, ${T.gold}, #C9A230)` : "rgba(255,255,255,0.08)", color: allTeamsConfirmed && !simulating && !simulationLocked ? "#000" : T.dim, border: "none", borderRadius: 12, padding: "12px 18px", cursor: allTeamsConfirmed && !simulating && !simulationLocked ? "pointer" : "not-allowed", fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
                {simulating ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                {simulating ? "Simulating League..." : simulationLocked ? "Simulation Locked" : "Simulate League"}
              </button>
            ) : (
              <div style={{ color: T.mid, fontSize: 12 }}>
                {simulationLocked ? "League simulation already completed for this room." : allTeamsConfirmed ? "Waiting for host to simulate the league." : "Waiting for all teams to confirm their XI."}
              </div>
            )}
          </div>

          {(simulationError || (seasonError && !season)) && (
            <div style={{ marginTop: 14, background: `${T.red}12`, border: `1px solid ${T.red}33`, borderRadius: 10, padding: "10px 12px", color: T.red, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle size={14} />
              {simulationError || seasonError}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginTop: 16 }}>
            {readinessRows.map((row) => (
              <div key={row.teamName} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${row.xiConfirmed ? T.green + "44" : T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{row.teamName}</div>
                    <div style={{ fontSize: 10, color: T.mid }}>{row.userName || row.teamShortName}</div>
                  </div>
                  <div style={{ color: row.xiConfirmed ? T.green : T.orange, fontFamily: T.mono, fontSize: 10, fontWeight: 800 }}>
                    {row.xiConfirmed ? "READY" : `${row.savedCount}/11`}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontFamily: T.mono, fontSize: 10, color: T.dim }}>
                  Strength {row.teamStrength ? row.teamStrength.toFixed(0) : "-"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {season && (
          <div style={{ background: `radial-gradient(ellipse at top left, ${T.gold}16 0%, transparent 55%), ${T.card}`, border: `1px solid ${T.gold}44`, borderRadius: 20, padding: "24px 28px", marginBottom: 28, boxShadow: `0 0 60px ${T.gold}18` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ fontSize: 58, lineHeight: 1 }}>🏆</div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.gold, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>League Champion</div>
                <div style={{ fontSize: 34, fontWeight: 900, color: T.text, textTransform: "uppercase", letterSpacing: 1.5 }}>
                  {season.playoffs?.champion || "TBD"}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mid, marginTop: 6 }}>
                  Runner-up: {season.playoffs?.runner_up || "TBD"}
                  {seasonData?.generatedAt ? ` · Simulated ${formatTimestamp(seasonData.generatedAt)}` : ""}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(120px, 1fr))", gap: 10 }}>
                <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>Season Seed</div>
                  <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 800, color: T.gold }}>{season.season_seed ?? "-"}</div>
                </div>
                <div style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>League Matches</div>
                  <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 800, color: T.cyan }}>{season.league_stage_matches?.length || 0}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {winnerStrength && winner && !season && (
          <div style={{ background: `radial-gradient(ellipse at 30% 50%, ${T.gold}18 0%, transparent 60%), ${T.card}`, border: `1px solid ${T.gold}44`, borderRadius: 20, padding: "24px 28px", marginBottom: 28, boxShadow: `0 0 60px ${T.gold}18` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ fontSize: 60, lineHeight: 1 }}>🏆</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.gold, letterSpacing: 3, textTransform: "uppercase", marginBottom: 4 }}>Strongest Squad</div>
                <div style={{ fontSize: 32, fontWeight: 900, color: T.text, textTransform: "uppercase", letterSpacing: 2, lineHeight: 1.1 }}>{winner.teamName}</div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mid, marginTop: 4 }}>{winner.teamShortName} · {(winner.squad || []).length} players</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: T.mono, fontSize: 48, fontWeight: 900, color: T.gold, lineHeight: 1 }}>{winnerStrength.teamStrength?.toFixed(0) ?? "-"}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase" }}>Strength</div>
              </div>
            </div>
          </div>
        )}

        {season && standings.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20, marginBottom: 28 }}>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>Points Table</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {standings.map((row) => (
                  <div key={row.teamName} style={{ display: "grid", gridTemplateColumns: "36px 1fr 48px 48px 48px 60px", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 12, background: row.position <= 4 ? `${T.green}08` : "rgba(255,255,255,0.03)", border: `1px solid ${row.position <= 4 ? T.green + "22" : T.border}` }}>
                    <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 800, color: row.position === 1 ? T.gold : T.mid }}>#{row.position}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{row.teamName}</div>
                      <div style={{ fontSize: 10, color: T.mid }}>{row.userName || row.teamShortName} · {row.venue}</div>
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: T.dim }}>P {row.played}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: T.green }}>W {row.won}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 11, color: T.red }}>L {row.lost}</div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 900, color: T.gold }}>{row.points}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: row.nrr >= 0 ? T.green : T.red }}>{row.nrr >= 0 ? "+" : ""}{row.nrr}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "18px 20px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>Season Awards</div>
                {season.season_awards && [
                  ["Player of League", season.season_awards.player_of_league?.player, T.gold],
                  ["Orange Cap", season.season_awards.orange_cap?.player, T.orange],
                  ["Purple Cap", season.season_awards.purple_cap?.player, T.purple],
                  ["Super Striker", season.season_awards.super_striker?.player, T.cyan],
                ].map(([label, player, color]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 12, color: T.mid }}>{label}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color }}>{player || "-"}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "18px 20px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>Playoffs</div>
                {[...(season.playoffs?.semi_finals || []), ...(season.playoffs?.final ? [season.playoffs.final] : [])].map((match) => (
                  <div key={`${match.stage}-${match.match_no}`} style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}` }}>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, marginBottom: 4 }}>{String(match.stage || "").replaceAll("_", " ").toUpperCase()}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{scoreLine(match)}</div>
                    <div style={{ fontSize: 11, color: T.green, marginTop: 4 }}>Winner: {match.winner}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {rankedTeams.length > 0 && Object.keys(teamStrengths).length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>
              Squad Strength Rankings {strengthLoading ? "· refreshing..." : ""}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rankedTeams.map((team, index) => {
                const strength = teamStrengths[team.teamName];
                const score = strength?.teamStrength ?? 0;
                const maxScore = teamStrengths[rankedTeams[0]?.teamName]?.teamStrength || 100;
                const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
                const color = sColor(score);
                return (
                  <div key={team.teamName} style={{ background: index === 0 ? `${T.gold}0A` : T.card, border: `1px solid ${index === 0 ? T.gold + "44" : T.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: index < 3 ? [`${T.gold}30`, `${T.mid}20`, `${T.orange}20`][index] : `${T.dim}15`, color: index < 3 ? [T.gold, T.mid, T.orange][index] : T.dim, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 12, fontWeight: 900, flexShrink: 0 }}>
                      {index + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{team.teamName}</div>
                      <div style={{ marginTop: 4, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: color, transition: "width 0.8s ease" }} />
                      </div>
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 900, color, flexShrink: 0, minWidth: 48, textAlign: "right" }}>{score.toFixed(0)}</div>
                    <div style={{ color: strength?.xiConfirmed ? T.green : T.orange, fontFamily: T.mono, fontSize: 10, fontWeight: 800 }}>
                      {strength?.xiConfirmed ? "READY" : "PENDING"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 32 }}>
          {[
            { icon: "💰", label: "Total Spent", value: formatPrice(totalSpent), color: T.blue },
            { icon: "🏏", label: "Players Sold", value: String(totalPlayersSold), color: T.green },
            { icon: "⭐", label: "Top Buy", value: mostExpensive ? formatPrice(mostExpensive.soldPrice) : "-", color: T.gold, sub: mostExpensive?.player?.name },
            { icon: "👥", label: "Teams", value: String(teams.length), color: T.purple },
          ].map((item) => (
            <div key={item.label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 18, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 900, color: item.color }}>{item.value}</div>
              {item.sub && <div style={{ fontSize: 9, color: T.mid, marginTop: 2 }}>{item.sub}</div>}
            </div>
          ))}
        </div>

        {mostExpensive && (
          <div style={{ background: `linear-gradient(135deg, ${T.gold}14 0%, ${T.orange}10 100%)`, border: `1px solid ${T.gold}44`, borderRadius: 18, padding: "18px 22px", marginBottom: 28, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", boxShadow: `0 0 40px ${T.gold}10` }}>
            <div style={{ fontSize: 36 }}>👑</div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.gold, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Auction MVP · Costliest Player</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: T.text, letterSpacing: 0.5 }}>{mostExpensive.player?.name || "—"}</div>
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mid, marginTop: 3 }}>
                {mostExpensive.player?.role || "—"} · {mostExpensive.player?.country || "—"}
                {mostExpensive.soldTo ? <span style={{ color: T.gold, marginLeft: 6 }}>→ {mostExpensive.soldTo}</span> : null}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.gold, letterSpacing: 1.5, textTransform: "uppercase" }}>Sold For</div>
              <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 900, color: T.gold, lineHeight: 1.1 }}>{formatPrice(mostExpensive.soldPrice)}</div>
              {mostExpensive.player?.basePrice > 0 && (
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.orange, marginTop: 2 }}>
                  {(mostExpensive.soldPrice / mostExpensive.player.basePrice).toFixed(1)}× base price
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>Squad Analysis</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20, marginBottom: 40 }}>
          {rankedTeams.map((team, index) => {
            const squad = team.squad || [];
            const spent = team.totalPurse - team.remainingPurse;
            const strength = teamStrengths[team.teamName];
            const score = strength?.teamStrength;
            const color = sColor(score);
            const warnings = strength?.validation?.warnings || [];
            const roleCounts = strength?.validation?.roleCounts || {};
            const topPlayers = (strength?.playerProfiles || []).filter((player) => player.overallRating != null).sort((a, b) => b.overallRating - a.overallRating).slice(0, 3);
            const pctSpent = team.totalPurse > 0 ? Math.round((spent / team.totalPurse) * 100) : 0;

            return (
              <div key={team.teamName} style={{ background: T.card, border: `1px solid ${index === 0 && score != null ? T.gold + "55" : T.border}`, borderRadius: 18, overflow: "hidden", boxShadow: index === 0 && score != null ? `0 0 30px ${T.gold}12` : "none" }}>
                <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}20`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, flexShrink: 0 }}>
                    {(team.teamShortName || team.teamName || "?")[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: T.text, textTransform: "uppercase" }}>{team.teamName}</span>
                      {strength?.xiConfirmed && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.green, background: `${T.green}22`, border: `1px solid ${T.green}44`, padding: "1px 6px", borderRadius: 6 }}>XI READY</span>}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mid, marginTop: 2 }}>{squad.length} players · {formatPrice(spent)} spent</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {score != null ? (
                      <>
                        <div style={{ fontFamily: T.mono, fontSize: 22, fontWeight: 900, color }}>{score.toFixed(0)}</div>
                        <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, textTransform: "uppercase", letterSpacing: 1 }}>Strength</div>
                      </>
                    ) : (
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim }}>-</div>
                    )}
                  </div>
                </div>

                {Object.keys(roleCounts).length > 0 && (
                  <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Role Composition</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {Object.entries(roleCounts).map(([role, count]) => (
                        <div key={role} style={{ padding: "3px 9px", borderRadius: 7, background: `${rc(role)}18`, border: `1px solid ${rc(role)}33`, fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: rc(role) }}>
                          {role}: {count}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {warnings.length > 0 && (
                  <div style={{ padding: "10px 18px", borderBottom: `1px solid ${T.border}`, background: `${T.orange}06` }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.orange, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Tactical Gaps</div>
                    {warnings.map((warning, index2) => (
                      <div key={index2} style={{ fontFamily: T.mono, fontSize: 10, color: T.mid, marginBottom: 3 }}>· {warning}</div>
                    ))}
                  </div>
                )}

                <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Key Players</div>
                  {(topPlayers.length > 0 ? topPlayers : squad.slice(0, 3).map((entry) => ({ name: entry.player?.name, role: entry.player?.role, overallRating: entry.price }))).map((player, index2) => (
                    <div key={`${player.name}-${index2}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: rc(player.role), flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.name}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.gold }}>{Math.round(Number(player.overallRating || 0)) || "-"}</span>
                    </div>
                  ))}
                </div>

                <div style={{ padding: "10px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>Purse used</span>
                    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: pctSpent > 90 ? T.red : pctSpent > 70 ? T.orange : T.green }}>{pctSpent}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pctSpent}%`, borderRadius: 99, background: pctSpent > 90 ? T.red : pctSpent > 70 ? T.orange : T.green }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: T.mid }}>Remaining: <span style={{ color: T.gold }}>{formatPrice(team.remainingPurse)}</span></span>
                    <button onClick={(event) => { event.stopPropagation(); handleCopyTeam(team); }} style={{ background: "none", border: "none", cursor: "pointer", color: copiedTeam === team.teamName ? T.green : T.dim, fontFamily: T.mono, fontSize: 9, display: "flex", alignItems: "center", gap: 4 }}>
                      {copiedTeam === team.teamName ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Copy squad</>}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 36 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>Purse Utilization</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T.dim, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, color: T.text, fontFamily: T.mono, fontSize: 11 }} />
              <Bar dataKey="spent" name="Spent (Cr)" fill={T.blue} radius={[4, 4, 0, 0]} />
              <Bar dataKey="remaining" name="Remaining (Cr)" fill={"rgba(59,130,246,0.25)"} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {season && seasonMatches.length > 0 && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "14px 12px", marginBottom: 36 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12, paddingLeft: 2 }}>Full Scorecards</div>

            {/* Match navigator — horizontal scroll strip */}
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 8, paddingBottom: 4, minWidth: "max-content" }}>
                {seasonMatches.map((match) => {
                  const matchKey = `${match.stage}-${match.match_no}`;
                  const active = matchKey === selectedMatchKey;
                  return (
                    <button
                      key={matchKey}
                      onClick={() => setSelectedMatchKey(matchKey)}
                      style={{
                        flexShrink: 0,
                        textAlign: "left",
                        background: active ? `${T.blue}22` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${active ? T.blue + "66" : T.border}`,
                        borderRadius: 12,
                        padding: "8px 12px",
                        cursor: "pointer",
                        minWidth: 140,
                        maxWidth: 180,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontFamily: T.mono, fontSize: 9, color: active ? T.blue : T.dim }}>M{match.match_no}</span>
                        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.mid }}>{stageLabel(match.stage)}</span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 800, color: T.text, lineHeight: 1.3, whiteSpace: "normal" }}>{scoreLine(match)}</div>
                      <div style={{ fontSize: 10, color: T.green, fontWeight: 700, marginTop: 3 }}>{match.winner}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected match detail — full width */}
            {selectedMatch && (
              <div key={`${selectedMatch.stage}-${selectedMatch.match_no}`} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden" }}>

                {/* Match header */}
                <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
                    M{selectedMatch.match_no} · {stageLabel(selectedMatch.stage)}
                    {selectedMatch.venue ? <span style={{ color: T.dim, fontWeight: 400 }}> · {selectedMatch.venue}</span> : null}
                  </div>
                  {/* Team scores side by side */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {selectedMatch.teamA?.name}
                        <span style={{ fontFamily: T.mono, fontSize: 14, color: T.cyan, marginLeft: 8 }}>{selectedMatch.teamA?.score || "—"}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: T.text, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {selectedMatch.teamB?.name}
                        <span style={{ fontFamily: T.mono, fontSize: 14, color: T.purple, marginLeft: 8 }}>{selectedMatch.teamB?.score || "—"}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>WINNER</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: T.green }}>{selectedMatch.winner}</div>
                    </div>
                  </div>
                  {selectedMatch.toss?.winner && (
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, marginTop: 5 }}>
                      Toss: {selectedMatch.toss.winner} chose to {selectedMatch.toss.decision}
                    </div>
                  )}
                </div>

                {/* Quick meta strip */}
                <div style={{ display: "flex", overflowX: "auto", borderBottom: `1px solid ${T.border}`, WebkitOverflowScrolling: "touch" }}>
                  {[
                    selectedMatch.player_of_match?.player ? { label: "⭐ POM", val: selectedMatch.player_of_match.player, color: T.gold } : null,
                    selectedMatch.venue_analysis?.pitch ? { label: "Pitch", val: selectedMatch.venue_analysis.pitch, color: T.cyan } : null,
                    selectedMatch.venue_analysis?.avg_first_innings_runs != null ? { label: "Avg 1st", val: selectedMatch.venue_analysis.avg_first_innings_runs, color: T.text } : null,
                    selectedMatch.venue_analysis?.chase_win_rate != null ? { label: "Chase%", val: `${Math.round(Number(selectedMatch.venue_analysis.chase_win_rate) * 100)}%`, color: T.text } : null,
                  ].filter(Boolean).map(({ label, val, color }) => (
                    <div key={label} style={{ flexShrink: 0, padding: "8px 14px", borderRight: `1px solid ${T.border}` }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim }}>{label}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, color, marginTop: 1, whiteSpace: "nowrap" }}>{val}</div>
                    </div>
                  ))}
                </div>

                <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {matchReportSummary(selectedMatch.final_report) && (
                    <div style={{ fontSize: 11, color: T.mid, lineHeight: 1.6 }}>
                      {matchReportSummary(selectedMatch.final_report)}
                    </div>
                  )}

                  {selectedMatch.key_events?.length > 0 && (
                    <div>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>Key Events</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {selectedMatch.key_events.map((event, index) => (
                          <div key={`${selectedMatch.match_no}-event-${index}`} style={{ background: `${T.orange}10`, border: `1px solid ${T.orange}22`, color: T.orange, borderRadius: 99, padding: "4px 10px", fontSize: 10 }}>
                            {event}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {matchHighlights(selectedMatch.final_report).length > 0 && (
                    <div>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>Standouts</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {matchHighlights(selectedMatch.final_report).map((highlight) => (
                          <div key={highlight} style={{ fontSize: 11, color: T.mid, padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
                            {highlight}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Innings scorecards with internal bat/bowl tabs */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <InningsScorecard team={selectedMatch.teamA} opponent={selectedMatch.teamB} accent={T.cyan} />
                    <InningsScorecard team={selectedMatch.teamB} opponent={selectedMatch.teamA} accent={T.purple} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", paddingBottom: 32 }}>
          <button onClick={() => navigate("/")} style={{ background: T.card, color: T.mid, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 24px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
            ← Home
          </button>
          <button onClick={() => { setXiOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ background: `${T.blue}22`, color: T.blue, border: `1px solid ${T.blue}44`, borderRadius: 12, padding: "10px 24px", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Swords size={16} /> Select Playing XI
          </button>
          {season && (
            <button onClick={() => navigate(`/room/${code}/match`)} style={{ background: `${T.green}20`, color: T.green, border: `1px solid ${T.green}44`, borderRadius: 12, padding: "10px 24px", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
              <Crown size={16} /> Open Match View
            </button>
          )}
          <button onClick={() => navigate("/create")} style={{ background: `linear-gradient(135deg, ${T.gold}, #C9A230)`, color: "#000", border: "none", borderRadius: 12, padding: "10px 24px", cursor: "pointer", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", gap: 8 }}>
            <Trophy size={16} /> Host New Auction
          </button>
        </div>
      </div>
    </div>
  );
}
