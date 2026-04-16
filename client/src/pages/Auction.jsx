import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Gavel, AlertTriangle, TrendingUp, Wallet, Trophy, Pause, Play, ChevronRight, Zap, UserMinus, ChevronDown, Clock, Users, BarChart2, MessageCircle, X, Shield, Flame, Star } from "lucide-react";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { useAudio } from "../context/AudioContext";
import { COLORS, ROLE_COLORS, SET_CONFIG, PHASE_LABELS, PHASE_COLORS, formatPrice, getSetConfig } from "../data/constants";
import ParticleEffect from "../components/ParticleEffect";
import SoundControls from "../components/SoundControls";

// ─── Design tokens ───────────────────────────────────────────────────────────
const T = {
  bgDeep:    "#080C14",
  bgCard:    "#0D1422",
  bgGlass:   "rgba(255,255,255,0.035)",
  bgGlass2:  "rgba(255,255,255,0.06)",
  border:    "rgba(255,255,255,0.07)",
  borderHi:  "rgba(255,255,255,0.14)",
  gold:      "#F5C842",
  goldDim:   "#C9A230",
  green:     "#22C55E",
  greenDim:  "#166534",
  red:       "#EF4444",
  blue:      "#3B82F6",
  blueDim:   "#1D4ED8",
  cyan:      "#06B6D4",
  orange:    "#F97316",
  purple:    "#A855F7",
  text:      "#F1F5F9",
  textMid:   "#94A3B8",
  textDim:   "#475569",
  font:      "'Inter', sans-serif",
  mono:      "'JetBrains Mono', monospace",
};

// Pill badge
const Badge = ({ color = T.blue, children, ...rest }) => (
  <span style={{
    background: `${color}18`, color, border: `1px solid ${color}44`,
    fontFamily: T.mono, fontSize: 10, fontWeight: 700,
    padding: "2px 8px", borderRadius: 99, letterSpacing: 1,
    display: "inline-flex", alignItems: "center", gap: 4,
  }} {...rest}>{children}</span>
);

// Glassy card
const GCard = ({ style, children, glow, ...rest }) => (
  <div style={{
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 16,
    ...(glow ? { boxShadow: `0 0 28px ${glow}22, 0 2px 0 ${glow}33 inset, 0 -1px 0 rgba(0,0,0,0.6) inset` } : { boxShadow: "0 2px 20px rgba(0,0,0,0.4)" }),
    ...style,
  }} {...rest}>{children}</div>
);

// Stat cell
const StatCell = ({ label, val, accent }) => (
  <div style={{ textAlign: "center", padding: "6px 4px" }}>
    <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
    <div style={{ color: accent || T.text, fontFamily: T.mono, fontSize: 13, fontWeight: 700 }}>{val ?? "–"}</div>
  </div>
);

function ProgressBar({ value, max = 100, color, height = 6 }) {
  const pct = Math.max(0, Math.min(100, ((Number(value) || 0) / max) * 100));
  return (
    <div style={{ height, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: color, transition: "width 0.5s ease" }} />
    </div>
  );
}

// Role icon/color helper (abbreviated)
const roleColor = (role) => ROLE_COLORS[role] || T.blue;
const idealPositionLabel = (player) => {
  const skills = (player?.skills || []).map((s) => String(s).toLowerCase().replace(/\s+/g, "_"));
  if (player?.role === "Bowler") return "Bowling #8-11";
  if (skills.includes("opener") || skills.includes("top_order") || skills.includes("powerplay_batter")) return "Opener #1-2";
  if (skills.includes("anchor")) return "One-down #3";
  if (skills.includes("middle_order") || player?.role === "Wicket-Keeper") return "Middle #4-5";
  if (skills.includes("finisher") || skills.includes("power_hitter")) return "Finisher #6-7";
  if (player?.role === "All-Rounder") return "Utility #5-7";
  return "Top order #2-4";
};

function getScoutSignals(player, context = {}) {
  const baseFP = Math.round(Number(player?.fairPoint || 0));
  const basePrice = Number(player?.basePrice || 0);
  const avg = Number(context?.baseStats?.avg || 0);
  const sr = Number(context?.baseStats?.sr || 0);
  const runs = Number(context?.baseStats?.runs || 0);
  const hiddenCount = Number(context?.hiddenTagCount || 0);
  const roleFit = idealPositionLabel(player);
  const valueScore = Math.max(0, Math.min(99, Math.round(baseFP * 2.8 - basePrice * 0.35)));
  const tempoScore = Math.max(0, Math.min(99, Math.round(sr * 0.45)));
  const volumeScore = Math.max(0, Math.min(99, Math.round(runs / 6)));
  const reliabilityScore = Math.max(0, Math.min(99, Math.round(avg * 1.15)));
  const priceBand = basePrice <= 30 ? "Budget" : basePrice <= 100 ? "Mid-range" : "Premium";

  return {
    cards: [
      { label: "Reliability", value: reliabilityScore, tone: reliabilityScore >= 65 ? T.green : reliabilityScore >= 45 ? T.orange : T.red },
      { label: "Tempo", value: tempoScore, tone: tempoScore >= 65 ? T.green : tempoScore >= 45 ? T.orange : T.red },
      { label: "Volume", value: volumeScore, tone: volumeScore >= 65 ? T.green : volumeScore >= 45 ? T.orange : T.red },
      { label: "Auction Value", value: valueScore, tone: valueScore >= 65 ? T.green : valueScore >= 45 ? T.orange : T.red },
    ],
    quickFacts: [
      { label: "Role fit", value: roleFit },
      { label: "Price band", value: priceBand },
      { label: "Base FP", value: `${baseFP || 0}` },
      { label: "Hidden intel", value: hiddenCount > 0 ? `${hiddenCount} locked tags` : "Fully visible" },
    ],
    recommendation:
      valueScore >= 65
        ? "Strong value if your squad needs role fit."
        : valueScore >= 45
          ? "Playable buy if clues match your gaps."
          : "Only worth chasing if context clues fit your build.",
  };
}

const resolvePlayerPhase = (player, currentBidTeam) => {
  if (player?.auctionPhase) return player.auctionPhase;
  return currentBidTeam ? "bid" : "scout";
};

const normalizePlayerName = (name = "") => String(name).trim().toLowerCase().replace(/\s+/g, " ");
const normalizeTeamName = (name = "") => String(name).trim().toLowerCase().replace(/\s+/g, " ");
const resolveCanonicalRoomTeamName = (teamName = "", teams = []) => {
  const normalizedTarget = normalizeTeamName(teamName);
  if (!normalizedTarget) return "";
  const match = (teams || []).find((team) => (
    normalizeTeamName(team?.teamName) === normalizedTarget ||
    normalizeTeamName(team?.teamShortName) === normalizedTarget
  ));
  return match?.teamName || teamName;
};

function parseMatchupLabel(label = "") {
  const runsMatch = /(\d+)r/i.exec(label);
  const wicketsMatch = /(\d+)w/i.exec(label);
  return {
    runs: runsMatch ? Number(runsMatch[1]) : 0,
    wickets: wicketsMatch ? Number(wicketsMatch[1]) : 0,
  };
}

function resolveDisplayBaseStats(context = {}, entity = {}) {
  const contextBase = context?.baseStats || {};
  const stats2026Batting = entity?.stats2026?.batting || {};
  const stats2025Batting = entity?.stats2025?.batting || {};
  const stats2024Batting = entity?.stats2024?.batting || {};
  const legacyStats = entity?.stats || {};

  const avg =
    Number(contextBase?.avg) ||
    Number(stats2026Batting?.average) ||
    Number(stats2025Batting?.average) ||
    Number(stats2024Batting?.average) ||
    Number(legacyStats?.average) ||
    0;

  const sr =
    Number(contextBase?.sr) ||
    Number(stats2026Batting?.strikeRate) ||
    Number(stats2025Batting?.strikeRate) ||
    Number(stats2024Batting?.strikeRate) ||
    Number(legacyStats?.strikeRate) ||
    0;

  const runs =
    Number(contextBase?.runs) ||
    Number(stats2026Batting?.runs) ||
    Number(stats2025Batting?.runs) ||
    Number(stats2024Batting?.runs) ||
    Number(legacyStats?.runs) ||
    0;

  return {
    avg: avg ? Math.round(avg) : 0,
    sr: sr ? Math.round(sr) : 0,
    runs: runs ? Math.round(runs) : 0,
  };
}

function buildSquadMatchupRows(player, myTeam) {
  const squad = myTeam?.squad || [];
  const strengths = player?.context?.matchupStrengths || [];
  const weaknesses = player?.context?.matchupWeaknesses || [];
  const squadNames = squad.map((entry) => ({
    entry,
    name: entry?.player?.name || entry?.name || "",
    normalized: normalizePlayerName(entry?.player?.name || entry?.name || ""),
  }));

  const matched = [];
  for (const item of [...strengths, ...weaknesses]) {
    const normalizedOpponent = normalizePlayerName(item?.opponent || "");
    const squadMatch = squadNames.find((row) => row.normalized === normalizedOpponent);
    if (!squadMatch) continue;
    const parsed = parseMatchupLabel(item.label);
    matched.push({
      name: `${squadMatch.name} ${myTeam?.teamName ? `(${myTeam.teamName})` : ""}`.trim(),
      runs: parsed.runs,
      wickets: parsed.wickets,
      tone: item.tone,
      label: item.label,
      color: item.tone === "good" ? T.green : T.red,
    });
  }

  return matched.slice(0, 3);
}

function buildOpponentMatchupRows(player, teams, myTeam) {
  const opponentTeams = (teams || []).filter((team) => {
    if (!team) return false;
    if (myTeam?.userId && team.userId && team.userId === myTeam.userId) return false;
    if (myTeam?.teamName && team.teamName && team.teamName === myTeam.teamName) return false;
    return true;
  });
  const opponentNames = opponentTeams.flatMap((team) =>
    (team?.squad || []).map((entry) => ({
      name: entry?.player?.name || entry?.name || "",
      normalized: normalizePlayerName(entry?.player?.name || entry?.name || ""),
      teamLabel: team?.teamShortName || team?.teamName || "Opponent",
    }))
  );
  const strengths = player?.context?.matchupStrengths || [];
  const weaknesses = player?.context?.matchupWeaknesses || [];
  const matched = [];

  for (const item of [...strengths, ...weaknesses]) {
    const normalizedOpponent = normalizePlayerName(item?.opponent || "");
    const opponentMatch = opponentNames.find((row) => row.normalized === normalizedOpponent);
    if (!opponentMatch) continue;
    const parsed = parseMatchupLabel(item.label);
    matched.push({
      name: `${opponentMatch.name} (${opponentMatch.teamLabel})`.trim(),
      runs: parsed.runs,
      wickets: parsed.wickets,
      tone: item.tone,
      label: item.label,
      color: item.tone === "good" ? T.green : T.red,
    });
  }

  return matched.slice(0, 4);
}

// ─── Timer Arc SVG ────────────────────────────────────────────────────────────
function TimerArc({ remaining, total, color }) {
  const r = 28, cx = 36, cy = 36, strokeW = 4;
  const circ = 2 * Math.PI * r;
  const pct  = total > 0 ? remaining / total : 0;
  const dash  = circ * pct;
  return (
    <svg width={72} height={72} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.9s linear, stroke 0.5s ease", filter: `drop-shadow(0 0 6px ${color})` }} />
    </svg>
  );
}

// ─── Animated countup bid price ───────────────────────────────────────────
function AnimatedBidPrice({ amount, pulsing, fontSize = 42 }) {
  const displayedRef = useRef(amount);
  const [displayed, setDisplayed] = useState(amount);
  const rafRef     = useRef(null);
  const startTsRef = useRef(null);
  const startValRef = useRef(amount);

  useEffect(() => {
    const target = amount;
    if (displayedRef.current === target) return;
    startValRef.current = displayedRef.current;
    startTsRef.current  = null;
    const duration = 480;
    const animate = (ts) => {
      if (!startTsRef.current) startTsRef.current = ts;
      const progress = Math.min(1, (ts - startTsRef.current) / duration);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const val      = Math.round(startValRef.current + (target - startValRef.current) * eased);
      displayedRef.current = val;
      setDisplayed(val);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [amount]);

  return (
    <span style={{
      fontFamily: T.mono, fontSize, fontWeight: 900, lineHeight: 1,
      color: T.gold,
      textShadow: pulsing ? `0 0 40px ${T.gold}, 0 0 80px ${T.goldDim}` : `0 0 20px ${T.goldDim}55`,
      display: "inline-block",
      transform: pulsing ? "scale(1.08)" : "scale(1)",
      transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), text-shadow 0.3s ease",
    }}>{formatPrice(displayed)}</span>
  );
}

// ─── Full-width timer strip (sits above the hero, avoids image overlap) ──────
function TimerStrip({ remaining, total }) {
  const tColor  = remaining <= 5 ? T.red : remaining <= 10 ? T.orange : T.green;
  const pct     = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const display = String(Math.max(0, Math.min(99, Math.ceil(Number(remaining) || 0)))).padStart(2, "0");
  return (
    <div style={{
      padding: "10px 22px 8px",
      display: "flex", alignItems: "center", gap: 14,
      borderBottom: `1px solid ${T.border}`,
      background: remaining <= 5
        ? `linear-gradient(90deg, ${T.red}12, transparent)`
        : "transparent",
      transition: "background 0.5s ease",
    }}>
      {/* Countdown number */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, flexShrink: 0 }}>
        <span style={{
          fontFamily: T.mono, fontSize: 30, fontWeight: 900, color: tColor, lineHeight: 1,
          textShadow: remaining <= 5 ? `0 0 24px ${tColor}, 0 0 48px ${tColor}88` : "none",
          transition: "color 0.4s ease, text-shadow 0.4s ease",
          minWidth: "1.8ch", textAlign: "right",
        }}>{display}</span>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: `${tColor}88`, letterSpacing: 1, textTransform: "uppercase" }}>sec</span>
      </div>
      {/* Progress bar */}
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 99,
          background: `linear-gradient(90deg, ${tColor}77, ${tColor})`,
          boxShadow: `0 0 10px ${tColor}88`,
          transition: "width 0.9s linear, background 0.5s ease",
        }} />
      </div>
    </div>
  );
}

// ─── Horizontal set progress ──────────────────────────────────────────────
function SetStrip({ setInfo }) {
  if (!setInfo?.sets?.length) return null;
  return (
    <div style={{ background: "#060912", borderBottom: `1px solid ${T.border}`, padding: "8px 16px", overflowX: "auto", display: "flex", alignItems: "center", gap: 6, minHeight: 36 }}>
      {setInfo.sets.map((s, i) => {
        const sc = SET_CONFIG[s.code] || {};
        const active = s.isCurrent, done = s.isCompleted;
        const c = active ? (sc.color || T.blue) : done ? T.green : T.textDim;
        return (
          <div key={s.code} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <div style={{ width: 16, height: 1, background: done ? `${T.green}44` : T.border }} />}
            <div title={sc.name || s.name} style={{
              background: active ? `${c}20` : done ? `${T.green}12` : "transparent",
              border: `1px solid ${active ? c : done ? T.green + "44" : T.border}`,
              color: c, fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              padding: "2px 10px", borderRadius: 99, whiteSpace: "nowrap",
              boxShadow: active ? `0 0 12px ${c}44` : "none",
              transform: active ? "scale(1.08)" : "scale(1)",
              transition: "all 0.3s ease",
            }}>
              {done ? "✓ " : active ? "● " : ""}{sc.short || s.code}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Player card (desktop center) ────────────────────────────────────────────
function PlayerCard({ player, currentBid, currentBidTeam, timerRemaining, timerDuration, isPricePulsing, auctionStatus, user, teams, myTeam, myStrength, onTabChange }) {
  const ctx = player?.context || {};
  const serverPhase = resolvePlayerPhase(player, currentBidTeam);
  const [viewTab, setViewTab] = useState(serverPhase === "revealed" ? "analysis" : serverPhase === "bid" ? "bid" : "scout");
  const analysisPool = (myTeam?.squad || []).map((entry, index) => ({
    id:
      entry?.playerId?.toString?.() ||
      entry?.player?._id?.toString?.() ||
      entry?.leaguePlayer?._id?.toString?.() ||
      `${entry?.name || entry?.player?.name || "player"}-${index}`,
    name: entry?.player?.name || entry?.name || "Unknown Player",
    role: entry?.player?.role || entry?.role || "Batsman",
    fairPoint: Number(entry?.fairPoint || entry?.leaguePlayer?.fairPoint || 0),
    context: entry?.context || entry?.ratingData?.context || entry?.player?.context || entry?.leaguePlayer?.context || null,
    stats: entry?.stats || entry?.leaguePlayer?.stats || null,
    stats2026: entry?.stats2026 || entry?.leaguePlayer?.stats2026 || null,
    stats2024: entry?.stats2024 || entry?.leaguePlayer?.stats2024 || null,
    stats2025: entry?.stats2025 || entry?.leaguePlayer?.stats2025 || null,
    isOverseas: Boolean(entry?.isOverseas || entry?.player?.isOverseas),
  }));
  const analysisUnlocked = analysisPool.length > 0;
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(null);
  const selectedAnalysisPlayer =
    analysisPool.find((row) => row.id === selectedAnalysisId) ||
    analysisPool[0] ||
    { name: player?.name, role: player?.role, fairPoint: player?.fairPoint || 0, context: player?.context || null };
  const analysisCtx =
    selectedAnalysisPlayer?.context?.baseStats
      ? selectedAnalysisPlayer.context
      : selectedAnalysisPlayer?.name === player?.name
        ? (player?.context || selectedAnalysisPlayer?.context || {})
        : (selectedAnalysisPlayer?.context || {});
  const analysisMatchupRows = buildOpponentMatchupRows(selectedAnalysisPlayer, teams, myTeam);
  const analysisWeaknessTags = [
    ...(analysisCtx?.matchupWeaknesses || []).map((item) => item?.label).filter(Boolean),
    ...(analysisCtx?.exactTags || []).filter((tag) => tag?.tone === "bad").map((tag) => tag?.label).filter(Boolean),
    ...(analysisCtx?.clueTags || []),
  ].filter(Boolean).slice(0, 3);
  const hasLiveBid = Boolean(currentBidTeam);
  const displayCtx = viewTab === "analysis" ? analysisCtx : ctx;
  const displayBaseStats =
    viewTab === "analysis"
      ? resolveDisplayBaseStats(displayCtx, selectedAnalysisPlayer)
      : resolveDisplayBaseStats(displayCtx, player);
  const displayFP = viewTab === "analysis" ? Number(selectedAnalysisPlayer?.fairPoint || 0) : Number(player?.fairPoint || 0);
  const displayRole = viewTab === "analysis" ? selectedAnalysisPlayer?.role || player?.role : player?.role;
  const displayContextModifier = viewTab === "analysis" ? Number(displayCtx?.contextModifier || 0) : Number(ctx?.contextModifier || 0);
  const strategyTags = (viewTab === "analysis" ? (displayCtx?.exactTags || []) : []).slice(0, 2);
  const teamHealth = myStrength?.breakdown?.squadHealth || null;
  const scoutSignals = getScoutSignals(player, ctx);
  const stageLabel = viewTab === "analysis" ? "ANALYSIS VIEW" : viewTab === "bid" ? "STAGE 2 · BID" : "STAGE 1 · SCOUT";
  const stageColor = viewTab === "analysis" ? T.green : viewTab === "bid" ? T.orange : T.blue;
  const squadGapNote = myTeam?.teamName ? `${myTeam.teamShortName || myTeam.teamName} can still fix squad gaps before simulation.` : "Use clues to fix squad gaps before simulation.";
  const matchupRows = buildSquadMatchupRows(player, myTeam);

  useEffect(() => {
    if (!analysisPool.length) {
      setSelectedAnalysisId(null);
      return;
    }
    setSelectedAnalysisId((prev) => {
      if (prev && analysisPool.some((row) => row.id === prev)) return prev;
      return analysisPool[0].id;
    });
  }, [analysisPool.length, myTeam?.squad?.length]);

  useEffect(() => {
    if (!hasLiveBid && viewTab === "bid") setViewTab("scout");
  }, [hasLiveBid, viewTab]);

  useEffect(() => {
    if (hasLiveBid && viewTab === "scout") setViewTab("bid");
  }, [hasLiveBid, viewTab]);

  useEffect(() => {
    if (onTabChange) onTabChange(viewTab);
  }, [viewTab, onTabChange]);

  return (
    <GCard glow={roleColor(player.role)} style={{ overflow: "visible" }}>

      {/* ── Timer strip — full-width, no image overlap ── */}
      <TimerStrip remaining={timerRemaining} total={timerDuration} />

      <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
        {[
          { id: "scout", label: "Scout", color: T.blue },
          { id: "bid", label: "Bid", color: T.orange },
          { id: "analysis", label: "Analysis", color: T.green },
        ].map((stage) => (
          (() => {
            const isBidTabLocked = stage.id === "bid" && !hasLiveBid;
            return (
          <div
            key={stage.id}
            onClick={() => !isBidTabLocked && setViewTab(stage.id)}
            style={{
              flex: 1,
              padding: "8px 0",
              textAlign: "center",
              cursor: isBidTabLocked ? "not-allowed" : "pointer",
              opacity: isBidTabLocked ? 0.45 : 1,
              background: viewTab === stage.id ? `${stage.color}16` : "transparent",
              borderBottom: `2px solid ${viewTab === stage.id ? stage.color : "transparent"}`,
              fontFamily: T.mono,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 1,
              color: viewTab === stage.id ? stage.color : T.textDim,
            }}
          >
            {(stage.id === "analysis" && !analysisUnlocked
              ? "ANALYSIS (LOCKED)"
              : stage.id === "bid" && !hasLiveBid
                ? "BID (WAITING)"
                : stage.label).toUpperCase()}
          </div>
            );
          })()
        ))}
      </div>

      {/* ── Hero: profile-focused strip ── */}
      {viewTab === "analysis" ? (
        <div style={{
          borderBottom: `1px solid ${T.border}`,
          padding: "10px 14px",
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 10,
          alignItems: "center",
          background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(59,130,246,0.05))",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.6 }}>LIVE AUCTION NOW</div>
            <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {player?.name || "Awaiting nomination"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.3 }}>CURRENT BID</div>
            <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800, color: T.gold }}>{formatPrice(currentBid || player?.basePrice || 0)}</div>
          </div>
          <div style={{
            background: currentBidTeam ? `${T.green}16` : T.bgGlass,
            border: `1px solid ${currentBidTeam ? T.green + "44" : T.border}`,
            borderRadius: 8,
            padding: "5px 8px",
            minWidth: 86,
            textAlign: "center",
          }}>
            <div style={{ fontFamily: T.mono, fontSize: 7, color: T.textDim, letterSpacing: 1.2 }}>{currentBidTeam ? "LEADING" : "AWAITING"}</div>
            <div style={{ fontFamily: T.font, fontSize: 10, fontWeight: 800, color: currentBidTeam ? T.green : T.textMid, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentBidTeam || "1ST BID"}
            </div>
          </div>
        </div>
      ) : (
      <div style={{
        position: "relative",
        height: 194,
        overflow: "hidden",
        background: `radial-gradient(ellipse at 20% 20%, ${roleColor(player.role)}26 0%, transparent 55%), linear-gradient(135deg, #0B1220 0%, #0D1628 100%)`,
      }}>

        {/* Background glow */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
          background: `radial-gradient(ellipse at 80% 40%, ${roleColor(player.role)}18 0%, transparent 50%)`,
        }} />

        {/* Bottom fade into the bid row below */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 100,
          zIndex: 2, pointerEvents: "none",
          background: `linear-gradient(to top, ${T.bgCard} 0%, transparent 100%)`,
        }} />

        {/* Info: sits over all gradients, left side */}
        <div style={{
          position: "absolute", zIndex: 5,
          left: 0, top: 0, bottom: 0, right: 0,
          padding: "18px 16px 18px 24px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          {/* Badges row */}
          <div style={{ display: "flex", flexWrap: "nowrap", gap: 5, overflow: "hidden" }}>
            <Badge color={roleColor(player.role)}>{player.role}</Badge>
            {player.jerseyNumber && <Badge color={T.textMid}>#{player.jerseyNumber}</Badge>}
            {player.isOverseas && <Badge color={T.orange}>OVERSEAS</Badge>}
            {player.isCapped === false && <Badge color={T.purple}>UNCAPPED</Badge>}
          </div>

          {/* Name + meta */}
          <div>
            <div
              key={player.name}
              style={{
                fontFamily: T.mono, fontWeight: 900, color: T.text,
                fontSize: "clamp(17px, 2vw, 26px)", letterSpacing: 1, lineHeight: 1.1,
                textTransform: "uppercase", marginBottom: 8,
                animation: "nameCinema 380ms cubic-bezier(0.22,1,0.36,1)",
                wordBreak: "break-word", overflowWrap: "break-word",
              }}
            >
              {player.name}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 5 }}>
              <span style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textMid, fontFamily: T.mono, fontSize: 10, padding: "3px 8px", borderRadius: 8 }}>
                {player.nationality}
              </span>
              <span style={{ background: `${T.gold}22`, border: `1px solid ${T.gold}44`, color: T.gold, fontFamily: T.mono, fontSize: 10, padding: "3px 8px", borderRadius: 8 }}>
                Base {formatPrice(player.basePrice)}
              </span>
              {player.fairPoint > 0 && (
                <span style={{ background: `${T.blue}18`, border: `1px solid ${T.blue}33`, color: T.blue, fontFamily: T.mono, fontSize: 10, padding: "3px 8px", borderRadius: 8 }}>
                  FP {player.fairPoint.toFixed(1)}
                </span>
              )}
              {/* ── Historical price anchor ── */}
              {player.previousPrice > 0 && (
                <span style={{ background: `${T.purple}18`, border: `1px solid ${T.purple}33`, color: T.purple, fontFamily: T.mono, fontSize: 10, padding: "3px 8px", borderRadius: 8 }}>
                  Last {formatPrice(player.previousPrice)}
                </span>
              )}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, lineHeight: 1.4 }}>
              {idealPositionLabel(player)}{player.previousTeam ? ` · prev: ${player.previousTeam}` : ""}
            </div>
            {/* ── Bowler quick-stats in hero ── */}
            {(player.role === "Bowler" || player.role === "All-Rounder") && player.context?.baseStats && (() => {
              const bs = player.context.baseStats;
              const wkts = bs.wickets ?? bs.wkts ?? null;
              const econ = bs.economy ?? bs.econ ?? null;
              const spell = bs.bestSpell ?? bs.spell ?? null;
              if (wkts == null && econ == null) return null;
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                  {wkts != null && <span style={{ background: `${T.red}18`, border: `1px solid ${T.red}33`, color: T.red, fontFamily: T.mono, fontSize: 9, padding: "2px 7px", borderRadius: 6 }}>⚡ {wkts} WKTS</span>}
                  {econ != null && <span style={{ background: `${T.orange}18`, border: `1px solid ${T.orange}33`, color: T.orange, fontFamily: T.mono, fontSize: 9, padding: "2px 7px", borderRadius: 6 }}>ECO {Number(econ).toFixed(2)}</span>}
                  {spell && <span style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: T.textMid, fontFamily: T.mono, fontSize: 9, padding: "2px 7px", borderRadius: 6 }}>BEST {spell}</span>}
                </div>
              );
            })()}
          </div>

          {/* Skills */}
          {player.skills?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {player.skills.slice(0, 4).map(s => (
                <span key={s} style={{
                  background: "rgba(255,255,255,0.07)", color: T.textMid,
                  fontSize: 10, padding: "2px 9px", borderRadius: 6,
                  border: `1px solid ${T.border}`,
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>

      </div>
      )}

      {/* ── ANALYSIS VIEW: full-width cricket scouting panel ── */}
      {viewTab === "analysis" ? (
        <div style={{ padding: "0 0 4px" }}>
          {/* Squad selector strip */}
          {analysisPool.length === 0 ? (
            <div style={{ margin: "14px 16px", background: `${T.orange}0E`, border: `1px dashed ${T.orange}44`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>🔒</span>
              <div>
                <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: T.orange }}>Analysis Locked</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginTop: 2 }}>Buy this player to unlock the full scouting report for your squad.</div>
              </div>
            </div>
          ) : (
            <div style={{ borderBottom: `1px solid ${T.border}`, padding: "8px 14px 8px", overflowX: "auto", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, flexShrink: 0, marginRight: 4 }}>YOUR SQUAD</span>
              {analysisPool.map((row) => {
                const rc = ROLE_COLORS[row.role] || T.textMid;
                const isSel = selectedAnalysisId === row.id;
                return (
                  <button key={row.id} onClick={() => setSelectedAnalysisId(row.id)} style={{
                    display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
                    padding: "4px 10px 4px 6px", borderRadius: 20,
                    border: `1px solid ${isSel ? rc + "88" : T.border}`,
                    background: isSel ? `${rc}18` : "rgba(255,255,255,0.03)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: `${rc}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? rc : T.textDim }} />
                    </div>
                    <span style={{ fontFamily: T.font, fontSize: 11, fontWeight: isSel ? 800 : 600, color: isSel ? rc : T.textMid, whiteSpace: "nowrap" }}>
                      {row.name.split(" ").slice(-1)[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Main scouting body */}
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

            {/* ── SCORECARD ROW: stats + FP + context modifier ── */}
            <div style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(245,200,66,0.06) 100%)", border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "9px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: ROLE_COLORS[displayRole] || T.blue }} />
                  <span style={{ fontFamily: T.font, fontSize: 12, fontWeight: 800, color: T.text }}>{selectedAnalysisPlayer?.name || player?.name}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>· {displayRole}</span>
                </div>
                <div style={{ display: "flex", gap: 5 }}>
                  {strategyTags.map((tag) => (
                    <span key={tag.label} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: `${tag.tone === "good" ? T.green : T.red}18`, color: tag.tone === "good" ? T.green : T.red, fontWeight: 700, fontFamily: T.mono }}>
                      {tag.tone === "good" ? "▲" : "▼"} {tag.label}
                    </span>
                  ))}
                </div>
              </div>
              {/* Stats strip */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", padding: "10px 4px 12px" }}>
                {[
                  { label: "AVG", value: displayBaseStats?.avg || "—", accent: T.text },
                  { label: "S/R", value: displayBaseStats?.sr || "—", accent: (displayBaseStats?.sr >= 150 ? T.green : displayBaseStats?.sr >= 120 ? T.orange : T.text) },
                  { label: "RUNS", value: displayBaseStats?.runs || "—", accent: T.text },
                  { label: "FAIR PT", value: Math.round(displayFP) || "—", accent: T.gold },
                  { label: "CONTEXT", value: displayContextModifier >= 0 ? `+${displayContextModifier}` : `${displayContextModifier}`, accent: displayContextModifier > 0 ? T.green : displayContextModifier < 0 ? T.red : T.textDim },
                ].map(({ label, value, accent }) => (
                  <div key={label} style={{ textAlign: "center", padding: "0 4px" }}>
                    <div style={{ fontFamily: T.mono, color: accent, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{value}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1, marginTop: 3, textTransform: "uppercase" }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── TWO-COL: Phase ratings + Spin/Fast ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

              {/* Phase ratings — T20 innings breakdown */}
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>T20 PHASE IMPACT</div>
                {analysisCtx?.phaseRatings ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "Powerplay", overs: "1–6",  value: analysisCtx.phaseRatings.powerplay, color: T.blue,   icon: "⚡" },
                      { label: "Middle",    overs: "7–15", value: analysisCtx.phaseRatings.middle,    color: T.orange, icon: "🎯" },
                      { label: "Death",     overs: "16–20",value: analysisCtx.phaseRatings.death,     color: T.green,  icon: "🔥" },
                    ].map((item) => (
                      <div key={item.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontFamily: T.font, fontSize: 10, color: T.text, fontWeight: 700 }}>{item.icon} {item.label}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim }}>Ov {item.overs}</span>
                            <span style={{ fontFamily: T.mono, fontSize: 11, color: item.color, fontWeight: 800, minWidth: 22, textAlign: "right" }}>{item.value}</span>
                          </div>
                        </div>
                        <div style={{ height: 5, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${item.value}%`, borderRadius: 99, background: item.color, boxShadow: `0 0 6px ${item.color}88`, transition: "width 0.6s ease" }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: T.textDim, fontSize: 11, paddingTop: 4 }}>Phase data not available</div>
                )}
              </div>

              {/* Spin / Fast split */}
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>VS BOWLING TYPE</div>
                {(analysisCtx?.spinProfile?.total || 0) > 0 ? (
                  <>
                    <div style={{ height: 10, borderRadius: 99, overflow: "hidden", display: "flex", marginBottom: 8 }}>
                      <div style={{ width: `${analysisCtx.spinProfile.spinShare || 0}%`, background: T.orange, transition: "width 0.5s ease" }} />
                      <div style={{ flex: 1, background: T.blue }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontFamily: T.mono, fontSize: 9, color: T.orange }}>🌀 Spin {Math.round(analysisCtx.spinProfile.spinShare || 0)}%</span>
                      <span style={{ fontFamily: T.mono, fontSize: 9, color: T.blue }}>🏎 Fast {Math.round(analysisCtx.spinProfile.fastShare || 0)}%</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {[
                        { label: "vs Spin", value: Math.round(Number(analysisCtx.spinProfile.vsSpin || 0)), share: analysisCtx.spinProfile.spinShare || 0, color: T.orange },
                        { label: "vs Fast", value: Math.round(Number(analysisCtx.spinProfile.vsFast || 0)), share: analysisCtx.spinProfile.fastShare || 0, color: T.blue },
                      ].map((row) => (
                        <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontFamily: T.font, fontSize: 10, color: T.textMid, width: 52, flexShrink: 0 }}>{row.label}</span>
                          <div style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${row.share}%`, background: row.color, borderRadius: 99 }} />
                          </div>
                          <span style={{ fontFamily: T.mono, fontSize: 10, color: row.color, minWidth: 28, textAlign: "right", fontWeight: 700 }}>{row.value}r</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                      {[
                        { label: "Spin", ok: (analysisCtx.spinProfile.spinShare || 0) >= 50, color: T.orange },
                        { label: "Fast", ok: (analysisCtx.spinProfile.fastShare || 0) >= 50, color: T.blue },
                      ].map(({ label, ok, color }) => (
                        <div key={label} style={{ background: `${ok ? color : T.red}12`, border: `1px solid ${ok ? color : T.red}30`, borderRadius: 8, padding: "5px 6px", textAlign: "center" }}>
                          <div style={{ fontFamily: T.mono, fontSize: 7, color: T.textDim, marginBottom: 1 }}>{label} profile</div>
                          <div style={{ fontFamily: T.font, fontSize: 11, fontWeight: 800, color: ok ? color : T.red }}>{ok ? "Strong ✓" : "Weak ✗"}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ color: T.textDim, fontSize: 11, paddingTop: 4 }}>No bowling-type split data yet</div>
                )}
              </div>
            </div>

            {/* ── MATCHUP INTEL ── */}
            {(analysisMatchupRows.length > 0 || analysisWeaknessTags.length > 0) && (
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "9px 12px 8px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5 }}>🏏 RIVALRY INTEL · OPPONENT SQUADS</span>
                </div>
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {analysisMatchupRows.length > 0 ? analysisMatchupRows.map((row) => (
                    <div key={`${row.name}-${row.label}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 11, color: T.textMid, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</span>
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <ProgressBar value={Math.min(100, row.runs * 2 || row.wickets * 18)} color={row.color} height={4} />
                      </div>
                      <span style={{ fontFamily: T.mono, fontSize: 10, color: row.color, minWidth: 52, textAlign: "right", fontWeight: 700 }}>
                        {row.runs > 0 ? `${row.runs}r` : ""}{row.wickets > 0 ? ` ${row.wickets}w` : ""}
                      </span>
                    </div>
                  )) : (
                    <div style={{ color: T.textDim, fontSize: 11 }}>No head-to-head data vs opponent squads yet.</div>
                  )}
                  {analysisWeaknessTags.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.2, marginBottom: 6 }}>⚠ WEAKNESS FLAGS</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {analysisWeaknessTags.map((tag) => (
                          <span key={tag} style={{ background: `${T.red}12`, border: `1px solid ${T.red}28`, color: "#FECACA", padding: "3px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── INTEL TAGS (exactTags) + dataSufficiency flag ── */}
            {(analysisCtx?.exactTags || []).length > 0 && (
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5 }}>📋 INTEL TAGS</div>
                  {/* dataSufficiency badge */}
                  {analysisCtx?.dataSufficiency && (
                    <span style={{
                      fontFamily: T.mono, fontSize: 8, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      background: analysisCtx.dataSufficiency === "high" ? `${T.green}18` : analysisCtx.dataSufficiency === "medium" ? `${T.orange}18` : `${T.red}18`,
                      color: analysisCtx.dataSufficiency === "high" ? T.green : analysisCtx.dataSufficiency === "medium" ? T.orange : T.red,
                      border: `1px solid ${analysisCtx.dataSufficiency === "high" ? T.green : analysisCtx.dataSufficiency === "medium" ? T.orange : T.red}44`,
                    }}>
                      {analysisCtx.dataSufficiency === "high" ? "✓ Rich data" : analysisCtx.dataSufficiency === "medium" ? "~ Limited data" : "⚠ Sparse data"}
                    </span>
                  )}
                </div>
                {analysisCtx?.dataSufficiency === "low" && (
                  <div style={{ marginBottom: 8, padding: "6px 10px", background: `${T.orange}12`, border: `1px solid ${T.orange}33`, borderRadius: 8, fontFamily: T.font, fontSize: 10, color: T.orange }}>
                    Insufficient match data — tags below are estimated from limited innings. Treat with caution.
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(analysisCtx.exactTags).map((tag) => (
                    <span key={tag.label} style={{
                      background: `${tag.tone === "good" ? T.green : T.red}14`,
                      border: `1px solid ${tag.tone === "good" ? T.green : T.red}33`,
                      color: tag.tone === "good" ? "#D9F99D" : "#FECACA",
                      padding: "4px 10px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      {tag.tone === "good" ? "✓" : "✗"} {tag.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── SQUAD HEALTH ── */}
            {teamHealth?.metrics?.length > 0 && (
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 10 }}>⚡ YOUR SQUAD HEALTH</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {(teamHealth.metrics || []).slice(0, 4).map((metric) => {
                    const color = metric.value >= 70 ? T.green : metric.value >= 45 ? T.orange : T.red;
                    return (
                      <div key={metric.key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontFamily: T.font, fontSize: 10, color: T.textMid }}>{metric.label}</span>
                          <span style={{ fontFamily: T.mono, fontSize: 10, color, fontWeight: 700 }}>{metric.value}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${metric.value}%`, background: color, borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(teamHealth?.preview?.vsPace != null) && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                    {[
                      { label: "vs Pace",   value: teamHealth.preview.vsPace,      color: T.blue },
                      { label: "Balanced",  value: teamHealth.preview.vsBalanced,  color: T.green },
                      { label: "vs Spin",   value: teamHealth.preview.vsSpin,      color: T.orange },
                    ].map(({ label, value, color }) => (
                      <div key={label} style={{ background: `${color}0E`, border: `1px solid ${color}22`, borderRadius: 9, padding: "7px 4px", textAlign: "center" }}>
                        <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, marginBottom: 2 }}>{label}</div>
                        <div style={{ color, fontFamily: T.mono, fontSize: 15, fontWeight: 900 }}>{Math.round(Number(value) || 0)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      ) : (

      /* ── SCOUT VIEW ── */
      viewTab === "scout" ? (
        <div style={{ padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Two-col: Strategy signals + Squad gap */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

            {/* Strategy signals */}
            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>🔍 STRATEGY SIGNALS</div>
              {/* Visible tags */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                {(ctx?.visibleTags || []).slice(0, 2).map((tag) => (
                  <span key={tag} style={{ background: `${T.blue}18`, border: `1px solid ${T.blue}30`, color: "#CFE2FF", padding: "3px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{tag}</span>
                ))}
              </div>
              {/* Strongest phase highlight */}
              {ctx?.phaseRatings && (() => {
                const phases = [
                  { key: "powerplay", label: "Powerplay", overs: "1–6",  color: T.blue },
                  { key: "middle",    label: "Middle",    overs: "7–15", color: T.orange },
                  { key: "death",     label: "Death",     overs: "16–20",color: T.green },
                ];
                const top = [...phases].sort((a, b) => (ctx.phaseRatings[b.key] || 0) - (ctx.phaseRatings[a.key] || 0))[0];
                return (
                  <div style={{ background: `${top.color}0E`, border: `1px solid ${top.color}28`, borderRadius: 9, padding: "7px 10px" }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, marginBottom: 3 }}>BEST PHASE</div>
                    <div style={{ fontFamily: T.font, fontSize: 12, fontWeight: 800, color: top.color }}>{top.label} <span style={{ fontSize: 9, color: T.textDim }}>(Ov {top.overs})</span></div>
                    <div style={{ marginTop: 5, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${ctx.phaseRatings[top.key]}%`, background: top.color, borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })()}
              {/* Bowler/All-Rounder quick stats in Scout */}
              {(player?.role === "Bowler" || player?.role === "All-Rounder") && ctx?.baseStats && (() => {
                const bs = ctx.baseStats;
                const wkts  = bs.wickets    != null ? bs.wickets    : bs.wkts    ?? null;
                const econ  = bs.economy    != null ? bs.economy    : bs.econ    ?? null;
                const spell = bs.bestSpell  != null ? bs.bestSpell  : bs.spell   ?? null;
                const avg   = bs.bowlingAvg != null ? bs.bowlingAvg : null;
                const items = [
                  wkts  != null ? { label: "WKTS",  val: wkts,              color: T.orange } : null,
                  econ  != null ? { label: "ECON",  val: Number(econ).toFixed(2), color: econ <= 7 ? T.green : econ <= 9 ? T.orange : T.red } : null,
                  spell != null ? { label: "BEST",  val: spell,             color: T.purple } : null,
                  avg   != null ? { label: "AVG",   val: Number(avg).toFixed(1),  color: avg  <= 25 ? T.green : avg <= 35 ? T.orange : T.red } : null,
                ].filter(Boolean);
                if (!items.length) return null;
                return (
                  <div style={{ marginTop: 8, background: `${T.orange}0E`, border: `1px solid ${T.orange}28`, borderRadius: 9, padding: "7px 10px" }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 6 }}>🎯 BOWLING STATS</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {items.map(({ label, val, color }) => (
                        <div key={label} style={{ textAlign: "center", background: `${color}14`, border: `1px solid ${color}28`, borderRadius: 7, padding: "4px 8px", minWidth: 44 }}>
                          <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 900, color }}>{val}</div>
                          <div style={{ fontFamily: T.mono, fontSize: 7, color: T.textDim, marginTop: 1 }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Hidden tag count hint */}
              {(ctx?.hiddenTagCount || 0) > 0 && (
                <div style={{ marginTop: 8, fontFamily: T.mono, fontSize: 9, color: T.textDim }}>
                  🔒 {ctx.hiddenTagCount} more intel tags unlock after buying.
                </div>
              )}
            </div>

            {/* Squad gap checker */}
            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>⚡ YOUR SQUAD FIT</div>
              {(() => {
                const squads = myTeam?.squad || [];
                const roleCounts = squads.reduce((acc, e) => {
                  const r = e?.player?.role || e?.role || "Unknown";
                  acc[r] = (acc[r] || 0) + 1;
                  return acc;
                }, {});
                const playerRole = player?.role || "Batsman";
                const currentCount = roleCounts[playerRole] || 0;
                const ideal = { Batsman: 4, Bowler: 4, "All-Rounder": 2, "WK-Batsman": 1 };
                const idealCount = ideal[playerRole] || 2;
                const isNeeded = currentCount < idealCount;
                const color = isNeeded ? T.green : currentCount >= idealCount + 1 ? T.red : T.orange;
                return (
                  <>
                    <div style={{ background: `${color}0E`, border: `1px solid ${color}28`, borderRadius: 9, padding: "8px 10px", marginBottom: 8 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, marginBottom: 2 }}>{playerRole.toUpperCase()} SLOT</div>
                      <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color }}>
                        {isNeeded ? "Needed ✓" : currentCount >= idealCount + 1 ? "Overstocked ✗" : "Borderline"}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 2 }}>
                        {currentCount}/{idealCount} slots filled
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {Object.entries(roleCounts).slice(0, 3).map(([role, count]) => (
                        <div key={role} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontFamily: T.font, fontSize: 10, color: T.textMid }}>{role}</span>
                          <div style={{ display: "flex", gap: 3 }}>
                            {Array.from({ length: Math.min(count, 5) }).map((_, i) => (
                              <div key={i} style={{ width: 6, height: 6, borderRadius: 2, background: ROLE_COLORS[role] || T.textDim }} />
                            ))}
                          </div>
                        </div>
                      ))}
                      {squads.length === 0 && <div style={{ color: T.textDim, fontSize: 10 }}>No squad built yet</div>}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Recommendation bar */}
          <div style={{ background: `${scoutSignals.cards[3].tone}0C`, border: `1px solid ${scoutSignals.cards[3].tone}28`, borderRadius: 10, padding: "9px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: scoutSignals.cards[3].tone, flexShrink: 0 }} />
            <div style={{ fontFamily: T.font, fontSize: 12, color: T.text, lineHeight: 1.4 }}>{scoutSignals.recommendation}</div>
          </div>
        </div>

      /* ── BID VIEW ── */
      ) : (
        <div style={{ padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Two-col: Clue tags + Matchup vs squad */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>

            {/* Clue tags */}
            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>🔎 INTEL CLUES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(ctx?.visibleTags || []).concat(ctx?.clueTags || []).filter(Boolean).slice(0, 4).map((tag, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: i < (ctx?.visibleTags?.length || 0) ? T.blue : T.orange, flexShrink: 0 }} />
                    <span style={{ fontFamily: T.font, fontSize: 11, color: T.textMid }}>{tag}</span>
                  </div>
                ))}
                {(ctx?.hiddenTagCount || 0) > 0 && (
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 4 }}>
                    🔒 {ctx.hiddenTagCount} tags unlock after buying.
                  </div>
                )}
              </div>
            </div>

            {/* Matchup vs your squad */}
            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>⚔ VS YOUR SQUAD</div>
              {matchupRows.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {matchupRows.slice(0, 3).map((row) => (
                    <div key={`${row.name}-${row.label}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 10, color: T.textMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 10, color: row.color, fontWeight: 700, flexShrink: 0 }}>
                        {row.runs > 0 ? `${row.runs}r` : ""}{row.wickets > 0 ? ` ${row.wickets}w` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: T.textDim, fontSize: 11, lineHeight: 1.5 }}>No head-to-head data with your current squad.</div>
              )}
              {/* Phase best */}
              {ctx?.phaseRatings && (() => {
                const top = Object.entries(ctx.phaseRatings).sort((a, b) => b[1] - a[1])[0];
                const phaseMap = { powerplay: { label: "Powerplay", color: T.blue }, middle: { label: "Middle", color: T.orange }, death: { label: "Death", color: T.green } };
                const ph = phaseMap[top?.[0]] || { label: top?.[0], color: T.blue };
                return (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, marginBottom: 4 }}>BEST PHASE</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${top?.[1] || 0}%`, background: ph.color, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontFamily: T.mono, fontSize: 10, color: ph.color, fontWeight: 800 }}>{ph.label}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )
      )}


      {/* Bid row */}
      <div style={{ padding: "14px 20px 18px", display: "grid", gridTemplateColumns: "1.25fr 0.75fr", alignItems: "center", gap: 14, borderTop: `1px solid ${T.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Current Bid</div>
          <AnimatedBidPrice amount={currentBid} pulsing={isPricePulsing} fontSize={34} />
        </div>

        {/* Leader chip */}
        {currentBidTeam ? (
          <div style={{
            background: `${T.green}15`, border: `1px solid ${T.green}44`,
            borderRadius: 12, padding: "10px 16px", textAlign: "center",
          }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, marginBottom: 2 }}>LEADING</div>
            <div style={{ fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.green, textTransform: "uppercase" }}>{currentBidTeam}</div>
            {auctionStatus === "BIDDING" && currentBidTeam === user.teamName && (
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.green, marginTop: 2 }}>🎯 YOU</div>
            )}
          </div>
        ) : (
          <div style={{ background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 16px", textAlign: "center" }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2 }}>AWAITING</div>
            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.textMid, marginTop: 2 }}>1st BID</div>
          </div>
        )}

      </div>
    </GCard>
  );
}

// ─── Bid Button (big CTA) ────────────────────────────────────────────────────
function BidButton({ amount, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        width: "100%", padding: "16px 0", borderRadius: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#1E293B" : `linear-gradient(135deg, #DC2626 0%, #EF4444 40%, #F97316 100%)`,
        color: disabled ? T.textDim : "#fff",
        fontFamily: T.font, fontSize: 20, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        boxShadow: disabled ? "none" : `0 0 32px rgba(239,68,68,0.5), 0 4px 16px rgba(0,0,0,0.4)`,
        transition: "all 0.2s ease",
        transform: "scale(1)",
      }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.transform = "scale(1.025)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
      onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={e => !disabled && (e.currentTarget.style.transform = "scale(1.025)")}
    >
      <Gavel size={20} />
      BID {formatPrice(amount)}
    </button>
  );
}

// ─── Team card (sidebar) ─────────────────────────────────────────────────────
function TeamRow({ team, isLeading, isMe, isHost, onKick, expandedTeam, setExpandedTeam, strength, onSetXI }) {
  // teamColor: use the team's custom color if set, else fall back to blue/textMid
  const brandColor = team.teamColor && team.teamColor.trim() ? team.teamColor : (isMe ? T.blue : T.textMid);
  const tColor = brandColor;
  const remaining = team.remainingPurse || 0;
  const total = team.totalPurse || 1;
  const pctLeft = (remaining / total) * 100;
  const barColor = pctLeft < 20 ? T.red : pctLeft < 50 ? T.orange : T.green;
  const isExpanded = expandedTeam === team.teamName;
  const squad = team.squad || [];
  const strengthVal = strength?.total ?? strength?.teamStrength ?? strength?.breakdown?.total ?? null;
  const sColor = strengthVal == null ? T.textDim : strengthVal >= 700 ? T.green : strengthVal >= 400 ? T.orange : T.red;
  const warnings = [
    ...(strength?.validation?.warnings || []),
    ...(strength?.breakdown?.warnings || []),
  ].filter(Boolean);
  const squadHealth = strength?.breakdown?.squadHealth;

  return (
    <div style={{
      background: isLeading ? `${T.green}12` : T.bgCard,
      border: `1px solid ${isLeading ? T.green + "44" : T.border}`,
      borderRadius: 12, overflow: "hidden",
      boxShadow: isLeading ? `0 0 16px ${T.green}18` : "none",
      transition: "all 0.3s ease",
    }}>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
          onClick={() => setExpandedTeam(isExpanded ? null : team.teamName)}>
          {/* Avatar */}
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: team.teamLogo ? "transparent" : `${tColor}22`,
            color: tColor, border: `1px solid ${tColor}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: T.font, fontSize: 14, fontWeight: 800,
            overflow: "hidden",
          }}>
            {team.teamLogo
              ? <img src={team.teamLogo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : (team.teamShortName || team.teamName || "?")[0]}
          </div>

          {/* Name + status */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: isLeading ? T.green : T.text, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {team.teamShortName || team.teamName}
            </div>
            {isLeading && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.green, letterSpacing: 1 }}>🏏 LEADING BID</div>}
          </div>

          {/* Purse + squad count + strength */}
          <div style={{ textAlign: "right", marginRight: 4 }}>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.gold, fontWeight: 700 }}>{formatPrice(remaining)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>{team.squadSize ?? squad.length ?? 0} pl</div>
              {strengthVal != null && (
                <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 800, color: sColor }}>⚡{strengthVal.toFixed(0)}</div>
              )}
            </div>
          </div>

          {/* Kick button */}
          {isHost && !isMe && (
            <button onClick={e => { e.stopPropagation(); onKick(team.userId); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: T.red, padding: 4, borderRadius: 6 }}>
              <UserMinus size={13} />
            </button>
          )}
          {/* Set XI button — only own team */}
          {isMe && onSetXI && (
            <button onClick={e => { e.stopPropagation(); onSetXI(); }} style={{
              background: `${T.blue}18`, border: `1px solid ${T.blue}44`,
              borderRadius: 7, padding: "3px 8px", cursor: "pointer",
              fontFamily: T.mono, fontSize: 9, color: T.blue, fontWeight: 700, flexShrink: 0,
            }}>⚡XI</button>
          )}
          <ChevronDown size={13} style={{ color: T.textDim, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "none", flexShrink: 0 }} />
        </div>

        {/* Purse bar */}
        <div style={{ marginTop: 8, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
          <div style={{ height: "100%", width: `${pctLeft}%`, borderRadius: 99, background: barColor, transition: "width 0.6s ease, background 0.4s" }} />
        </div>
        {/* Strength bar (live — updates after each sale) */}
        {strengthVal != null && (
          <div style={{ marginTop: 3, height: 2, borderRadius: 99, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ height: "100%", borderRadius: 99, transition: "width 0.6s ease",
              width: `${Math.min(100, (strengthVal / 1000) * 100)}%`,
              background: sColor,
            }} />
          </div>
        )}
        {/* Key warning badges */}
        {warnings.length > 0 && (
          <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {warnings.slice(0, 2).map((w, i) => (
              <span key={i} style={{ fontFamily: T.mono, fontSize: 8, color: T.orange,
                background: `${T.orange}12`, border: `1px solid ${T.orange}25`,
                borderRadius: 4, padding: "1px 5px",
              }}>⚠ {w}</span>
            ))}
          </div>
        )}
      </div>

      {/* Expanded squad */}
      {isExpanded && (
        <div style={{ borderTop: `1px solid ${T.border}`, background: "#060912", padding: "10px 14px", maxHeight: 180, overflowY: "auto" }}>
          {squadHealth?.metrics?.length > 0 && (
            <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 1.5, marginBottom: 8 }}>SQUAD HEALTH</div>
              {squadHealth.metrics.slice(0, 3).map((metric) => {
                const color = metric.value >= 70 ? T.green : metric.value >= 45 ? T.orange : T.red;
                return (
                  <div key={metric.key} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ color: T.text, fontSize: 10 }}>{metric.label}</span>
                      <span style={{ color, fontFamily: T.mono, fontSize: 9 }}>{metric.value}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ width: `${metric.value}%`, height: "100%", background: color, borderRadius: 999 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {squad.length === 0 ? (
            <p style={{ color: T.textDim, fontSize: 11, textAlign: "center", padding: "8px 0" }}>No players yet</p>
          ) : squad.map((sp, idx) => {
            const pName = sp.player?.name || sp.name || sp.playerName || "Unknown";
            const pRole = sp.player?.role || sp.role || "";
            const pPrice = sp.price ?? sp.amount ?? sp.soldPrice ?? 0;
            const rc = ROLE_COLORS[pRole] || T.textMid;
            return (
              <div key={sp.leaguePlayer || idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: rc, flexShrink: 0 }} />
                <span style={{ fontFamily: T.font, fontSize: 11, color: T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pName}</span>
                {sp.isOverseas && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.orange }}>OS</span>}
                {sp.acquiredFrom === "rtm" && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.blue }}>RTM</span>}
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.gold }}>{formatPrice(pPrice)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chat message ────────────────────────────────────────────────────────────
function ChatMsg({ msg, isMe }) {
  const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div style={{ display: "flex", gap: 10, flexDirection: isMe ? "row-reverse" : "row", alignItems: "flex-end" }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        background: `linear-gradient(135deg, ${T.blue}55, ${T.blueDim}88)`,
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.font, fontSize: 11, fontWeight: 800, flexShrink: 0,
        boxShadow: `0 0 12px ${T.blue}44`,
      }}>
        {(msg.userName || "?")[0]}
      </div>
      <div style={{ maxWidth: 240 }}>
        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginBottom: 3, textAlign: isMe ? "right" : "left" }}>
          {msg.userName || "User"} {time && <span style={{ marginLeft: 6 }}>· {time}</span>}
        </div>
        <div style={{
          background: isMe ? `linear-gradient(135deg, ${T.blue}25, ${T.blueDim}35)` : T.bgGlass2,
          border: `1px solid ${isMe ? T.blue + "44" : T.border}`,
          color: T.text, fontFamily: T.font, fontSize: 12, lineHeight: 1.5,
          padding: "8px 12px", borderRadius: isMe ? "16px 6px 16px 16px" : "6px 16px 16px 16px",
          boxShadow: isMe ? `0 0 18px ${T.blue}22` : "none",
        }}>{msg.message}</div>
      </div>
    </div>
  );
}

// ─── Sold / Unsold overlay ───────────────────────────────────────────────────
function SoldOverlay({ overlay }) {
  if (!overlay) return null;
  const isSold = overlay.type === "sold";
  const color = isSold ? T.green : T.red;
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 20,
      background: "rgba(5,8,18,0.82)", backdropFilter: "blur(12px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: `${color}18`, border: `2px solid ${color}66`,
        borderRadius: 20, padding: "32px 40px", textAlign: "center",
        boxShadow: `0 0 60px ${color}33`, maxWidth: 380, width: "90%",
        animation: "popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <style>{`@keyframes popIn { from { transform: scale(0.7); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>

        <div style={{ fontFamily: T.font, fontSize: 52, fontWeight: 900, color, letterSpacing: 4, textShadow: `0 0 40px ${color}`, lineHeight: 1, marginBottom: 8 }}>
          {isSold ? "SOLD!" : "UNSOLD"}
        </div>
        <div style={{ fontFamily: T.font, fontSize: 18, color: T.text, fontWeight: 700, marginBottom: 12 }}>{overlay.player?.name}</div>
        {isSold && (
          <>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, marginBottom: 4 }}>acquired by</div>
            <div style={{ fontFamily: T.font, fontSize: 22, fontWeight: 900, color: T.blue, textTransform: "uppercase", letterSpacing: 2 }}>{overlay.soldTo}</div>
            <div style={{ fontFamily: T.mono, fontSize: 28, color: T.gold, fontWeight: 900, marginTop: 8, textShadow: `0 0 20px ${T.gold}` }}>{formatPrice(overlay.soldPrice)}</div>
            {overlay.acquiredVia === "rtm" && (
              <Badge color={T.blue} style={{ marginTop: 12, fontSize: 11 }}>via RTM</Badge>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Set transition splash ──────────────────────────────────────────────────
function SetSplash({ transition }) {
  if (!transition) return null;
  const color = PHASE_COLORS[transition.phase] || T.blue;
  const setConf = getSetConfig(transition.setCode || "");
  return (
    <div style={{
      position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)",
      zIndex: 3000, pointerEvents: "none",
      background: `linear-gradient(135deg, rgba(8,12,28,0.97), rgba(13,18,40,0.97))`,
      backdropFilter: "blur(20px)",
      border: `1.5px solid ${color}55`,
      borderRadius: 16, padding: "12px 24px",
      textAlign: "center",
      boxShadow: `0 8px 40px rgba(0,0,0,0.7), 0 0 24px ${color}22`,
      animation: "setSlideDown 0.45s cubic-bezier(0.34,1.56,0.64,1)",
      minWidth: 240, maxWidth: "calc(100vw - 40px)",
    }}>
      <style>{`@keyframes setSlideDown { from { transform:translateX(-50%) translateY(-16px); opacity:0 } to { transform:translateX(-50%) translateY(0); opacity:1 } }`}</style>
      <div style={{ fontFamily: T.mono, fontSize: 9, color, letterSpacing: 3, textTransform: "uppercase", marginBottom: 5 }}>
        {PHASE_LABELS[transition.phase] || "NEXT SET"}
      </div>
      <div style={{ fontFamily: T.font, fontSize: 26, fontWeight: 900, color: T.text, textShadow: `0 0 20px ${color}`, letterSpacing: 2, textTransform: "uppercase", lineHeight: 1 }}>
        {transition.setName}
      </div>
      {setConf.fullName && setConf.fullName !== transition.setName && (
        <div style={{ fontFamily: T.font, fontSize: 11, fontWeight: 600, color, marginTop: 3, opacity: 0.9 }}>{setConf.fullName}</div>
      )}
      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginTop: 5, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <span>{transition.playersInSet} player{transition.playersInSet !== 1 ? "s" : ""} in set</span>
        {transition.isAccelerated && <span style={{ color: T.orange }}>⚡ Accelerated</span>}
      </div>
    </div>
  );
}

// ─── RTM decision overlay ────────────────────────────────────────────────────
function RtmDecisionOverlay({ rtmPending, currentPlayer, onRtm, formatPrice }) {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      zIndex: 26,
      background: "rgba(5,8,18,0.86)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 14,
    }}>
      <div style={{
        width: "min(520px, 100%)",
        background: "linear-gradient(145deg, rgba(20,26,40,0.98), rgba(10,14,24,0.98))",
        border: `1.5px solid ${T.gold}66`,
        borderRadius: 16,
        padding: "18px 16px",
        boxShadow: `0 0 40px ${T.gold}30`,
        textAlign: "center",
      }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${T.gold}22`, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
          <AlertTriangle size={22} color={T.gold} />
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.gold, marginBottom: 6 }}>
          RTM DECISION
        </div>
        <div style={{ fontFamily: T.font, fontSize: 18, fontWeight: 900, color: T.text, lineHeight: 1.25 }}>
          Use RTM for {currentPlayer?.name}?
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textMid, marginTop: 6, marginBottom: 14 }}>
          Match {formatPrice(rtmPending?.currentBid)} to reclaim this player
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={() => onRtm("use")}
            style={{ background: `linear-gradient(135deg, ${T.gold}, ${T.goldDim})`, color: "#000", border: "none", cursor: "pointer", padding: "11px 10px", borderRadius: 10, fontFamily: T.font, fontSize: 13, fontWeight: 900, letterSpacing: 0.8 }}>
            YES · USE RTM
          </button>
          <button onClick={() => onRtm("pass")}
            style={{ background: T.bgGlass2, border: `1px solid ${T.borderHi}`, color: T.text, cursor: "pointer", padding: "11px 10px", borderRadius: 10, fontFamily: T.font, fontSize: 13, fontWeight: 800 }}>
            NO · PASS
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Set players list ─────────────────────────────────────────────────────────
function SetPlayersList({ players, auctionStatus, isHost, currentPhaseColor, currentSetConfig, onNominate }) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState("");
  if (!players.length) return null;

  const filtered = search.trim()
    ? players.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.role?.toLowerCase().includes(search.toLowerCase()))
    : players;

  return (
    <div style={{ marginTop: 20 }}>
      <button onClick={() => setOpen(!open)}
        style={{ background: "none", border: "none", cursor: "pointer", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 0 8px 0" }}>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: currentPhaseColor, letterSpacing: 2, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
          <ChevronRight size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
          {currentSetConfig.short} · {players.filter(p=>p.status==="upcoming").length} upcoming
        </span>
      </button>
      {open && (
        <>
          {/* Search input */}
          <div style={{ marginBottom: 6 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search player or role…"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`,
                borderRadius: 8, padding: "5px 10px", color: T.text, fontFamily: T.font, fontSize: 11,
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {filtered.map(p => {
              const isDone = p.status === "done", isCurr = p.status === "current", isUp = p.status === "upcoming";
              const rc = ROLE_COLORS[p.role] || T.textMid;
              const canNom = isHost && isUp && ["WAITING","NOMINATING","SOLD","UNSOLD"].includes(auctionStatus);
              return (
                <div key={p.leaguePlayerId}
                  onClick={() => canNom && onNominate(p.leaguePlayerId)}
                  style={{
                    background: isCurr ? `${currentPhaseColor}14` : "transparent",
                    border: `1px solid ${isCurr ? currentPhaseColor+"44" : T.border}`,
                    borderRadius: 9, padding: "7px 10px",
                    display: "flex", alignItems: "center", gap: 8,
                    opacity: isDone ? 0.45 : 1, cursor: canNom ? "pointer" : "default",
                  }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: rc, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontFamily: T.font, fontSize: 11, color: isDone ? T.textDim : T.text, fontWeight: 700 }}>{p.name}</span>
                    {isCurr && <span style={{ fontFamily: T.mono, fontSize: 8, color: currentPhaseColor, marginLeft: 6 }}>● LIVE</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {p.isOverseas && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.orange }}>OS</span>}
                    {p.isCapped === false && <span style={{ fontFamily: T.mono, fontSize: 8, color: T.purple }}>UC</span>}
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>{formatPrice(p.basePrice)}</span>
                    {canNom && <Gavel size={9} color={T.blue} />}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ fontFamily: T.font, fontSize: 11, color: T.textDim, textAlign: "center", padding: "10px 0" }}>No players match "{search}"</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE FEED PANEL
// ════════════════════════════════════════════════════════════════════════════
const FEED_STYLES = {
  AUCTION_STARTED:    { icon: "🏁", color: "#3B82F6" },
  PLAYER_NOMINATED:   { icon: "📋", color: "#A78BFA" },
  BID_PLACED:         { icon: "💰", color: "#06B6D4" },
  PLAYER_SOLD:        { icon: "🔨", color: "#22C55E" },
  PLAYER_UNSOLD:      { icon: "❌", color: "#EF4444" },
  RTM_PENDING:        { icon: "🔁", color: "#F59E0B" },
  AUCTION_PAUSED:     { icon: "⏸",  color: "#6B7280" },
  AUCTION_RESUMED:    { icon: "▶️",  color: "#10B981" },
  AUCTION_COMPLETED:  { icon: "🏆", color: "#F59E0B" },
  SET_CHANGED:        { icon: "🔄", color: "#8B5CF6" },
  XI_CONFIRMED:       { icon: "✅", color: "#22C55E" },
  STRENGTH_UPDATED:   { icon: "⚡", color: "#3B82F6" },
  MATCH_SIMULATED:    { icon: "🏏", color: "#F5C842" },
};

function LiveFeedPanel({ events }) {
  const fmtTime = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "8px 14px", borderBottom: `1px solid ${T.border}`, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Live Activity</span>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>{events.length} events</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
        {events.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
            Waiting for activity...
          </div>
        )}
        {events.map((ev, i) => {
          const style = FEED_STYLES[ev.type] || { icon: "•", color: T.textDim };
          const safeMessage = String(ev.message || ev.type || "Activity")
            .replaceAll("undefined", ev.playerName || "Unknown Player")
            .replaceAll("null", ev.playerName || "Unknown Player");
          return (
            <div key={i} style={{
              display: "flex", gap: 8, padding: "7px 10px",
              background: `${style.color}12`, borderRadius: 8,
              borderLeft: `2px solid ${style.color}66`,
              animation: i === 0 ? "slideUp 200ms ease" : "none",
            }}>
              <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>{style.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: T.font, fontSize: 11, color: T.text, lineHeight: 1.4, wordBreak: "break-word" }}>
                  {safeMessage}
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 2 }}>
                  {ev.timestamp ? fmtTime(ev.timestamp) : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// XI SELECT MODAL
// ════════════════════════════════════════════════════════════════════════════
const XI_SLOT_LABELS = ["Opener", "Opener", "Top Order", "Anchor", "Middle", "Middle", "Finisher", "Utility", "Bowling", "Bowling", "Tail"];

function xiPositionFactor(player, slotIndex) {
  const role = player?.player?.role || player?.role || "";
  const skills = (player?.player?.skills || []).map((s) => String(s).toLowerCase().replace(/\s+/g, "_"));
  const slot = slotIndex + 1;

  if (role === "Bowler") {
    if (slot >= 8) return 1;
    if (slot >= 6) return 0.95;
    return 0.9;
  }
  if (role === "Wicket-Keeper") {
    if (slot >= 3 && slot <= 6) return 1;
    if (slot <= 2 || slot === 7) return 0.9;
    return 0.75;
  }
  if (role === "All-Rounder") {
    if (slot >= 5 && slot <= 8) return 1;
    if (slot >= 4 && slot <= 9) return 0.9;
    return 0.75;
  }
  if (skills.includes("finisher") || skills.includes("power_hitter")) {
    if (slot >= 5 && slot <= 7) return 1;
    if (slot >= 4 && slot <= 8) return 0.9;
    return 0.75;
  }
  if (skills.includes("middle_order") || skills.includes("anchor")) {
    if (slot >= 3 && slot <= 5) return 1;
    if (slot >= 2 && slot <= 6) return 0.9;
    return 0.75;
  }
  if (slot <= 3) return 1;
  if (slot <= 4) return 0.9;
  return 0.75;
}

function normalizeAuctionPlayerPayload(playerLike) {
  if (!playerLike) return null;
  const source = playerLike.player && playerLike.player.name ? { ...playerLike.player, ...playerLike } : playerLike;
  return {
    playerId: source.playerId || source._id || source.player?._id,
    leaguePlayerId: source.leaguePlayerId || source.leaguePlayer?._id || source.currentLeaguePlayer,
    name: source.name,
    nationality: source.nationality,
    isOverseas: source.isOverseas,
    isCapped: source.isCapped,
    role: source.role,
    image: source.image,
    skills: source.skills || [],
    basePrice: source.basePrice,
    previousTeam: source.previousTeam,
    fairPoint: source.fairPoint || 0,
    auctionPhase: source.auctionPhase,
    context: source.context || null,
    stats: source.stats,
    stats2026: source.stats2026,
    stats2024: source.stats2024,
    stats2025: source.stats2025,
    battingStyle: source.battingStyle,
    bowlingStyle: source.bowlingStyle,
    jerseyNumber: source.jerseyNumber,
  };
}

function XISelectModal({ team, socket, roomCode, userId, onClose, onStrengthUpdate, strengthData }) {
  const squad = (team?.squad || []).filter((sp) => sp?.player);
  const [selectedIds, setSelectedIds] = useState([]);
  const [cap, setCap] = useState(null);
  const [vcp, setVcp] = useState(null);
  const [filt, setFilt] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const storageKey = `xi-draft:${roomCode}:${team?.teamName || "team"}`;
  const hydratedRef = useRef(false);

  const rowId = (sp, index = 0) =>
    sp?.playerId?.toString?.() ||
    sp?.player?._id?.toString() ||
    (typeof sp?.player === "string" ? sp.player : null) ||
    sp?.leaguePlayer?._id?.toString?.() ||
    (typeof sp?.leaguePlayer === "string" ? sp.leaguePlayer : null) ||
    `${sp?.player?.name || sp?.name || "player"}-${index}`;
  const submitPlayerId = (sp) =>
    sp?.playerId?.toString?.() ||
    sp?.player?._id?.toString() ||
    (typeof sp?.player === "string" ? sp.player : null) ||
    sp?.leaguePlayer?.player?._id?.toString?.() ||
    null;
  const role = (sp) => sp?.player?.role || sp?.role || "";
  const isWK = (r) => r === "Wicket-Keeper";
  const isAR = (r) => r === "All-Rounder";
  const isBat = (r) => r === "Batsman";
  const isBwl = (r) => r === "Bowler";
  const profileMap = Object.fromEntries((strengthData?.playerProfiles || []).map((p) => [p.playerId, p]));
  const squadById = Object.fromEntries(squad.map((sp, index) => [rowId(sp, index), sp]));
  const selectedPlayers = selectedIds.map((id) => squadById[id]).filter(Boolean);
  const captainSubmitId = cap ? submitPlayerId(squadById[cap]) : null;
  const viceCaptainSubmitId = vcp ? submitPlayerId(squadById[vcp]) : null;
  const overseasCount = selectedPlayers.filter((sp) => sp?.player?.isOverseas || sp?.isOverseas).length;
  const roleCounts = {
    bat: selectedPlayers.filter((sp) => isBat(role(sp))).length,
    wk: selectedPlayers.filter((sp) => isWK(role(sp))).length,
    ar: selectedPlayers.filter((sp) => isAR(role(sp))).length,
    bowl: selectedPlayers.filter((sp) => isBwl(role(sp))).length,
  };

  // Dream11-style preview: sum each player's fairPoint (5-100) with C/VC multiplier + position factor
  const previewRaw = selectedPlayers.reduce((sum, sp, index) => {
    const profile = profileMap[submitPlayerId(sp)] || {};
    const fp = Number(profile.fairPoint || profile.overallRating || 10);
    const factor = xiPositionFactor(sp, index);
    const submitId = submitPlayerId(sp);
    const leaderFactor = submitId === captainSubmitId ? 2 : submitId === viceCaptainSubmitId ? 1.5 : 1;
    return sum + (fp * leaderFactor * factor);
  }, 0);
  // Composition penalty %
  const compositionPenaltyPct =
    (roleCounts.wk === 0 ? 10 : 0) +
    (roleCounts.bowl === 0 ? 20 : roleCounts.bowl === 1 ? 10 : 0) +
    (roleCounts.ar === 0 ? 5 : 0) +
    (roleCounts.bat === 0 ? 15 : 0) +
    (overseasCount > 4 ? 20 + (overseasCount - 4) * 5 : 0);
  const cappedPenalty = Math.min(compositionPenaltyPct, 50);
  const compositionFactor = (100 - cappedPenalty) / 100;
  const previewStrength = Math.max(0, Math.round(previewRaw * compositionFactor * 10) / 10);

  const warnings = [
    overseasCount > 4 && `Max 4 overseas players allowed (${overseasCount}/4)`,
    roleCounts.wk < 1 && "Hint: No wicket-keeper selected",
    roleCounts.ar === 0 && "Hint: No all-rounder (-5% penalty)",
    roleCounts.bowl === 0 && "Hint: No bowler (-20% penalty)",
    roleCounts.bat === 0 && "Hint: No batsman (-15% penalty)",
  ].filter(Boolean);

  useEffect(() => {
    if (hydratedRef.current) return;
    const draftRaw = localStorage.getItem(storageKey);
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw);
        if (Array.isArray(draft.selectedIds)) setSelectedIds(draft.selectedIds);
        if (draft.cap) setCap(draft.cap);
        if (draft.vcp) setVcp(draft.vcp);
        hydratedRef.current = true;
        return;
      } catch (_) {}
    }
    if (strengthData && Array.isArray(strengthData.savedPlayingXI) && strengthData.savedPlayingXI.length === 11) {
      const restored = strengthData.savedPlayingXI
        .map((playerId) => {
          const index = squad.findIndex((sp) => submitPlayerId(sp) === playerId);
          return index >= 0 ? rowId(squad[index], index) : null;
        })
        .filter(Boolean);
      if (restored.length === 11) setSelectedIds(restored);
      if (strengthData.savedCaptainId) {
        const capIndex = squad.findIndex((sp) => submitPlayerId(sp) === strengthData.savedCaptainId);
        if (capIndex >= 0) setCap(rowId(squad[capIndex], capIndex));
      }
      if (strengthData.savedViceCaptainId) {
        const vcIndex = squad.findIndex((sp) => submitPlayerId(sp) === strengthData.savedViceCaptainId);
        if (vcIndex >= 0) setVcp(rowId(squad[vcIndex], vcIndex));
      }
    }
    hydratedRef.current = true;
  }, [strengthData, squad, storageKey]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    // Only save draft to localStorage if the user has made meaningful selections
    if (selectedIds.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify({ selectedIds, cap, vcp }));
    }
  }, [selectedIds, cap, vcp, storageKey]);

  const toggle = (sp) => {
    const playerId = rowId(sp);
    if (!playerId) return;
    const isSelected = selectedIds.includes(playerId);
    if (isSelected) {
      setSelectedIds((prev) => prev.filter((id) => id !== playerId));
      if (cap === playerId) setCap(null);
      if (vcp === playerId) setVcp(null);
      setErr("");
      return;
    }
    if (selectedIds.length >= 11) {
      setErr("Playing XI already has 11 players");
      return;
    }
    if ((sp?.player?.isOverseas || sp?.isOverseas) && overseasCount >= 4) {
      setErr("You can only select 4 overseas players in the Playing XI");
      return;
    }
    setErr("");
    setSelectedIds((prev) => [...prev, playerId]);
  };

  const movePlayer = (playerId, direction) => {
    setSelectedIds((prev) => {
      const index = prev.indexOf(playerId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const movePlayerTo = (playerId, targetIndex) => {
    setSelectedIds((prev) => {
      const currentIndex = prev.indexOf(playerId);
      if (currentIndex === -1 || targetIndex < 0 || targetIndex > 10) return prev;
      const next = [...prev];
      next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, playerId);
      return next.slice(0, 11);
    });
  };

  const ROLES = ["ALL", "BAT", "WK", "AR", "BWL"];
  const visible = filt === "ALL" ? squad : squad.filter((sp) => {
    const r = role(sp);
    if (filt === "WK") return isWK(r);
    if (filt === "AR") return isAR(r);
    if (filt === "BAT") return isBat(r);
    if (filt === "BWL") return isBwl(r);
    return true;
  });

  const canSave =
    selectedIds.length === 11 &&
    cap &&
    vcp &&
    cap !== vcp;

  const save = () => {
    if (!canSave || busy) return;
    const submitIds = selectedIds
      .map((id) => submitPlayerId(squadById[id]))
      .filter(Boolean);
    if (submitIds.length !== 11 || !captainSubmitId || !viceCaptainSubmitId) {
      setErr("Some player ids are missing in the squad data. Refresh the room and try again.");
      return;
    }
    setBusy(true);
    setErr("");
    socket.emit("match:submitXI", {
      roomCode,
      userId,
      playingXIPlayerIds: submitIds,
      captainId: captainSubmitId,
      viceCaptainId: viceCaptainSubmitId,
    }, (res) => {
      setBusy(false);
      if (res?.success) {
        // Keep localStorage as backup (backend has the definitive version)
        if (res.data) onStrengthUpdate(res.data);
        onClose();
      } else {
        setErr(res?.error || "Failed to save Playing XI");
      }
    });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "stretch", justifyContent: "flex-end",
    }} onClick={onClose}>
      <div style={{ width: "min(440px, 100vw)", background: T.bgDeep,
        borderLeft: `1px solid ${T.border}`, display: "flex",
        flexDirection: "column", boxShadow: "-24px 0 60px rgba(0,0,0,0.7)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
          background: `${T.blue}0A`,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: T.font, fontSize: 15, fontWeight: 900, color: T.text, textTransform: "uppercase", letterSpacing: 1 }}>Playing XI</div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginTop: 2 }}>
              {team?.teamName} · {selectedIds.length}/11 · {squad.length} in squad
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textDim, padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.05)", flexShrink: 0 }}>
          <div style={{ height: "100%", borderRadius: 99, transition: "width 0.3s ease",
            width: `${(selectedIds.length / 11) * 100}%`,
            background: selectedIds.length === 11 ? T.green : T.blue,
          }} />
        </div>

        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, background: "#07101D" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Live Team Strength</div>
              <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 900, color: previewStrength >= 700 ? T.green : previewStrength >= 400 ? T.gold : T.orange }}>
                {previewStrength.toFixed(0)} <span style={{ fontSize: 12, fontWeight: 600, color: T.textMid }}>pts</span>
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>
                {previewStrength >= 700 ? "🔥 Elite" : previewStrength >= 500 ? "✦ Strong" : previewStrength >= 300 ? "◆ Average" : selectedIds.length > 0 ? "▼ Weak" : ""}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (previewStrength / 1000) * 100)}%`, transition: "width 0.2s ease",
                  background: `linear-gradient(90deg, ${previewStrength >= 700 ? T.green : previewStrength >= 400 ? T.gold : T.orange}, ${T.blue})`,
                }} />
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>OS {overseasCount}/4</span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>BAT {roleCounts.bat}</span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>WK {roleCounts.wk}</span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>AR {roleCounts.ar}</span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>BOWL {roleCounts.bowl}</span>
                {cappedPenalty > 0 && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.red }}>-{cappedPenalty}%</span>}
              </div>
            </div>
          </div>
          {(cap || vcp) && (
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {cap && (
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.gold }}>
                  C: {squadById[cap]?.player?.name || squadById[cap]?.name || "Unknown"} (2x)
                </div>
              )}
              {vcp && (
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.purple }}>
                  VC: {squadById[vcp]?.player?.name || squadById[vcp]?.name || "Unknown"} (1.5x)
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${T.border}`, background: "#060912", flexShrink: 0 }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Batting Order / Position Impact</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto" }}>
            {Array.from({ length: 11 }, (_, index) => {
              const playerId = selectedIds[index];
              const sp = playerId ? squadById[playerId] : null;
              const profile = playerId ? (profileMap[submitPlayerId(squadById[playerId])] || {}) : {};
              const factor = sp ? xiPositionFactor(sp, index) : 0;
              return (
                <div key={index} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  background: sp ? `${factor === 1 ? T.green : factor >= 0.9 ? T.gold : T.red}12` : T.bgCard,
                  border: `1px solid ${sp ? (factor === 1 ? T.green : factor >= 0.9 ? T.gold : T.red) + "33" : T.border}`,
                  borderRadius: 10,
                }}>
                  <div style={{ width: 24, textAlign: "center", fontFamily: T.mono, fontSize: 11, color: T.text, fontWeight: 800 }}>#{index + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: T.font, fontSize: 12, fontWeight: 700, color: sp ? T.text : T.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {sp?.player?.name || "Empty Slot"}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>
                      {XI_SLOT_LABELS[index]}{sp ? ` · ${role(sp)} · FP ${Math.round(Number(profile.fairPoint || profile.overallRating || 10) * factor)}` : ""}
                    </div>
                  </div>
                  {sp && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <select
                        value={index}
                        onChange={(e) => movePlayerTo(playerId, Number(e.target.value))}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: `1px solid ${T.border}`,
                          color: T.text,
                          borderRadius: 6,
                          padding: "2px 4px",
                          fontSize: 10,
                        }}
                      >
                        {XI_SLOT_LABELS.map((_, optionIndex) => (
                          <option key={optionIndex} value={optionIndex}>
                            #{optionIndex + 1}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => movePlayer(playerId, -1)} disabled={index === 0} style={{
                        background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: index === 0 ? T.textDim : T.text,
                        borderRadius: 6, padding: "2px 6px", cursor: index === 0 ? "not-allowed" : "pointer", fontSize: 10,
                      }}>↑</button>
                      <button onClick={() => movePlayer(playerId, 1)} disabled={index === selectedIds.length - 1} style={{
                        background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, color: index === selectedIds.length - 1 ? T.textDim : T.text,
                        borderRadius: 6, padding: "2px 6px", cursor: index === selectedIds.length - 1 ? "not-allowed" : "pointer", fontSize: 10,
                      }}>↓</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Role filter */}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
          {ROLES.map(r => (
            <button key={r} onClick={() => setFilt(r)} style={{
              flex: 1, padding: "9px 4px", background: "none", border: "none",
              cursor: "pointer", fontFamily: T.mono, fontSize: 10, fontWeight: 700,
              letterSpacing: 1, color: filt === r ? T.blue : T.textDim,
              borderBottom: `2px solid ${filt === r ? T.blue : "transparent"}`,
            }}>{r}</button>
          ))}
        </div>

        {/* Player list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
          {visible.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 0", fontFamily: T.mono, fontSize: 11, color: T.textDim }}>
              {squad.length === 0 ? "No players in squad yet" : "No players in this role"}
            </div>
          )}
          {visible.map((sp, i) => {
            const p = rowId(sp, i), isSel = selectedIds.includes(p);
            const isCap = cap === p, isVCap = vcp === p;
            const r = role(sp), rc = ROLE_COLORS[r] || T.textMid;
            const nm = sp?.player?.name || sp?.name || "Player";
            const pr = formatPrice(sp.price || 0);
            const profile = profileMap[submitPlayerId(sp)] || {};
            const slotIndex = selectedIds.indexOf(p);
            const factor = slotIndex >= 0 ? xiPositionFactor(sp, slotIndex) : 1;
            return (
              <button key={p || i} type="button" onClick={() => toggle(sp)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                background: isSel ? (isCap ? `${T.gold}14` : isVCap ? `${T.purple}14` : `${T.blue}12`) : T.bgCard,
                border: `1px solid ${isSel ? (isCap ? T.gold+"55" : isVCap ? T.purple+"55" : T.blue+"44") : T.border}`,
                borderRadius: 12, cursor: selectedIds.length < 11 || isSel ? "pointer" : "not-allowed",
                opacity: !isSel && selectedIds.length >= 11 ? 0.45 : 1,
                transition: "all 0.15s",
                boxShadow: isSel ? `0 0 22px ${isCap ? T.gold : isVCap ? T.purple : T.blue}22` : "none",
                width: "100%",
                textAlign: "left",
              }}>
                {/* Checkbox */}
                <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  border: `2px solid ${isSel ? T.blue : T.textDim+"55"}`,
                  background: isSel ? T.blue : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSel && <div style={{ width: 7, height: 7, borderRadius: 2, background: "#fff" }} />}
                </div>
                {/* Role badge */}
                <div style={{ width: 28, height: 28, borderRadius: 8, background: `${rc}22`, color: rc,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 800, fontFamily: T.mono, flexShrink: 0,
                }}>{r.slice(0,3).toUpperCase()}</div>
                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.font, fontSize: 12, fontWeight: 700, color: T.text,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {nm}
                    {isCap  && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.gold,   marginLeft: 5 }}>C</span>}
                    {isVCap && <span style={{ fontFamily: T.mono, fontSize: 9, color: T.purple, marginLeft: 5 }}>VC</span>}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>
                    {sp?.player?.isOverseas ? "OS " : ""}{pr ? `·${pr}` : ""} · FP {Math.round(Number(profile.fairPoint || profile.overallRating || 10))}
                    {slotIndex >= 0 ? ` · #${slotIndex + 1}` : ""}
                  </div>
                </div>
                {/* C/VC buttons when selected */}
                {isSel && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={e => { e.stopPropagation(); if (vcp === p) setVcp(null); setCap(prev => prev === p ? null : p); }} style={{
                      width: 22, height: 22, borderRadius: 5,
                      background: isCap ? T.gold : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isCap ? T.gold+"66" : T.border}`,
                      color: isCap ? "#000" : T.textDim, cursor: "pointer",
                      fontFamily: T.mono, fontSize: 9, fontWeight: 900,
                    }}>C</button>
                    <button onClick={e => { e.stopPropagation(); if (cap === p) setCap(null); setVcp(prev => prev === p ? null : p); }} style={{
                      width: 22, height: 22, borderRadius: 5,
                      background: isVCap ? T.purple : "rgba(255,255,255,0.06)",
                      border: `1px solid ${isVCap ? T.purple+"66" : T.border}`,
                      color: isVCap ? "#fff" : T.textDim, cursor: "pointer",
                      fontFamily: T.mono, fontSize: 9, fontWeight: 900,
                    }}>V</button>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Composition panel */}
        {selectedIds.length > 0 && (
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`,
            background: "#060912", flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: warnings.length ? 6 : 0 }}>
                {[
                  { label: "Bat", val: roleCounts.bat, min: 3, c: T.blue },
                  { label: "Bowl", val: roleCounts.bowl, min: 3, c: T.orange },
                  { label: "WK", val: roleCounts.wk, min: 1, c: T.green },
                  { label: "AR", val: roleCounts.ar, min: 2, c: T.purple },
                  { label: "OS", val: overseasCount, min: 0, max: 4, c: T.gold },
                  cap && { label: "C", val: (squadById[cap]?.player?.name || squadById[cap]?.name || "?").split(" ").pop(), min:1, c: T.gold },
                  vcp && { label: "VC", val: (squadById[vcp]?.player?.name || squadById[vcp]?.name || "?").split(" ").pop(), min:1, c: T.purple },
                ].filter(Boolean).map(({ label, val, min, c }) => typeof val === "number" ? (
                <div key={label} style={{ padding: "3px 8px", borderRadius: 7,
                  background: label === "OS" ? (val <= 4 ? `${c}18` : `${T.red}18`) : (val >= min ? `${c}18` : `${T.red}18`),
                  border: `1px solid ${label === "OS" ? (val <= 4 ? c+"44" : T.red+"33") : (val >= min ? c+"44" : T.red+"33")}`,
                  fontFamily: T.mono, fontSize: 9, fontWeight: 700,
                  color: label === "OS" ? (val <= 4 ? c : T.red) : (val >= min ? c : T.red),
                }}>{label}: {val}{label === "OS" ? (val > 4 ? " (max 4)" : "✓") : val < min ? ` (${min})` : "✓"}</div>
              ) : (
                <div key={label} style={{ padding: "3px 8px", borderRadius: 7,
                  background: `${c}18`, border: `1px solid ${c}44`,
                  fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: c,
                }}>{label}: {val}</div>
              ))}
            </div>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontFamily: T.mono, fontSize: 9, color: T.orange,
                display: "flex", alignItems: "center", gap: 5, marginTop: 3,
              }}><AlertTriangle size={9}/> {w}</div>
            ))}
          </div>
        )}

        {err && <div style={{ padding: "8px 16px", background: `${T.red}18`,
          borderTop: `1px solid ${T.red}33`, fontFamily: T.mono, fontSize: 11, color: T.red }}>{err}</div>}

        {/* Footer */}
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.border}`, flexShrink: 0, display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px 0",
            background: "rgba(255,255,255,0.04)", border: `1px solid ${T.border}`,
            borderRadius: 12, cursor: "pointer", fontFamily: T.font,
            fontSize: 13, fontWeight: 700, color: T.textMid,
          }}>Cancel</button>
          <button onClick={save} disabled={!canSave || busy} style={{
            flex: 2, padding: "10px 0", border: "none", borderRadius: 12,
            cursor: canSave ? "pointer" : "not-allowed",
            background: canSave && !busy ? `linear-gradient(135deg,${T.blue},${T.blueDim})` : "rgba(255,255,255,0.05)",
            fontFamily: T.font, fontSize: 13, fontWeight: 900,
            color: canSave && !busy ? "#fff" : T.textDim,
            transition: "all 0.2s",
          }}>
            {busy ? "Saving…" : canSave ? "Save Playing XI ✓" : `Select ${selectedIds.length}/11${cap ? " C" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function Auction() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useUser();
  const { socket } = useSocket();
  const [searchParams] = useSearchParams();
  const isSpectatorMode = searchParams.get("spectate") === "1";

  // ── State (all original state preserved) ──────────────────────────────────
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
  const [setInfo, setSetInfo] = useState(null);
  const [playerIndexInSet, setPlayerIndexInSet] = useState(0);
  const [totalPlayersInSet, setTotalPlayersInSet] = useState(0);
  const [setTransition, setSetTransition] = useState(null);
  const [setPoolPlayers, setSetPoolPlayers] = useState([]);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [showParticles, setShowParticles] = useState(false);
  const [particleColor, setParticleColor] = useState("#22C55E");
  const [timerConfig, setTimerConfig] = useState(15);
  const [showTimerConfig, setShowTimerConfig] = useState(false);
  const [mobileTab, setMobileTab] = useState("auction");
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [feedEvents, setFeedEvents] = useState([]);
  const [rightTab, setRightTab] = useState("chat"); // "chat" | "feed"
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(false);
  const [bidLadder, setBidLadder] = useState([]);
  const [teamStrengths, setTeamStrengths] = useState({}); // teamName → strength data
  const [playerCardTab, setPlayerCardTab] = useState("scout");
  const [mobileAnalysisPlayerId, setMobileAnalysisPlayerId] = useState(null);
  const [mobileAnalysisRoleFilter, setMobileAnalysisRoleFilter] = useState("all");
  const [xiModal, setXiModal] = useState(false);  // open XI selector for own team
  const [chatInput, setChatInput] = useState("");
  const [timerDuration, setTimerDuration] = useState(15);
  const [showSoundPanel, setShowSoundPanel] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  // ── New feature states (Phase 6) ─────────────────────────────────────────
  const [commentaryBanner, setCommentaryBanner] = useState(null); // { playerName, amount, teamName }
  const [reconnectToast, setReconnectToast] = useState(null);     // { teamName, roomCode }
  const [purseSummary, setPurseSummary] = useState([]);           // from recalculateAfterSale

  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const timerEndRef = useRef(null);
  const prevTimerSecRef = useRef(-1);
  const auctionStatusRef = useRef("WAITING");
  const chatVisibleRef = useRef(true); // tracks if chat panel is currently open
  const joinTimeRef = useRef(Date.now()); // used to suppress first-join reconnect toast

  useEffect(() => {
    auctionStatusRef.current = auctionStatus;
  }, [auctionStatus]);

  const calculateMinBid = useCallback((bid) => {
    const v = Number(bid) || 0;
    if (v < 100) return v + 10;
    if (v < 500) return v + 25;
    return v + 100;
  }, []);

  const { playTimerTick, playTimerAlert, playBidSound, playSoldMusic, playUnsoldSound, playRtmSound } = useAudio();

  const isHost = roomData?.host?.userId === user.userId;
  const myTeam = isSpectatorMode ? null : teams.find(t => t.userId === user.userId || t.teamName === user.teamName);
  const remainingPurse = myTeam?.remainingPurse || 0;

  const currentSetCode = setInfo?.currentSet || "M1";
  const currentSetConfig = SET_CONFIG[currentSetCode] || { name: currentSetCode, short: currentSetCode, phase: "primary", color: T.blue };
  const currentPhaseColor = PHASE_COLORS[currentSetConfig.phase] || T.blue;

  // ── Socket setup (all original logic, zero changes) ───────────────────────
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
    socket.on("chat:history", (msgs) => setChatMessages(msgs || []));
    socket.on("auction:playerNominated", (data) => {
      setSoldOverlay(null); setRtmPending(null); setIsRtmMatch(false); setSetTransition(null);
      setBidLadder([]);
      setCurrentPlayer(normalizeAuctionPlayerPayload(data.player));
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(null);
      setMinNextBid(Number(data.minNextBid ?? data.currentBid ?? data.player?.basePrice ?? 0));
      setAuctionStatus("BIDDING");
      setStats(s => ({ ...s, currentPlayerIndex: data.playerIndexInSet || (s.currentPlayerIndex + 1) }));
      if (data.setInfo) setSetInfo(data.setInfo);
      if (data.playerIndexInSet != null) setPlayerIndexInSet(data.playerIndexInSet);
      if (data.totalPlayersInSet != null) setTotalPlayersInSet(data.totalPlayersInSet);
      if (data.setPoolPlayers) setSetPoolPlayers(data.setPoolPlayers);
      prevTimerSecRef.current = -1;
      startClientTimer(data.timerEndsAt);
    });
    socket.on("auction:bidPlaced", (data) => {
      // Guard against out-of-order socket delivery:
      // once RTM is pending, a late bidPlaced event must not roll UI back.
      if (auctionStatusRef.current === "RTM_PENDING") return;
      if (data.currentPlayer) setCurrentPlayer(normalizeAuctionPlayerPayload(data.currentPlayer));
      setCurrentBid(data.currentBid);
      setCurrentBidTeam(data.currentBidTeam);
      setMinNextBid(data.minNextBid);
      setIsPricePulsing(true);
      setTimeout(() => setIsPricePulsing(false), 600);
      setIsRtmMatch(false);
      setBidLadder((prev) => {
        const next = [
          { teamName: data.currentBidTeam, amount: data.currentBid, at: Date.now() },
          ...prev.filter((item) => item.teamName !== data.currentBidTeam),
        ];
        return next.slice(0, 3);
      });
      startClientTimer(data.timerEndsAt);
      playBidSound();
      // ── Commentary banner: trigger when bid ≥ 5× base price ────────────
      const pBase = Number(data.currentPlayer?.basePrice || 0);
      if (pBase > 0 && Number(data.currentBid) >= pBase * 5) {
        setCommentaryBanner({ playerName: data.currentPlayer?.name, amount: data.currentBid, teamName: data.currentBidTeam, basePrice: pBase });
        setTimeout(() => setCommentaryBanner(null), 5000);
      }
    });
    socket.on("auction:playerSold", (data) => {
      clearClientTimer(); setAuctionStatus("SOLD");
      setRtmPending(null); setIsRtmMatch(false);
      if (data.teams) {
        setTeams(prev => prev.map(t => {
          const upd = data.teams.find(u => u.teamName === t.teamName);
          return upd ? { ...t, remainingPurse: upd.remainingPurse, squadSize: upd.squadSize, squad: upd.squad || t.squad } : t;
        }));
      }
      setSoldOverlay({ type: "sold", player: data.player, soldTo: data.soldTo, soldPrice: data.soldPrice, acquiredVia: data.acquiredVia });
      setStats(s => ({ ...s, totalPlayersSold: s.totalPlayersSold + 1 }));
      if (data.soldTo === user.teamName) {
        playSoldMusic();
        setParticleColor(T.green);
        setShowParticles(true);
        setTimeout(() => setShowParticles(false), 3500);
      }
      setTimeout(() => setSoldOverlay(null), 4000);
    });
    socket.on("auction:playerRevealed", (data) => {
      setCurrentPlayer(normalizeAuctionPlayerPayload(data.player));
    });
    socket.on("auction:playerUnsold", (data) => {
      clearClientTimer(); setAuctionStatus("UNSOLD");
      setSoldOverlay({ type: "unsold", player: data.player });
      setStats(s => ({ ...s, totalPlayersUnsold: s.totalPlayersUnsold + 1 }));
      playUnsoldSound();
      setTimeout(() => setSoldOverlay(null), 3000);
    });
    socket.on("auction:rtmPending", (data) => {
      clearClientTimer(); setAuctionStatus("RTM_PENDING");
      if (data.currentPlayer) setCurrentPlayer(normalizeAuctionPlayerPayload(data.currentPlayer));
      setRtmPending({
        ...data,
        rtmTeam: data?.rtmTeam || data?.rtmEligibleTeam || null,
      });
      startClientTimer(data.timerEndsAt);
      playRtmSound();
    });
    socket.on("auction:setChanged", (data) => {
      if (data.setInfo) setSetInfo(data.setInfo);
      if (data.setPoolPlayers) setSetPoolPlayers(data.setPoolPlayers);
      const sc = SET_CONFIG[data.setInfo?.currentSet] || {};
      setSetTransition({ setCode: data.setInfo?.currentSet, setName: sc.name || data.setInfo?.currentSet, phase: sc.phase || "primary", playersInSet: data.playersInSet, isAccelerated: data.isAccelerated });
      setTimeout(() => setSetTransition(null), 4000);
    });
    socket.on("auction:timerTick", (data) => {
      if (data.remaining > 0 && timerEndRef.current) {
        const corrected = Date.now() + data.remaining * 1000;
        if (Math.abs(corrected - timerEndRef.current) > 500) timerEndRef.current = corrected;
      }
      setTimerRemaining(data.remaining);
    });
    socket.on("auction:paused", () => { clearClientTimer(); setAuctionStatus("PAUSED"); });
    socket.on("auction:resumed", () => setAuctionStatus("BIDDING"));
    socket.on("auction:completed", (data) => {
      clearClientTimer(); setAuctionStatus("COMPLETED");
      const s = data.stats || data;
      setStats(prev => ({ ...prev, totalPlayersSold: s.totalSold ?? s.totalPlayersSold ?? prev.totalPlayersSold, totalPlayersUnsold: s.totalUnsold ?? s.totalPlayersUnsold ?? prev.totalPlayersUnsold }));
    });
    socket.on("auction:error", (data) => { setError(data.error); setTimeout(() => setError(""), 3000); });
    socket.on("auction:state", (state) => { if (state) applyAuctionState(state); });
    socket.on("room:updated", (data) => {
      setRoomData((prev) => prev ? ({ ...prev, ...(data.host ? { host: data.host } : {}), ...(data.status ? { status: data.status } : {}) }) : prev);
      if (data.joinedTeams) {
        setTeams(prev => data.joinedTeams.map(nt => {
          const existing = prev.find(p => p.teamName === nt.teamName);
          const hasUsable = (nt.squad || []).some(sp => sp?.player?.name || sp?.name || Number.isFinite(sp?.price));
          if (existing && (!nt.squad || !hasUsable)) return { ...nt, squad: existing.squad || [] };
          return nt;
        }));
      }
    });
    socket.on("room:userJoined", (data) => {
      if (data.joinedTeams) {
        setTeams(prev => data.joinedTeams.map(nt => {
          const existing = prev.find(p => p.teamName === nt.teamName);
          if (existing && existing.squad?.length > 0) return { ...nt, squad: existing.squad };
          return nt;
        }));
      }
    });
    socket.on("room:teamKicked", (data) => {
      if (data.joinedTeams) setTeams(data.joinedTeams);
      if (data.kickedUserId === user.userId) navigate("/");
    });
    socket.on("auction:timerChanged", (data) => { if (data.seconds) setTimerConfig(data.seconds); });
    socket.on("chat:message", (msg) => {
      setChatMessages(prev => [...prev, msg]);
      // Only count as unread if chat panel is not currently visible
      if (!chatVisibleRef.current) setUnreadChatCount(prev => prev + 1);
    });
    socket.on("feed:event", (ev) => setFeedEvents(prev => [ev, ...prev].slice(0, 60)));
    // Live team strength updates — broadcast after each player sale + XI confirmation
    socket.on("match:strengthUpdate", (data) => {
      if (data?.teamName) setTeamStrengths(prev => ({ ...prev, [data.teamName]: data }));
    });
    socket.on("match:xiConfirmed", (data) => {
      if (data?.teamName) setTeamStrengths(prev => ({
        ...prev,
        [data.teamName]: {
          ...(prev[data.teamName] || {}),
          total: data.teamStrength,
          breakdown: data.breakdown || (prev[data.teamName]?.breakdown),
          xiConfirmed: true,
        },
      }));
    });
    // ── Phase 6 new listeners ─────────────────────────────────────────────
    // Purse recalculation after each sale
    socket.on("auction:pursesRecalculated", (data) => {
      if (data?.purseSummary) setPurseSummary(data.purseSummary);
      // Merge team purses into team state as well
      if (data?.purseSummary) {
        setTeams(prev => prev.map(t => {
          const upd = data.purseSummary.find(s => s.teamName === t.teamName);
          return upd ? { ...t, remainingPurse: upd.remainingPurse } : t;
        }));
      }
    });
    // Reconnection toast — emitted by server when we re-join a live auction
    socket.on("room:reconnected", (data) => {
      // Suppress on first join — server fires this for any join to a live auction.
      // Only show when genuinely reconnecting (i.e. page was already open for >3s).
      if (Date.now() - joinTimeRef.current > 3000) {
        setReconnectToast(data);
        setTimeout(() => setReconnectToast(null), 4000);
      }
    });
    return () => {
      clearClientTimer();
      ["auction:playerNominated","auction:bidPlaced","auction:playerSold","auction:playerUnsold",
       "auction:playerRevealed","auction:rtmPending","auction:timerTick","auction:paused","auction:resumed",
       "auction:completed","auction:error","auction:state","auction:setChanged","auction:timerChanged",
       "room:updated","room:userJoined","room:teamKicked","chat:message","chat:history","activity:history",
       "feed:event","match:strengthUpdate","match:xiConfirmed",
       "auction:pursesRecalculated","room:reconnected","room:user_disconnected",
      ].forEach(e => socket.off(e));
    };
  }, [socket, code, isSpectatorMode]);

  // Initial team strength fetch (non-blocking; updates when players are bought)
  useEffect(() => {
    if (!socket || !code) return;
    socket.emit("match:getAllStrengths", { roomCode: code }, (res) => {
      if (res?.success && Array.isArray(res.data)) {
        setTeamStrengths(Object.fromEntries(res.data.map(t => [t.teamName, t])));
      }
    });
  }, [socket, code]);

  useEffect(() => {
    const sec = Math.ceil(Number(timerRemaining) || 0);
    if (sec === prevTimerSecRef.current || sec <= 0) return;
    const prev = prevTimerSecRef.current;
    prevTimerSecRef.current = sec;
    if (prev === -1) return;
    if (auctionStatus !== "BIDDING" && auctionStatus !== "RTM_PENDING") return;
    if (sec <= 3) playTimerAlert();
    else playTimerTick();
  }, [timerRemaining, auctionStatus, playTimerTick, playTimerAlert]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const applyAuctionState = (state) => {
    setAuctionStatus(state.status);
    if (state.currentLeaguePlayer) {
      setCurrentPlayer(normalizeAuctionPlayerPayload(state.currentLeaguePlayer));
    } else {
      setCurrentPlayer(null);
    }
    setCurrentBid(state.currentBid || 0);
    setCurrentBidTeam(state.currentBidTeam || null);
    if (state.minNextBid != null) setMinNextBid(Number(state.minNextBid) || 0);
    else { const bid = Number(state.currentBid || state.currentBasePrice || 0); setMinNextBid(state.currentBidTeam ? calculateMinBid(bid) : bid); }
    setTimerRemaining(state.timerRemaining || 0);
    if (state.timerDurationMs) { setTimerDuration(Math.ceil(state.timerDurationMs / 1000)); setTimerConfig(Math.ceil(state.timerDurationMs / 1000)); }
    if (state.teams) setTeams(state.teams);
    if (state.setInfo) setSetInfo(state.setInfo);
    if (state.playerIndexInSet != null) setPlayerIndexInSet(state.playerIndexInSet);
    if (state.totalPlayersInSet != null) setTotalPlayersInSet(state.totalPlayersInSet);
    if (state.setPoolPlayers) setSetPoolPlayers(state.setPoolPlayers);
    const poolLen = state.playerPool?.length || 0, soldLen = state.soldPlayers?.length || 0, unsoldLen = state.unsoldPlayers?.length || 0;
    setStats({ totalPlayersSold: state.totalPlayersSold || 0, totalPlayersUnsold: state.totalPlayersUnsold || 0, currentPlayerIndex: state.nominationIndex || 0, totalPlayers: poolLen + soldLen + unsoldLen });
    if (state.timerEndsAt && ["BIDDING","RTM_PENDING"].includes(state.status)) startClientTimer(state.timerEndsAt);
    if (state.status === "RTM_PENDING" && state.rtmEligibleTeam) setRtmPending({ rtmTeam: state.rtmEligibleTeam, currentBid: state.currentBid, currentBidTeam: state.currentBidTeam });
  };

  const startClientTimer = (timerEndsAt) => {
    clearClientTimer();
    const endTime = new Date(timerEndsAt).getTime();
    timerEndRef.current = endTime;
    const totalSec = Math.ceil((endTime - Date.now()) / 1000);
    if (totalSec > 0) setTimerDuration(totalSec);
    prevTimerSecRef.current = -1;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil(((timerEndRef.current || endTime) - Date.now()) / 1000));
      setTimerRemaining(remaining);
      if (remaining <= 0) clearClientTimer();
    };
    tick();
    timerRef.current = setInterval(tick, 200);
  };
  const clearClientTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    timerEndRef.current = null;
    setTimerRemaining(0);
    prevTimerSecRef.current = -1;
  };

  // ── Actions (all original, zero changes) ─────────────────────────────────
  const placeBid = useCallback((amount) => {
    if (isSpectatorMode || !socket) return;
    setError("");
    const bidAmount = Number(amount);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) return;
    socket.emit("auction:bid", { roomCode: code, userId: user.userId, teamName: user.teamName, amount: bidAmount }, (res) => {
      if (!res?.success) { setError(res?.error || "Bid failed"); setTimeout(() => setError(""), 3000); }
    });
  }, [socket, code, user, isSpectatorMode]);

  const handleRtm = useCallback((action) => {
    if (isSpectatorMode || !socket) return;
    const canonicalTeamName = resolveCanonicalRoomTeamName(
      myTeam?.teamName || user.teamName || user.teamShortName || "",
      teams
    );
    socket.emit(
      action === "use" ? "auction:rtmUse" : "auction:rtmPass",
      { roomCode: code, userId: user.userId, teamName: canonicalTeamName || user.teamName }
    );
  }, [socket, code, user, isSpectatorMode, myTeam, teams]);

  const handlePause = () => { socket?.emit("auction:pause", { roomCode: code, userId: user.userId }); };
  const handleResume = () => { socket?.emit("auction:resume", { roomCode: code, userId: user.userId }); };
  const handleKick = (targetUserId) => {
    if (!socket || !isHost) return;
    if (!confirm("Kick this team?")) return;
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
    socket.emit("chat:send", { roomCode: code, userId: user.userId, userName: user.userName, teamName: user.teamName, message: chatInput }, (res) => {
      if (res && !res.success) { setError(res.error || "Chat failed"); setTimeout(() => setError(""), 3000); }
    });
    setChatInput("");
  };

  const canBid = !isSpectatorMode && auctionStatus === "BIDDING" && currentBidTeam !== user.teamName && myTeam && remainingPurse >= minNextBid;
  const pendingRtmTeam = rtmPending?.rtmTeam || rtmPending?.rtmEligibleTeam || "";
  const canonicalPendingRtmTeam = resolveCanonicalRoomTeamName(pendingRtmTeam, teams);
  const userTeamCandidates = [
    myTeam?.teamName,
    myTeam?.teamShortName,
    user.teamName,
    user.teamShortName,
  ]
    .map((name) => resolveCanonicalRoomTeamName(name || "", teams))
    .map((name) => normalizeTeamName(name))
    .filter(Boolean);
  const isRtmEligible =
    !isSpectatorMode &&
    auctionStatus === "RTM_PENDING" &&
    userTeamCandidates.includes(normalizeTeamName(canonicalPendingRtmTeam));
  const timerPressure = timerRemaining > 0 && timerRemaining <= 5;
  const timerColor = timerRemaining <= 5 ? T.red : timerRemaining <= 10 ? T.orange : T.green;
  const timerDisplay = String(Math.max(0, Math.min(99, Math.ceil(Number(timerRemaining) || 0)))).padStart(2, "0");
  const activePlayerPhase = resolvePlayerPhase(currentPlayer, currentBidTeam);
  const myStrength = myTeam ? teamStrengths[myTeam.teamName] : null;
  const mobileAnalysisPool = (myTeam?.squad || []).map((entry, index) => ({
    id:
      entry?.playerId?.toString?.() ||
      entry?.player?._id?.toString?.() ||
      entry?.leaguePlayer?._id?.toString?.() ||
      `${entry?.name || entry?.player?.name || "player"}-${index}`,
    name: entry?.player?.name || entry?.name || "Unknown Player",
    role: entry?.player?.role || entry?.role || "Batsman",
    fairPoint: Number(entry?.fairPoint || entry?.leaguePlayer?.fairPoint || 0),
    context: entry?.context || entry?.ratingData?.context || entry?.player?.context || entry?.leaguePlayer?.context || null,
    stats: entry?.stats || entry?.leaguePlayer?.stats || null,
    stats2026: entry?.stats2026 || entry?.leaguePlayer?.stats2026 || null,
    stats2024: entry?.stats2024 || entry?.leaguePlayer?.stats2024 || null,
    stats2025: entry?.stats2025 || entry?.leaguePlayer?.stats2025 || null,
    isOverseas: Boolean(entry?.isOverseas || entry?.player?.isOverseas),
  }));
  const selectedMobileAnalysisPlayer =
    mobileAnalysisPool.find((row) => row.id === mobileAnalysisPlayerId) ||
    mobileAnalysisPool[0] ||
    (currentPlayer
      ? {
          id: "current-player",
          name: currentPlayer.name,
          role: currentPlayer.role,
          fairPoint: Number(currentPlayer.fairPoint || 0),
          context: currentPlayer.context || null,
          isOverseas: Boolean(currentPlayer.isOverseas),
        }
      : null);
  const selectedMobileAnalysisCtx =
    selectedMobileAnalysisPlayer?.context?.baseStats
      ? selectedMobileAnalysisPlayer.context
      : selectedMobileAnalysisPlayer?.name === currentPlayer?.name
        ? (currentPlayer?.context || selectedMobileAnalysisPlayer?.context || {})
        : (selectedMobileAnalysisPlayer?.context || {});
  const mobileAnalysisMatchupRows = buildOpponentMatchupRows(selectedMobileAnalysisPlayer, teams, myTeam);
  const mobileAnalysisWeaknessTags = [
    ...(selectedMobileAnalysisCtx?.matchupWeaknesses || []).map((item) => item?.label).filter(Boolean),
    ...(selectedMobileAnalysisCtx?.exactTags || []).filter((tag) => tag?.tone === "bad").map((tag) => tag?.label).filter(Boolean),
    ...(selectedMobileAnalysisCtx?.clueTags || []),
  ].filter(Boolean).slice(0, 3);
  const mobileScoutSignals = currentPlayer ? getScoutSignals(currentPlayer, currentPlayer.context || {}) : null;
  const filteredMobileAnalysisPool = mobileAnalysisPool.filter((row) => {
    if (mobileAnalysisRoleFilter === "all") return true;
    if (mobileAnalysisRoleFilter === "bat") return row.role === "Batsman";
    if (mobileAnalysisRoleFilter === "bowl") return row.role === "Bowler";
    if (mobileAnalysisRoleFilter === "ar") return row.role === "All-Rounder";
    if (mobileAnalysisRoleFilter === "wk") return row.role === "Wicket-Keeper";
    return true;
  });

  useEffect(() => {
    if (!mobileAnalysisPool.length) {
      setMobileAnalysisPlayerId(null);
      return;
    }
    setMobileAnalysisPlayerId((prev) => {
      if (prev && mobileAnalysisPool.some((row) => row.id === prev)) return prev;
      return mobileAnalysisPool[0].id;
    });
  }, [mobileAnalysisPool.length, myTeam?.squad?.length]);

  useEffect(() => {
    if (!filteredMobileAnalysisPool.length) return;
    setMobileAnalysisPlayerId((prev) => {
      if (prev && filteredMobileAnalysisPool.some((row) => row.id === prev)) return prev;
      return filteredMobileAnalysisPool[0].id;
    });
  }, [mobileAnalysisRoleFilter, filteredMobileAnalysisPool.length]);

  // ── COMPLETED VIEW ────────────────────────────────────────────────────────
  if (auctionStatus === "COMPLETED") {
    return (
      <div style={{ background: T.bgDeep, fontFamily: T.font, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>🏆</div>
          <div style={{ fontFamily: T.font, fontSize: 48, fontWeight: 900, color: T.text, marginBottom: 8, textTransform: "uppercase", letterSpacing: 3 }}>Auction Complete</div>
          <div style={{ fontFamily: T.mono, fontSize: 14, color: T.textMid, marginBottom: 40 }}>
            <span style={{ color: T.green }}>{stats.totalPlayersSold}</span> sold · <span style={{ color: T.red }}>{stats.totalPlayersUnsold}</span> unsold
          </div>
          <button onClick={() => navigate(`/room/${code}/results`)}
            style={{ background: `linear-gradient(135deg, ${T.gold}, ${T.goldDim})`, color: "#000", border: "none", cursor: "pointer", padding: "16px 40px", borderRadius: 14, fontFamily: T.font, fontSize: 18, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 10, margin: "0 auto", boxShadow: `0 0 40px ${T.gold}44` }}>
            <Trophy size={22} /> View Results
          </button>
          {!isSpectatorMode && (
            <button onClick={() => setXiModal(true)}
              style={{ background: `${T.blue}20`, color: T.blue, border: `1px solid ${T.blue}44`, cursor: "pointer", padding: "12px 30px", borderRadius: 14, fontFamily: T.font, fontSize: 15, fontWeight: 800, letterSpacing: 1, display: "flex", alignItems: "center", gap: 8, margin: "12px auto 0" }}>
              ⚡ Select Playing XI
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Chat panel (shared desktop + mobile) ──────────────────────────────────
  const ChatPanel = () => (
    <>
      <div style={{
        borderBottom: `1px solid ${T.border}`,
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        background: "linear-gradient(135deg, rgba(59,130,246,0.12), transparent)",
      }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, animation: "pulse 2s infinite" }} />
        <span style={{ fontFamily: T.font, fontSize: 13, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: 1 }}>Live Chat</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginLeft: "auto" }}>{chatMessages.length} msgs</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 12, background: "linear-gradient(180deg, rgba(255,255,255,0.02), transparent)" }}>
        {chatMessages.length === 0 && (
          <div style={{ textAlign: "center", color: T.textDim, fontFamily: T.mono, fontSize: 11, marginTop: 20 }}>No messages yet</div>
        )}
        {chatMessages.map((msg, i) => <ChatMsg key={msg._id || i} msg={msg} isMe={msg.userId === user.userId} />)}
        <div ref={chatEndRef} />
      </div>
      {!isSpectatorMode && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 12px", flexShrink: 0, display: "flex", gap: 8, background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.03))" }}>
          <input type="text" placeholder="Type a message..." value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendChat()}
            style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", fontFamily: T.font, fontSize: 13, color: T.text, outline: "none", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.02)" }} />
          <button onClick={sendChat}
            style={{ background: `linear-gradient(135deg, ${T.blue}, ${T.blueDim})`, border: "none", cursor: "pointer", padding: "9px 14px", borderRadius: 12, color: "#fff", display: "flex", alignItems: "center", gap: 6, fontFamily: T.font, fontSize: 12, fontWeight: 700 }}>
            <Send size={14} /> Send
          </button>
        </div>
      )}
    </>
  );

  // ─── TOP BAR ───────────────────────────────────────────────────────────────
  const TopBar = () => (
    <div style={{
      background: "#060912", borderBottom: `1px solid ${T.border}`,
      padding: "0 16px", height: 56, display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 12, flexShrink: 0,
      boxShadow: "0 2px 20px rgba(0,0,0,0.5)",
    }}>
      {/* Left */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
        <button onClick={() => navigate("/")}
          style={{ background: "none", border: "none", cursor: "pointer", color: T.textDim, padding: 4, display: "flex" }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.text, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
              {roomData?.roomName || "Live Auction"}
            </span>
            <span style={{
              background: auctionStatus === "PAUSED" ? `${T.orange}20` : `${T.red}20`,
              color: auctionStatus === "PAUSED" ? T.orange : T.red,
              border: `1px solid ${auctionStatus === "PAUSED" ? T.orange + "44" : T.red + "44"}`,
              fontFamily: T.mono, fontSize: 9, padding: "2px 7px", borderRadius: 99, letterSpacing: 2,
              display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: auctionStatus === "PAUSED" ? T.orange : T.red, animation: auctionStatus !== "PAUSED" ? "pulse 1.2s infinite" : "none" }} />
              {auctionStatus === "PAUSED" ? "PAUSED" : "LIVE"}
            </span>
            {isSpectatorMode && <Badge color={T.blue}>SPECTATING</Badge>}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 1 }}>
            {playerIndexInSet}/{totalPlayersInSet || "?"} · ✅{stats.totalPlayersSold} · ❌{stats.totalPlayersUnsold}
          </div>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {myTeam && (
          <div style={{ background: `${T.green}15`, border: `1px solid ${T.green}22`, borderRadius: 9, padding: "5px 12px", textAlign: "right" }}>
            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1 }}>PURSE</div>
            <div style={{ fontFamily: T.mono, fontSize: 13, color: T.green, fontWeight: 700 }}>{formatPrice(remainingPurse)}</div>
          </div>
        )}
        {myTeam && (
          <div style={{ background: `${T.blue}15`, border: `1px solid ${T.blue}22`, borderRadius: 9, padding: "5px 12px", textAlign: "right", display: "none" }} className="md-show">
            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1 }}>TEAM</div>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.blue, fontWeight: 700 }}>{myTeam.teamShortName || myTeam.teamName}</div>
          </div>
        )}
        {isHost && auctionStatus === "BIDDING" && (
          <button onClick={handlePause} style={{ background: `${T.orange}20`, border: `1px solid ${T.orange}33`, color: T.orange, cursor: "pointer", padding: "7px 10px", borderRadius: 9, display: "flex" }}>
            <Pause size={15} />
          </button>
        )}
        {isHost && auctionStatus === "PAUSED" && (
          <button onClick={handleResume} style={{ background: `${T.green}20`, border: `1px solid ${T.green}33`, color: T.green, cursor: "pointer", padding: "7px 10px", borderRadius: 9, display: "flex" }}>
            <Play size={15} />
          </button>
        )}
        {/* ── Re-auction unsold button (host only, visible when auction is paused or between nominations) ── */}
        {isHost && ["PAUSED","SOLD","UNSOLD","NOMINATING","WAITING"].includes(auctionStatus) && stats.totalPlayersUnsold > 0 && (
          <button
            onClick={() => {
              if (confirm(`Re-auction all ${stats.totalPlayersUnsold} unsold player(s)?`)) {
                socket?.emit("auction:nominateUnsold", { roomCode: code, userId: user.userId }, (res) => {
                  if (!res?.success) { setError(res?.error || "Re-auction failed"); setTimeout(() => setError(""), 3000); }
                });
              }
            }}
            style={{
              background: `${T.purple}20`, border: `1px solid ${T.purple}33`,
              color: T.purple, cursor: "pointer", padding: "5px 10px", borderRadius: 9,
              fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <ChevronRight size={12} /> RE-AUCTION {stats.totalPlayersUnsold} UNSOLD
          </button>
        )}
        {isHost && (
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowTimerConfig(!showTimerConfig)}
              style={{ background: `${T.blue}15`, border: `1px solid ${T.blue}22`, color: T.blue, cursor: "pointer", padding: "7px 10px", borderRadius: 9, display: "flex", alignItems: "center", gap: 5, fontFamily: T.mono, fontSize: 11 }}>
              <Clock size={13} /><span>{timerConfig}s</span>
            </button>
            {showTimerConfig && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 8px)",
                background: T.bgCard, border: `1px solid ${T.borderHi}`,
                borderRadius: 12, padding: 12, zIndex: 50,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 140,
              }}>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, marginBottom: 8 }}>BID TIMER</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[5,10,15,20].map(s => (
                    <button key={s} onClick={() => handleTimerChange(s)}
                      style={{
                        background: timerConfig === s ? `${T.blue}22` : T.bgGlass,
                        color: timerConfig === s ? T.blue : T.textMid,
                        border: `1px solid ${timerConfig === s ? T.blue+"44" : T.border}`,
                        cursor: "pointer", padding: "7px 0", borderRadius: 8,
                        fontFamily: T.mono, fontSize: 12, fontWeight: 700,
                      }}>{s}s</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <SoundControls compact expanded={showSoundPanel} onToggle={setShowSoundPanel} />
      </div>
    </div>
  );

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: T.bgDeep, fontFamily: T.font, height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideUp { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes bidPulse { 0%{transform:translateY(4px) scale(0.98);opacity:0.6} 60%{transform:translateY(-2px) scale(1.02);opacity:1} 100%{transform:translateY(0) scale(1);opacity:1} }
        @keyframes nameSlide { 0%{transform:translateY(10px);opacity:0} 100%{transform:translateY(0);opacity:1} }
        @keyframes nameCinema {
          0%   { opacity:0; transform:translateY(18px) scaleX(1.06); letter-spacing:6px; filter:blur(8px); }
          60%  { opacity:1; filter:blur(0); }
          100% { opacity:1; transform:translateY(0)   scaleX(1);    letter-spacing:2px; filter:blur(0); }
        }
        @media(min-width:768px) { .md-show { display:block !important; } }
      `}</style>

      {/* Error toast */}
      {error && (
        <div style={{
          position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
          background: T.red, color: "#fff", padding: "10px 20px", borderRadius: 10,
          zIndex: 2000, fontFamily: T.font, fontSize: 13, fontWeight: 700,
          boxShadow: `0 0 24px ${T.red}66`, whiteSpace: "nowrap",
        }}>{error}</div>
      )}

      {/* ── Commentary banner (bid ≥ 5× base price) ────────────────────── */}
      {commentaryBanner && (
        <div style={{
          position: "fixed", top: error ? 60 : 16, left: "50%", transform: "translateX(-50%)",
          background: `linear-gradient(135deg, ${T.gold}EE, ${T.orange}EE)`,
          color: "#000", padding: "10px 20px", borderRadius: 12,
          zIndex: 1999, fontFamily: T.font, fontSize: 13, fontWeight: 800,
          boxShadow: `0 0 32px ${T.gold}88`, whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          🔥 {commentaryBanner.teamName} bids {formatPrice(commentaryBanner.amount)} — {(commentaryBanner.amount / commentaryBanner.basePrice).toFixed(1)}× base price on {commentaryBanner.playerName}!
        </div>
      )}

      {/* ── Reconnection toast ────────────────────────────────────────── */}
      {reconnectToast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: `${T.green}EE`, color: "#fff", padding: "10px 20px", borderRadius: 10,
          zIndex: 2000, fontFamily: T.font, fontSize: 13, fontWeight: 700,
          boxShadow: `0 0 20px ${T.green}66`, whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          ✅ Reconnected to auction — {reconnectToast.teamName || "you're back in the game!"}
        </div>
      )}

      <ParticleEffect active={showParticles} color={particleColor} count={60} />
      <SetSplash transition={setTransition} />

      <TopBar />
      <SetStrip setInfo={setInfo} />

      <div style={{ borderBottom: `1px solid ${T.border}`, background: "#060912", padding: "6px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }} className="desktop-ctrl-bar">
        <style>{`@media(max-width:1023px){.desktop-ctrl-bar{display:none!important}}`}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setLeftRailCollapsed((v) => !v)} style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textMid, borderRadius: 8, padding: "5px 10px", fontFamily: T.mono, fontSize: 10, cursor: "pointer" }}>
            {leftRailCollapsed ? "Show Teams" : "Hide Teams"}
          </button>
          <button onClick={() => setRightRailCollapsed((v) => !v)} style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textMid, borderRadius: 8, padding: "5px 10px", fontFamily: T.mono, fontSize: 10, cursor: "pointer" }}>
            {rightRailCollapsed ? "Show Feed" : "Hide Feed"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2 }}>TOP BIDDERS</span>
          {(bidLadder.length ? bidLadder : [{ teamName: currentBidTeam || "No bids", amount: currentBid || 0 }]).map((row, idx) => (
            <div key={`${row.teamName}-${idx}`} style={{ background: idx === 0 ? `${T.gold}18` : "rgba(255,255,255,0.04)", border: `1px solid ${idx === 0 ? T.gold + "55" : T.border}`, color: idx === 0 ? T.gold : T.textMid, borderRadius: 8, padding: "4px 8px", fontFamily: T.mono, fontSize: 10 }}>
              {idx + 1}. {row.teamName} {row.amount ? `· ${formatPrice(row.amount)}` : ""}
            </div>
          ))}
        </div>
      </div>

      {/* ── DESKTOP LAYOUT (lg+) ────────────────────────────────────────── */}
      <div style={{ display: "none", flex: 1, overflow: "hidden", minHeight: 0 }} className="desktop-layout">
        <style>{`@media(min-width:1024px){.desktop-layout{display:flex!important}.mobile-layout{display:none!important}}`}</style>

        {/* LEFT: Teams */}
        <div style={{ width: leftRailCollapsed ? 0 : 260, borderRight: leftRailCollapsed ? "none" : `1px solid ${T.border}`, overflowY: "auto", padding: leftRailCollapsed ? 0 : "14px 12px", flexShrink: 0, transition: "all 240ms ease", opacity: leftRailCollapsed ? 0 : 1 }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Teams & Purse</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.map(team => (
              <TeamRow key={team.teamName} team={team}
                isLeading={currentBidTeam === team.teamName}
                isMe={team.userId === user.userId}
                isHost={isHost}
                onKick={handleKick}
                expandedTeam={expandedTeam}
                setExpandedTeam={setExpandedTeam}
                strength={teamStrengths[team.teamName]}
                onSetXI={team.userId === user.userId && !isSpectatorMode ? () => setXiModal(true) : undefined} />
            ))}
          </div>
          <SetPlayersList
            players={setPoolPlayers}
            auctionStatus={auctionStatus}
            isHost={isHost}
            currentPhaseColor={currentPhaseColor}
            currentSetConfig={currentSetConfig}
            onNominate={handleNominate} />
        </div>

        {/* CENTER: Main auction */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, position: "relative" }} className={timerPressure ? "timer-pressure" : ""}>
          {playerCardTab !== "analysis" && <SoldOverlay overlay={soldOverlay} />}
          {isRtmEligible && <RtmDecisionOverlay rtmPending={rtmPending} currentPlayer={currentPlayer} onRtm={handleRtm} formatPrice={formatPrice} />}

          {/* Player card */}
          {currentPlayer && auctionStatus !== "PAUSED" ? (
            <PlayerCard
              player={currentPlayer}
              currentBid={currentBid}
              currentBidTeam={currentBidTeam}
              timerRemaining={timerRemaining}
              timerDuration={timerDuration}
              isPricePulsing={isPricePulsing}
              auctionStatus={auctionStatus}
              user={user}
              teams={teams}
              myTeam={myTeam}
              myStrength={myStrength}
              onTabChange={setPlayerCardTab} />
          ) : (
            <GCard style={{ padding: "60px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, letterSpacing: 2 }}>
                {auctionStatus === "PAUSED" ? "⏸ AUCTION PAUSED" : auctionStatus === "WAITING" ? "AUCTION STARTING SOON..." : "SELECTING NEXT PLAYER..."}
              </div>
            </GCard>
          )}

          {/* Bid button */}
          {canBid && !soldOverlay && (
            <GCard style={{ padding: "16px 20px" }}>
              {/* Purse danger warning */}
              {myTeam && (remainingPurse - minNextBid) < 200 && (
                <div style={{
                  background: `${T.orange}18`, border: `1px solid ${T.orange}44`,
                  borderRadius: 10, padding: "8px 12px", marginBottom: 10,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <AlertTriangle size={14} color={T.orange} />
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.orange, fontWeight: 700 }}>
                    Low purse! Only {formatPrice(Math.max(0, remainingPurse - minNextBid))} remaining after this bid.
                  </span>
                </div>
              )}
              <BidButton amount={minNextBid} onClick={() => placeBid(minNextBid)} />
            </GCard>
          )}

          {/* You're leading */}
          {auctionStatus === "BIDDING" && !isSpectatorMode && currentBidTeam === user.teamName && (
            <GCard glow={T.green} style={{ padding: "14px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.green, letterSpacing: 1 }}>🎯 YOU HAVE THE HIGHEST BID!</div>
            </GCard>
          )}
        </div>

        {/* RIGHT: Chat / Feed tabs */}
        <div style={{ width: rightRailCollapsed ? 0 : 280, borderLeft: rightRailCollapsed ? "none" : `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: "#060912", transition: "all 240ms ease", opacity: rightRailCollapsed ? 0 : 1 }}>
          {/* Tab header */}
          <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            {[["chat","💬 Chat"],["feed","⚡ Feed"]].map(([id,label]) => (
              <button key={id} onClick={() => { setRightTab(id); const isChat = id === "chat"; if (isChat) { setUnreadChatCount(0); chatVisibleRef.current = true; } else { chatVisibleRef.current = false; } }} style={{
                flex: 1, padding: "9px 0", background: "none", border: "none", cursor: "pointer",
                fontFamily: T.font, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                color: rightTab === id ? T.gold : T.textDim,
                borderBottom: `2px solid ${rightTab === id ? T.gold : "transparent"}`,
                transition: "color 0.2s, border-color 0.2s",
              }}>{label}{id === "chat" && unreadChatCount > 0 && rightTab !== "chat" && (
                <span style={{ marginLeft: 4, background: T.red, color: "#fff", borderRadius: 99, fontFamily: T.mono, fontSize: 8, padding: "1px 5px", fontWeight: 700 }}>{unreadChatCount > 9 ? "9+" : unreadChatCount}</span>
              )}</button>
            ))}
          </div>
          {rightTab === "chat" ? <ChatPanel /> : <LiveFeedPanel events={feedEvents} />}
        </div>
      </div>

      {/* ── MOBILE LAYOUT ──────────────────────────────────────────────────── */}
      <div className="mobile-layout" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <style>{`@media(min-width:1024px){.mobile-layout{display:none!important}}`}</style>

        {/* Tab bar */}
        <div style={{ background: "#060912", borderBottom: `1px solid ${T.border}`, display: "flex", flexShrink: 0 }}>
          {[
            { id: "auction",  label: "Bid",    icon: <Gavel size={13} /> },
            { id: "analysis", label: "Intel",  icon: <Shield size={13} /> },
            { id: "teams",    label: "Teams",  icon: <Users size={13} /> },
            { id: "sets",     label: "Sets",   icon: <BarChart2 size={13} /> },
            { id: "feed",     label: "Feed",   icon: <Zap size={13} /> },
          ].map(tab => (
            <button key={tab.id} onClick={() => setMobileTab(tab.id)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 2,
                padding: "8px 2px 6px", background: "none", border: "none", cursor: "pointer",
                fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                color: mobileTab === tab.id ? T.gold : T.textDim,
                borderBottom: `2px solid ${mobileTab === tab.id ? T.gold : "transparent"}`,
                transition: "color 0.2s, border-color 0.2s",
              }}>
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>

          {/* AUCTION TAB */}
          {mobileTab === "auction" && (
            <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
              {activePlayerPhase !== "revealed" && <SoldOverlay overlay={soldOverlay} />}
              {isRtmEligible && <RtmDecisionOverlay rtmPending={rtmPending} currentPlayer={currentPlayer} onRtm={handleRtm} formatPrice={formatPrice} />}

              {currentPlayer && auctionStatus !== "PAUSED" ? (
                <>
                  {/* Hero profile */}
                  <div style={{ position: "relative", minHeight: 90, background: `radial-gradient(ellipse at 20% 10%, ${roleColor(currentPlayer.role)}28 0%, transparent 58%), #080C14`, overflow: "hidden", flexShrink: 0 }}>
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,12,20,0.2) 0%, rgba(8,12,20,0.85) 100%)" }} />

                    {/* Badges + name overlaid */}
                    <div style={{ position: "relative", zIndex: 1, padding: "10px 14px 8px" }}>
                      <div style={{ display: "flex", flexWrap: "nowrap", gap: 4, marginBottom: 5, overflow: "hidden" }}>
                        <Badge color={roleColor(currentPlayer.role)}>{currentPlayer.role}</Badge>
                        {currentPlayer.jerseyNumber && <Badge color={T.textMid}>#{currentPlayer.jerseyNumber}</Badge>}
                        {currentPlayer.isOverseas && <Badge color={T.orange}>OS</Badge>}
                        {currentPlayer.isCapped === false && <Badge color={T.purple}>UC</Badge>}
                      </div>
                      <div
                        key={currentPlayer.name}
                        style={{ fontFamily: T.mono, fontSize: "clamp(14px, 4.5vw, 20px)", fontWeight: 900, color: T.text, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.15, animation: "nameCinema 360ms cubic-bezier(0.22,1,0.36,1)", wordBreak: "break-word" }}
                      >
                        {currentPlayer.name}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid, marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span>{currentPlayer.nationality}</span>
                        <span style={{ color: T.gold }}>Base {formatPrice(currentPlayer.basePrice)}</span>
                        {currentPlayer.fairPoint > 0 && <span style={{ color: T.blue }}>FP {currentPlayer.fairPoint.toFixed(1)}</span>}
                        <span style={{ color: T.textDim }}>{idealPositionLabel(currentPlayer)}</span>
                      </div>
                    </div>

                    {/* Timer arc top-left — removed; timer bar below replaces it */}
                  </div>

                  {/* Bid info row */}
                  <div style={{ padding: "10px 14px 8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ background: `${T.blue}12`, border: `1px solid ${T.blue}22`, borderRadius: 12, padding: "10px 14px" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 2, marginBottom: 4 }}>CURRENT BID</div>
                      <AnimatedBidPrice amount={currentBid} pulsing={isPricePulsing} fontSize={22} />
                    </div>
                    <div style={{ background: currentBidTeam ? `${T.green}12` : T.bgGlass, border: `1px solid ${currentBidTeam ? T.green+"22" : T.border}`, borderRadius: 12, padding: "10px 14px" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 2, marginBottom: 4 }}>LEADER</div>
                      <div style={{ fontFamily: T.font, fontSize: 16, fontWeight: 800, color: currentBidTeam ? T.green : T.textDim, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {currentBidTeam || "Awaiting"}
                      </div>
                      {currentBidTeam === user.teamName && <div style={{ fontFamily: T.mono, fontSize: 8, color: T.green, marginTop: 2 }}>🎯 YOU</div>}
                    </div>
                  </div>

                  {/* Timer bar */}
                  <div style={{ padding: "0 14px 10px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 2, flexShrink: 0 }}>
                      <span style={{
                        fontFamily: T.mono, fontSize: 20, fontWeight: 900, color: timerColor, lineHeight: 1,
                        textShadow: timerRemaining <= 5 ? `0 0 18px ${timerColor}` : "none",
                        transition: "color 0.4s, text-shadow 0.4s",
                      }}>{timerDisplay}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 8, color: `${timerColor}88` }}>s</span>
                    </div>
                    <div style={{ flex: 1, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${timerDuration > 0 ? (timerRemaining/timerDuration)*100 : 0}%`, background: `linear-gradient(90deg, ${timerColor}88, ${timerColor})`, borderRadius: 99, boxShadow: `0 0 8px ${timerColor}88`, transition: "width 0.9s linear, background 0.5s" }} />
                    </div>
                  </div>

                  {/* Skills */}
                  {currentPlayer.context && (
                    <div style={{ padding: "0 14px 10px" }}>
                      <div style={{ background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                            <span style={{ color: T.text, fontFamily: T.mono, fontSize: 24, fontWeight: 900 }}>{Math.round(Number(currentPlayer.fairPoint || 0))}</span>
                            <span style={{ color: T.textMid, fontFamily: T.mono, fontSize: 10 }}>BASE FP</span>
                          </div>
                          <span style={{ color: activePlayerPhase === "revealed" ? ((currentPlayer.context.contextModifier || 0) >= 0 ? T.green : T.red) : activePlayerPhase === "bid" ? T.orange : T.textDim, fontSize: 13, fontWeight: 700 }}>
                            {activePlayerPhase === "revealed"
                              ? `${(currentPlayer.context.contextModifier || 0) >= 0 ? "+" : ""}${currentPlayer.context.contextModifier || 0} context`
                              : activePlayerPhase === "bid"
                                ? `+? ${currentPlayer.context.contextModifierHint || "bonus"}`
                                : "? context"}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                          {(currentPlayer.context.visibleTags || []).map((tag) => (
                            <span key={tag} style={{ background: `${T.blue}18`, border: `1px solid ${T.blue}33`, color: "#CFE2FF", padding: "4px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{tag}</span>
                          ))}
                          {activePlayerPhase !== "scout" && (currentPlayer.context.clueTags || []).slice(0, 2).map((tag) => (
                            <span key={tag} style={{ background: `${T.orange}14`, border: `1px solid ${T.orange}28`, color: "#FED7AA", padding: "4px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{tag}</span>
                          ))}
                          {activePlayerPhase === "revealed" && (currentPlayer.context.exactTags || []).slice(0, 2).map((tag) => (
                            <span key={tag.label} style={{ background: `${tag.tone === "good" ? T.green : T.red}14`, border: `1px solid ${tag.tone === "good" ? T.green : T.red}28`, color: tag.tone === "good" ? "#D9F99D" : "#FECACA", padding: "4px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>{tag.label}</span>
                          ))}
                        </div>
                        <div style={{ color: T.textDim, fontSize: 11 }}>
                          {activePlayerPhase === "revealed"
                            ? "Full player context unlocked."
                            : currentPlayer.context.hiddenTagCount
                              ? `${currentPlayer.context.hiddenTagCount} tags hidden until purchase.`
                              : "Context fully unlocked."}
                        </div>
                        {activePlayerPhase === "scout" && mobileScoutSignals && (
                          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px" }}>
                              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 7, letterSpacing: 1 }}>ROLE FIT</div>
                              <div style={{ color: T.text, fontSize: 10, fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>{mobileScoutSignals.quickFacts[0]?.value}</div>
                            </div>
                            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px" }}>
                              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 7, letterSpacing: 1 }}>HIDDEN TAGS</div>
                              <div style={{ color: T.text, fontSize: 10, fontWeight: 700, lineHeight: 1.3, marginTop: 2 }}>{mobileScoutSignals.quickFacts[3]?.value}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activePlayerPhase === "revealed" && currentPlayer.context && (
                    <div style={{ padding: "0 14px 12px" }}>
                      <div style={{ background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px" }}>
                        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 1.6, marginBottom: 10 }}>
                          ANALYSIS
                        </div>

                        {currentPlayer.context?.phaseRatings && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 6 }}>PHASE RATINGS</div>
                            {[
                              { label: "PP", value: currentPlayer.context.phaseRatings.powerplay, color: T.blue },
                              { label: "Mid", value: currentPlayer.context.phaseRatings.middle, color: T.orange },
                              { label: "Death", value: currentPlayer.context.phaseRatings.death, color: T.green },
                            ].map((item) => (
                              <div key={`mobile-analysis-${item.label}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <span style={{ width: 36, flexShrink: 0, fontFamily: T.mono, fontSize: 10, color: T.textMid }}>{item.label}</span>
                                <ProgressBar value={item.value} color={item.color} height={5} />
                                <span style={{ width: 24, flexShrink: 0, textAlign: "right", fontFamily: T.mono, fontSize: 10, color: item.color }}>{item.value}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {(currentPlayer.context?.spinProfile?.total || 0) > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 6 }}>VS BOWLING TYPE</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 52, flexShrink: 0, color: T.textMid, fontSize: 10 }}>Spin</span>
                              <ProgressBar value={currentPlayer.context.spinProfile.spinShare || 0} color={T.orange} height={5} />
                              <span style={{ minWidth: 58, flexShrink: 0, textAlign: "right", color: T.orange, fontFamily: T.mono, fontSize: 10 }}>
                                {Math.round(Number(currentPlayer.context.spinProfile.vsSpin || 0))} ({Math.round(Number(currentPlayer.context.spinProfile.spinShare || 0))}%)
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 52, flexShrink: 0, color: T.textMid, fontSize: 10 }}>Fast</span>
                              <ProgressBar value={currentPlayer.context.spinProfile.fastShare || 0} color={T.blue} height={5} />
                              <span style={{ minWidth: 58, flexShrink: 0, textAlign: "right", color: T.blue, fontFamily: T.mono, fontSize: 10 }}>
                                {Math.round(Number(currentPlayer.context.spinProfile.vsFast || 0))} ({Math.round(Number(currentPlayer.context.spinProfile.fastShare || 0))}%)
                              </span>
                            </div>
                          </div>
                        )}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {(currentPlayer.context.exactTags || []).map((tag) => (
                            <span
                              key={`mobile-exact-${tag.label}`}
                              style={{
                                background: `${tag.tone === "good" ? T.green : T.red}14`,
                                border: `1px solid ${tag.tone === "good" ? T.green : T.red}28`,
                                color: tag.tone === "good" ? "#D9F99D" : "#FECACA",
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {currentPlayer.skills?.length > 0 && (
                    <div style={{ padding: "0 14px 8px", display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {currentPlayer.skills.slice(0, 3).map(s => (
                        <span key={s} style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textMid, fontFamily: T.font, fontSize: 10, padding: "2px 8px", borderRadius: 6 }}>{s}</span>
                      ))}
                    </div>
                  )}

                  {/* Leading notice */}
                  {auctionStatus === "BIDDING" && !isSpectatorMode && currentBidTeam === user.teamName && (
                    <div style={{ margin: "0 14px 12px", background: `${T.green}15`, border: `1px solid ${T.green}44`, borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                      <span style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: T.green }}>🎯 YOU HAVE THE HIGHEST BID!</span>
                    </div>
                  )}

                  {/* Spacer so sticky button doesn't cover content */}
                  {canBid && <div style={{ height: 88 }} />}
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 280 }}>
                  <div style={{ textAlign: "center", padding: 32 }}>
                    <div style={{ fontFamily: T.font, fontSize: 64, marginBottom: 12 }}>🏏</div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, letterSpacing: 2 }}>
                      {auctionStatus === "PAUSED" ? "⏸ AUCTION PAUSED" : auctionStatus === "WAITING" ? "AUCTION STARTING SOON..." : "SELECTING NEXT PLAYER..."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ANALYSIS TAB */}
          {mobileTab === "analysis" && (
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {!currentPlayer && !selectedMobileAnalysisPlayer && (
                <div style={{ background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 12px", color: T.textMid, fontSize: 12 }}>
                  Waiting for player nomination to show analysis.
                </div>
              )}

              {(currentPlayer || selectedMobileAnalysisPlayer) && (
                <div style={{ background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.5 }}>LIVE AUCTION NOW</div>
                      <div style={{ fontFamily: T.font, fontSize: 14, fontWeight: 800, color: T.text }}>{currentPlayer?.name || "Awaiting nomination"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1.3 }}>CURRENT BID</div>
                      <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800, color: T.gold }}>{formatPrice(currentBid || currentPlayer?.basePrice || 0)}</div>
                    </div>
                  </div>

                  {mobileAnalysisPool.length === 0 && (
                    <div style={{ background: `${T.orange}12`, border: `1px solid ${T.orange}33`, borderRadius: 10, padding: "10px 12px", color: T.textMid, fontSize: 12 }}>
                      Buy players to unlock full analysis cards here.
                    </div>
                  )}

                  {mobileAnalysisPool.length > 0 && (
                    <>
                      <div style={{ marginBottom: 10, background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 10px" }}>
                        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 8 }}>BOUGHT PLAYERS</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                          <div style={{ color: T.textMid, fontSize: 11 }}>Selected: <span style={{ color: T.text, fontWeight: 700 }}>{selectedMobileAnalysisPlayer?.name || "—"}</span></div>
                          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 9 }}>{mobileAnalysisPool.length} players</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
                          {[
                            { id: "all", label: "Squad" },
                            { id: "bat", label: "Bat" },
                            { id: "bowl", label: "Bowl" },
                            { id: "ar", label: "All" },
                            { id: "wk", label: "WK" },
                          ].map((tab) => (
                            <button
                              key={`mobile-analysis-filter-${tab.id}`}
                              onClick={() => setMobileAnalysisRoleFilter(tab.id)}
                              style={{
                                flexShrink: 0,
                                border: `1px solid ${mobileAnalysisRoleFilter === tab.id ? T.blue + "55" : T.border}`,
                                background: mobileAnalysisRoleFilter === tab.id ? `${T.blue}18` : "rgba(255,255,255,0.03)",
                                color: mobileAnalysisRoleFilter === tab.id ? T.blue : T.textMid,
                                borderRadius: 999,
                                padding: "5px 10px",
                                cursor: "pointer",
                                fontFamily: T.mono,
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: 0.8,
                                textTransform: "uppercase",
                              }}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                          {filteredMobileAnalysisPool.map((row) => (
                            <button
                              key={`mobile-analysis-player-${row.id}`}
                              onClick={() => setMobileAnalysisPlayerId(row.id)}
                              style={{
                                minWidth: 132,
                                flexShrink: 0,
                                textAlign: "left",
                                border: `1px solid ${mobileAnalysisPlayerId === row.id ? T.green + "66" : T.border}`,
                                background: mobileAnalysisPlayerId === row.id ? `${T.green}15` : "rgba(255,255,255,0.04)",
                                color: mobileAnalysisPlayerId === row.id ? T.green : T.text,
                                borderRadius: 10,
                                padding: "8px 10px",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, fontFamily: T.font, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {row.name}
                              </div>
                              <div style={{ fontSize: 9, fontFamily: T.mono, color: mobileAnalysisPlayerId === row.id ? T.green : T.textDim, marginTop: 3 }}>
                                {row.role}
                              </div>
                            </button>
                          ))}
                          {filteredMobileAnalysisPool.length === 0 && (
                            <div style={{ color: T.textDim, fontSize: 11, padding: "8px 0" }}>
                              No players in this role yet.
                            </div>
                          )}
                        </div>
                        <div style={{ color: T.textDim, fontSize: 10, marginTop: 6 }}>
                          Role tabs keep the squad browser clean even for big teams.
                        </div>
                      </div>

                      <div style={{ marginBottom: 10, background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 10px" }}>
                        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 8 }}>SELECTED PLAYER</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                          <div>
                            <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: T.text }}>{selectedMobileAnalysisPlayer?.name || "—"}</div>
                            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textMid }}>{selectedMobileAnalysisPlayer?.role || "—"}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim }}>BASE FP</div>
                            <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800, color: T.text }}>{Math.round(Number(selectedMobileAnalysisPlayer?.fairPoint || 0))}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {(selectedMobileAnalysisCtx?.exactTags || []).slice(0, 2).map((tag) => (
                            <span
                              key={`analysis-selected-tag-${tag.label}`}
                              style={{
                                background: `${tag.tone === "good" ? T.green : T.red}14`,
                                border: `1px solid ${tag.tone === "good" ? T.green : T.red}28`,
                                color: tag.tone === "good" ? "#D9F99D" : "#FECACA",
                                padding: "4px 8px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div style={{ marginBottom: 10, background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 10px" }}>
                        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 8 }}>MATCHUP ANALYSIS · OPPONENT SQUADS</div>
                        {mobileAnalysisMatchupRows.length > 0 ? (
                          mobileAnalysisMatchupRows.map((row) => (
                            <div key={`mobile-analysis-match-${row.name}-${row.label}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 110, flexShrink: 0, fontSize: 10, color: T.textMid, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</span>
                              <ProgressBar value={Math.min(100, row.runs * 2 || row.wickets * 18)} color={row.color} height={5} />
                              <span style={{ minWidth: 46, flexShrink: 0, textAlign: "right", color: row.color, fontFamily: T.mono, fontSize: 9 }}>{row.runs}r {row.wickets}w</span>
                            </div>
                          ))
                        ) : (
                          <div style={{ color: T.textMid, fontSize: 11, marginBottom: 8 }}>No direct rivalry data against opponent squads yet.</div>
                        )}
                        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 6 }}>WEAKNESS CLUES</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {mobileAnalysisWeaknessTags.length > 0 ? mobileAnalysisWeaknessTags.map((tag) => (
                            <span key={`mobile-analysis-weak-${tag}`} style={{ background: `${T.orange}14`, border: `1px solid ${T.orange}28`, color: "#FED7AA", padding: "3px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
                              {tag}
                            </span>
                          )) : (
                            <span style={{ color: T.textMid, fontSize: 11 }}>No weakness clue available.</span>
                          )}
                        </div>
                      </div>

                      {selectedMobileAnalysisCtx?.phaseRatings && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 6 }}>PHASE RATINGS</div>
                          {[
                            { label: "PP", value: selectedMobileAnalysisCtx.phaseRatings.powerplay, color: T.blue },
                            { label: "Mid", value: selectedMobileAnalysisCtx.phaseRatings.middle, color: T.orange },
                            { label: "Death", value: selectedMobileAnalysisCtx.phaseRatings.death, color: T.green },
                          ].map((item) => (
                            <div key={`analysis-tab-${item.label}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 36, flexShrink: 0, fontFamily: T.mono, fontSize: 10, color: T.textMid }}>{item.label}</span>
                              <ProgressBar value={item.value} color={item.color} height={5} />
                              <span style={{ width: 24, flexShrink: 0, textAlign: "right", fontFamily: T.mono, fontSize: 10, color: item.color }}>{item.value}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {(selectedMobileAnalysisCtx?.spinProfile?.total || 0) > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 6 }}>VS BOWLING TYPE</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <span style={{ width: 52, flexShrink: 0, color: T.textMid, fontSize: 10 }}>Spin</span>
                            <ProgressBar value={selectedMobileAnalysisCtx.spinProfile.spinShare || 0} color={T.orange} height={5} />
                            <span style={{ minWidth: 58, flexShrink: 0, textAlign: "right", color: T.orange, fontFamily: T.mono, fontSize: 10 }}>
                              {Math.round(Number(selectedMobileAnalysisCtx.spinProfile.vsSpin || 0))} ({Math.round(Number(selectedMobileAnalysisCtx.spinProfile.spinShare || 0))}%)
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 52, flexShrink: 0, color: T.textMid, fontSize: 10 }}>Fast</span>
                            <ProgressBar value={selectedMobileAnalysisCtx.spinProfile.fastShare || 0} color={T.blue} height={5} />
                            <span style={{ minWidth: 58, flexShrink: 0, textAlign: "right", color: T.blue, fontFamily: T.mono, fontSize: 10 }}>
                              {Math.round(Number(selectedMobileAnalysisCtx.spinProfile.vsFast || 0))} ({Math.round(Number(selectedMobileAnalysisCtx.spinProfile.fastShare || 0))}%)
                            </span>
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {(selectedMobileAnalysisCtx.exactTags || []).map((tag) => (
                          <span
                            key={`analysis-tab-tag-${tag.label}`}
                            style={{
                              background: `${tag.tone === "good" ? T.green : T.red}14`,
                              border: `1px solid ${tag.tone === "good" ? T.green : T.red}28`,
                              color: tag.tone === "good" ? "#D9F99D" : "#FECACA",
                              padding: "4px 8px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {tag.label}
                          </span>
                        ))}
                      </div>

                    </>
                  )}

                  <div style={{ marginTop: 10, background: T.bgGlass, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 10px" }}>
                    <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1.3, marginBottom: 8 }}>TEAM ANALYSIS</div>
                    {myStrength?.breakdown?.squadHealth?.metrics?.length > 0 ? (
                      <>
                        {(myStrength.breakdown.squadHealth.metrics || []).slice(0, 4).map((metric) => {
                          const c = metric.value >= 70 ? T.green : metric.value >= 45 ? T.orange : T.red;
                          return (
                            <div key={`mobile-team-${metric.key}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ width: 84, flexShrink: 0, color: T.textMid, fontSize: 10 }}>{metric.label}</span>
                              <ProgressBar value={metric.value} color={c} height={5} />
                              <span style={{ width: 22, flexShrink: 0, textAlign: "right", color: c, fontFamily: T.mono, fontSize: 10 }}>{metric.value}</span>
                            </div>
                          );
                        })}
                        <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                          {[
                            ["Pace", myStrength?.breakdown?.squadHealth?.preview?.vsPace, T.green],
                            ["Balanced", myStrength?.breakdown?.squadHealth?.preview?.vsBalanced, T.orange],
                            ["Spin", myStrength?.breakdown?.squadHealth?.preview?.vsSpin, T.red],
                          ].map(([label, value, color]) => (
                            <div key={`mobile-team-preview-${label}`} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                              <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 8 }}>{label}</div>
                              <div style={{ color, fontFamily: T.mono, fontSize: 14, fontWeight: 800 }}>{Math.round(Number(value) || 0)}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: T.textMid, fontSize: 11 }}>
                        Team analysis is loading. It appears after strength update from server.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TEAMS TAB */}
          {mobileTab === "teams" && (
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Teams & Purse</div>
              {teams.map(team => (
                <TeamRow key={team.teamName} team={team}
                  isLeading={currentBidTeam === team.teamName}
                  isMe={team.userId === user.userId}
                  isHost={isHost}
                  onKick={handleKick}
                  expandedTeam={expandedTeam}
                  setExpandedTeam={setExpandedTeam}
                  strength={teamStrengths[team.teamName]}
                  onSetXI={team.userId === user.userId && !isSpectatorMode ? () => setXiModal(true) : undefined} />
              ))}
            </div>
          )}

          {/* SETS TAB */}
          {mobileTab === "sets" && (
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Current Set</span>
                <span style={{ fontFamily: T.mono, fontSize: 11, color: currentPhaseColor, fontWeight: 700 }}>{currentSetConfig.short || currentSetCode}</span>
              </div>
              {setPoolPlayers.map(p => {
                const isDone = p.status === "done", isCurr = p.status === "current", isUp = p.status === "upcoming";
                const rc = ROLE_COLORS[p.role] || T.textMid;
                const canNom = isHost && isUp && ["WAITING","NOMINATING","SOLD","UNSOLD"].includes(auctionStatus);
                return (
                  <div key={p.leaguePlayerId}
                    onClick={() => canNom && handleNominate(p.leaguePlayerId)}
                    style={{
                      background: isCurr ? `${currentPhaseColor}14` : T.bgCard,
                      border: `1px solid ${isCurr ? currentPhaseColor+"44" : T.border}`,
                      borderRadius: 12, padding: "10px 14px",
                      display: "flex", alignItems: "center", gap: 10,
                      opacity: isDone ? 0.45 : 1, cursor: canNom ? "pointer" : "default",
                    }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: `${rc}20`, color: rc, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                      {(p.name || "?")[0]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 700, color: isDone ? T.textDim : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name} {isCurr && <span style={{ fontFamily: T.mono, fontSize: 8, color: currentPhaseColor, marginLeft: 4 }}>● LIVE</span>}
                      </div>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginTop: 2 }}>{p.role}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>{formatPrice(p.basePrice)}</div>
                      {canNom && <Gavel size={9} color={T.blue} style={{ marginTop: 2 }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* FEED TAB */}
          {mobileTab === "feed" && (
            <div style={{ padding: "10px 12px" }}>
              <LiveFeedPanel events={feedEvents} />
            </div>
          )}
        </div>

        {/* ─── STICKY BID BUTTON (mobile, always visible) ──────────────────── */}
        {mobileTab === "auction" && canBid && !soldOverlay && (
          <div style={{
            position: "sticky", bottom: 0, left: 0, right: 0, padding: "10px 14px 12px",
            background: "linear-gradient(0deg, #080C14 60%, rgba(8,12,20,0) 100%)",
            zIndex: 100, flexShrink: 0,
            animation: "slideUp 0.3s ease",
          }}>
            {/* Purse danger warning (mobile) */}
            {myTeam && (remainingPurse - minNextBid) < 200 && (
              <div style={{
                background: `${T.orange}18`, border: `1px solid ${T.orange}44`,
                borderRadius: 9, padding: "6px 10px", marginBottom: 8,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <AlertTriangle size={12} color={T.orange} />
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.orange, fontWeight: 700 }}>
                  Low purse — {formatPrice(Math.max(0, remainingPurse - minNextBid))} left after bid
                </span>
              </div>
            )}
            <BidButton amount={minNextBid} onClick={() => placeBid(minNextBid)} />
          </div>
        )}

        {/* Chat FAB */}
        {mobileTab === "auction" && (
          <button onClick={() => { setShowMobileChat(true); setUnreadChatCount(0); chatVisibleRef.current = true; }}
            style={{
              position: "fixed", right: 16, bottom: canBid ? 90 : 16, zIndex: 90,
              background: `linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,
              border: "none", cursor: "pointer", width: 48, height: 48, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 20px ${T.blue}44`,
              transition: "bottom 0.3s ease",
            }}>
            <MessageCircle size={20} color="#fff" />
            {unreadChatCount > 0 && (
              <div style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, borderRadius: "50%", background: T.red, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 8, color: "#fff", fontWeight: 700 }}>
                {unreadChatCount > 9 ? "9+" : unreadChatCount}
              </div>
            )}
          </button>
        )}
      </div>

      {/* ── XI Select Modal (own team, available during + after auction) ── */}
      {xiModal && myTeam && (
        <XISelectModal
          team={myTeam}
          socket={socket}
          roomCode={code}
          userId={user.userId}
          strengthData={teamStrengths[myTeam.teamName]}
          onClose={() => setXiModal(false)}
          onStrengthUpdate={(data) => {
            setTeamStrengths(prev => ({
              ...prev,
              [myTeam.teamName]: { ...(prev[myTeam.teamName] || {}), ...data },
            }));
          }}
        />
      )}

      {/* ── Mobile Chat Sheet ────────────────────────────────────────────────── */}
      {showMobileChat && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => { setShowMobileChat(false); chatVisibleRef.current = false; }}>
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            background: T.bgCard, borderRadius: "20px 20px 0 0",
            border: `1px solid ${T.borderHi}`, height: "70vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
            animation: "slideUp 0.3s ease",
          }} onClick={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
              <div style={{ width: 36, height: 4, borderRadius: 99, background: T.border }} />
            </div>
            <button onClick={() => { setShowMobileChat(false); chatVisibleRef.current = false; }}
              style={{ position: "absolute", top: 14, right: 14, background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textDim, cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" }}>
              <X size={15} />
            </button>
            <ChatPanel />
          </div>
        </div>
      )}
    </div>
  );
}
