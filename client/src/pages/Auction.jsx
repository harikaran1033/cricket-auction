import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Gavel, AlertTriangle, TrendingUp, Wallet, Trophy, Pause, Play, ChevronRight, Zap, UserMinus, ChevronDown, Clock, Users, BarChart2, MessageCircle, X, Shield, Flame, Star } from "lucide-react";
import { useUser } from "../context/UserContext";
import { useSocket } from "../context/SocketContext";
import { useAudio } from "../context/AudioContext";
import { COLORS, ROLE_COLORS, SET_CONFIG, PHASE_LABELS, PHASE_COLORS, formatPrice } from "../data/constants";
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

// Role icon/color helper (abbreviated)
const roleColor = (role) => ROLE_COLORS[role] || T.blue;

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

// ─── Pulsing bid price ─────────────────────────────────────────────────────
function BidPrice({ amount, pulsing }) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 42, fontWeight: 900, lineHeight: 1,
      color: T.gold,
      textShadow: pulsing ? `0 0 40px ${T.gold}, 0 0 80px ${T.goldDim}` : `0 0 20px ${T.goldDim}55`,
      display: "inline-block",
      transform: pulsing ? "scale(1.08)" : "scale(1)",
      transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1), text-shadow 0.3s ease",
    }}>{formatPrice(amount)}</span>
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
function PlayerCard({ player, currentBid, currentBidTeam, timerRemaining, timerDuration, isPricePulsing, auctionStatus, user, teams }) {
  const tColor = timerRemaining <= 5 ? T.red : timerRemaining <= 10 ? T.orange : T.green;
  const leadingTeam = currentBidTeam ? teams.find(t => t.teamName === currentBidTeam) : null;
  const timerDisplay = String(Math.max(0, Math.min(99, Math.ceil(Number(timerRemaining) || 0)))).padStart(2, "0");

  return (
    <GCard glow={roleColor(player.role)} style={{ overflow: "hidden" }}>

      {/* ── Hero: full-width broadcast-style strip ── */}
      <div style={{ position: "relative", height: 280, background: T.bgCard }}>

        {/* Layer 0 - soft atmospheric image layer for seamless blending */}
        {player.image && (
          <img
            src={player.image}
            alt=""
            aria-hidden="true"
            loading="eager"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center 18%",
              display: "block",
              zIndex: 0,
              opacity: 0.22,
              filter: "blur(10px) saturate(0.92) brightness(0.9)",
              transform: "scale(1.08)",
            }}
          />
        )}

        {/* Layer 1 - sharp player image, anchored right and faded into background */}
        {player.image && (
          <img
            src={player.image} alt={player.name}
            loading="eager" fetchPriority="high"
            style={{
              position: "absolute",
              right: 0, bottom: 0,
              height: "100%",
              width: "54%",
              objectFit: "cover",
              objectPosition: "center 15%",
              display: "block",
              zIndex: 1,
              opacity: 0.94,
              filter: "saturate(1.04) contrast(1.03) brightness(0.98)",
              WebkitMaskImage: "linear-gradient(to left, #000 0%, #000 62%, rgba(0,0,0,0.72) 78%, rgba(0,0,0,0.28) 90%, transparent 100%)",
              maskImage: "linear-gradient(to left, #000 0%, #000 62%, rgba(0,0,0,0.72) 78%, rgba(0,0,0,0.28) 90%, transparent 100%)",
            }}
          />
        )}
        {!player.image && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `radial-gradient(ellipse at 70% 50%, ${roleColor(player.role)}30 0%, transparent 65%)`,
          }}>
            <span style={{ fontFamily: T.mono, fontSize: 88, color: `${roleColor(player.role)}33`, fontWeight: 900, marginLeft: "30%" }}>
              {(player.name || "").split(" ").filter(Boolean).slice(0,2).map(p=>p[0]).join("").toUpperCase()}
            </span>
          </div>
        )}

        {/* Layer 1 — strong left→right gradient: fades image into card bg on the left */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: `linear-gradient(to right,
            ${T.bgCard} 0%,
            ${T.bgCard} 28%,
            rgba(13,20,34,0.92) 40%,
            rgba(13,20,34,0.65) 52%,
            rgba(13,20,34,0.25) 65%,
            transparent 78%
          )`,
        }} />

        {/* Layer 2 — top fade so image doesn't start hard at the top edge */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: `linear-gradient(to bottom,
            ${T.bgCard} 0%,
            rgba(13,20,34,0.7) 14%,
            transparent 32%
          )`,
        }} />

        {/* Layer 3 — bottom fade into the bid row below */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 100,
          zIndex: 2, pointerEvents: "none",
          background: `linear-gradient(to top, ${T.bgCard} 0%, transparent 100%)`,
        }} />

        {/* Layer 4 — role-colour atmospheric tint from left */}
        <div style={{
          position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: `radial-gradient(ellipse at 0% 60%, ${roleColor(player.role)}1a 0%, transparent 55%)`,
        }} />

        {/* Layer 5 — INFO: sits over all gradients, left side */}
        <div style={{
          position: "absolute", zIndex: 5,
          left: 0, top: 0, bottom: 0, width: "62%",
          padding: "20px 16px 20px 24px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}>
          {/* Badges row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            <Badge color={roleColor(player.role)}>{player.role}</Badge>
            {player.jerseyNumber && <Badge color={T.blue}>#{player.jerseyNumber}</Badge>}
            {player.isOverseas && <Badge color={T.orange}>OVERSEAS</Badge>}
            {player.isCapped === false && <Badge color={T.purple}>UNCAPPED</Badge>}
            {player.fairPoint > 0 && (
              <Badge color={T.gold}><TrendingUp size={9} /> FP {player.fairPoint.toFixed(1)}</Badge>
            )}
          </div>

          {/* Name + meta */}
          <div>
            <div style={{
              fontFamily: T.font, fontWeight: 900, color: T.text,
              fontSize: 32, letterSpacing: 0.5, lineHeight: 1.05,
              textTransform: "uppercase", marginBottom: 10,
            }}>{player.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMid, lineHeight: 1.9 }}>
              {player.nationality}
              {player.previousTeam && (
                <><br /><span style={{ color: T.cyan }}>Prev: {player.previousTeam}</span></>
              )}
              <br />Base: <span style={{ color: T.gold, fontWeight: 700 }}>{formatPrice(player.basePrice)}</span>
            </div>
          </div>

          {/* Skills */}
          {player.skills?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {player.skills.map(s => (
                <span key={s} style={{
                  background: "rgba(255,255,255,0.07)", color: T.textMid,
                  fontSize: 10, padding: "2px 9px", borderRadius: 6,
                  border: `1px solid ${T.border}`,
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Timer arc — top-right corner, highest z */}
        <div style={{ position: "absolute", top: 14, right: 14, zIndex: 10 }}>
          <div style={{ position: "relative" }}>
            <TimerArc remaining={timerRemaining} total={timerDuration} color={tColor} />
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{
                fontFamily: T.mono, fontSize: 17, fontWeight: 900, color: tColor, lineHeight: 1,
                textShadow: timerRemaining <= 5 ? `0 0 20px ${tColor}` : "none",
              }}>{timerDisplay}</span>
              <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 1 }}>SEC</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bid row */}
      <div style={{ padding: "14px 22px 18px", display: "flex", alignItems: "center", gap: 20, borderTop: `1px solid ${T.border}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Current Bid</div>
          <BidPrice amount={currentBid} pulsing={isPricePulsing} />
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

        {/* Timer bar vertical accent */}
        <div style={{ width: 3, height: 54, borderRadius: 99, background: `${tColor}22`, overflow: "hidden" }}>
          <div style={{ width: "100%", height: `${timerDuration > 0 ? (Math.max(0, Number(timerRemaining) || 0) / timerDuration) * 100 : 0}%`, background: tColor, borderRadius: 99, transition: "height 0.9s linear", boxShadow: `0 0 8px ${tColor}` }} />
        </div>
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
function TeamRow({ team, isLeading, isMe, isHost, onKick, expandedTeam, setExpandedTeam }) {
  const tColor = isMe ? T.blue : T.textMid;
  const remaining = team.remainingPurse || 0;
  const total = team.totalPurse || 1;
  const pctLeft = (remaining / total) * 100;
  const barColor = pctLeft < 20 ? T.red : pctLeft < 50 ? T.orange : T.green;
  const isExpanded = expandedTeam === team.teamName;
  const squad = team.squad || [];

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
            background: `${tColor}22`, color: tColor, border: `1px solid ${tColor}44`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: T.font, fontSize: 14, fontWeight: 800,
          }}>
            {(team.teamShortName || team.teamName || "?")[0]}
          </div>

          {/* Name + status */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.font, fontSize: 13, fontWeight: 800, color: isLeading ? T.green : T.text, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {team.teamShortName || team.teamName}
            </div>
            {isLeading && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.green, letterSpacing: 1 }}>🏏 LEADING BID</div>}
          </div>

          {/* Purse + squad count */}
          <div style={{ textAlign: "right", marginRight: 4 }}>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.gold, fontWeight: 700 }}>{formatPrice(remaining)}</div>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim }}>{team.squadSize ?? squad.length ?? 0} pl</div>
          </div>

          {/* Kick button */}
          {isHost && !isMe && (
            <button onClick={e => { e.stopPropagation(); onKick(team.userId); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: T.red, padding: 4, borderRadius: 6 }}>
              <UserMinus size={13} />
            </button>
          )}
          <ChevronDown size={13} style={{ color: T.textDim, transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "none", flexShrink: 0 }} />
        </div>

        {/* Purse bar */}
        <div style={{ marginTop: 8, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)" }}>
          <div style={{ height: "100%", width: `${pctLeft}%`, borderRadius: 99, background: barColor, transition: "width 0.6s ease, background 0.4s" }} />
        </div>
      </div>

      {/* Expanded squad */}
      {isExpanded && (
        <div style={{ borderTop: `1px solid ${T.border}`, background: "#060912", padding: "10px 14px", maxHeight: 180, overflowY: "auto" }}>
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
  return (
    <div style={{ display: "flex", gap: 8, flexDirection: isMe ? "row-reverse" : "row" }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: `${T.blue}22`, color: T.blue, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
        {(msg.userName || "?")[0]}
      </div>
      <div>
        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, marginBottom: 2, textAlign: isMe ? "right" : "left" }}>{msg.userName}</div>
        <div style={{
          background: isMe ? `${T.blue}20` : T.bgGlass2,
          border: `1px solid ${isMe ? T.blue + "33" : T.border}`,
          color: T.text, fontFamily: T.font, fontSize: 12, lineHeight: 1.5,
          padding: "7px 12px", borderRadius: isMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
          maxWidth: 200,
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
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(5,8,18,0.9)", backdropFilter: "blur(16px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ textAlign: "center", animation: "popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, color, letterSpacing: 4, textTransform: "uppercase", marginBottom: 12 }}>
          {PHASE_LABELS[transition.phase] || "NEXT SET"}
        </div>
        <div style={{ fontFamily: T.font, fontSize: 52, fontWeight: 900, color: T.text, textShadow: `0 0 40px ${color}`, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>
          {transition.setName}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.textMid }}>
          {transition.playersInSet} player{transition.playersInSet !== 1 ? "s" : ""} in this set
        </div>
        {transition.isAccelerated && (
          <div style={{ color: T.orange, marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700, fontFamily: T.font }}>
            <Zap size={18} /> Reduced base prices apply
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RTM banner ──────────────────────────────────────────────────────────────
function RtmBanner({ rtmPending, currentPlayer, onRtm, formatPrice }) {
  return (
    <GCard glow={T.gold} style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `${T.gold}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AlertTriangle size={20} color={T.gold} />
          </div>
          <div>
            <div style={{ fontFamily: T.font, fontSize: 15, fontWeight: 800, color: T.gold, letterSpacing: 1 }}>RIGHT TO MATCH AVAILABLE</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.textMid, marginTop: 2 }}>Match {formatPrice(rtmPending?.currentBid)} to reclaim {currentPlayer?.name}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => onRtm("use")}
            style={{ background: `linear-gradient(135deg, ${T.gold}, ${T.goldDim})`, color: "#000", border: "none", cursor: "pointer", padding: "10px 20px", borderRadius: 10, fontFamily: T.font, fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>
            USE RTM · {formatPrice(rtmPending?.currentBid)}
          </button>
          <button onClick={() => onRtm("pass")}
            style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.text, cursor: "pointer", padding: "10px 20px", borderRadius: 10, fontFamily: T.font, fontSize: 14, fontWeight: 700 }}>
            PASS
          </button>
        </div>
      </div>
    </GCard>
  );
}

// ─── Set players list ─────────────────────────────────────────────────────────
function SetPlayersList({ players, auctionStatus, isHost, currentPhaseColor, currentSetConfig, onNominate }) {
  const [open, setOpen] = useState(true);
  if (!players.length) return null;
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
          {players.map(p => {
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
        </div>
      )}
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
  const [chatInput, setChatInput] = useState("");
  const [timerDuration, setTimerDuration] = useState(15);
  const [playerImageReady, setPlayerImageReady] = useState(false);

  const chatEndRef = useRef(null);
  const timerRef = useRef(null);
  const timerEndRef = useRef(null);
  const prevTimerSecRef = useRef(-1);

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
      setCurrentPlayer(data.player);
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
    socket.on("auction:playerUnsold", (data) => {
      clearClientTimer(); setAuctionStatus("UNSOLD");
      setSoldOverlay({ type: "unsold", player: data.player });
      setStats(s => ({ ...s, totalPlayersUnsold: s.totalPlayersUnsold + 1 }));
      playUnsoldSound();
      setTimeout(() => setSoldOverlay(null), 3000);
    });
    socket.on("auction:rtmPending", (data) => {
      clearClientTimer(); setAuctionStatus("RTM_PENDING");
      setRtmPending(data); startClientTimer(data.timerEndsAt);
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
    socket.on("chat:message", (msg) => setChatMessages(prev => [...prev, msg]));
    return () => {
      clearClientTimer();
      ["auction:playerNominated","auction:bidPlaced","auction:playerSold","auction:playerUnsold",
       "auction:rtmPending","auction:timerTick","auction:paused","auction:resumed",
       "auction:completed","auction:error","auction:state","auction:setChanged","auction:timerChanged",
       "room:updated","room:userJoined","room:teamKicked","chat:message","chat:history","activity:history"
      ].forEach(e => socket.off(e));
    };
  }, [socket, code, isSpectatorMode]);

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

  useEffect(() => {
    if (!currentPlayer?.image) { setPlayerImageReady(false); return; }
    setPlayerImageReady(false);
    const img = new Image();
    img.src = currentPlayer.image;
    img.onload = () => setPlayerImageReady(true);
    img.onerror = () => setPlayerImageReady(true);
    return () => { img.onload = null; img.onerror = null; };
  }, [currentPlayer?.image]);

  const applyAuctionState = (state) => {
    setAuctionStatus(state.status);
    if (state.currentLeaguePlayer?.player) {
      const p = state.currentLeaguePlayer.player;
      setCurrentPlayer({ playerId: p._id, name: p.name, nationality: p.nationality, isOverseas: p.isOverseas, isCapped: p.isCapped, role: p.role, image: p.image, skills: p.skills || [], basePrice: state.currentLeaguePlayer.basePrice || p.basePrice, previousTeam: state.currentLeaguePlayer.previousTeam || "", stats2024: state.currentLeaguePlayer.stats2024 || null, stats2025: state.currentLeaguePlayer.stats2025 || null, fairPoint: state.currentLeaguePlayer.fairPoint || 0, jerseyNumber: p.jerseyNumber || null });
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
    socket.emit(action === "use" ? "auction:rtmUse" : "auction:rtmPass", { roomCode: code, userId: user.userId, teamName: user.teamName });
  }, [socket, code, user, isSpectatorMode]);

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
    socket.emit("chat:send", { roomCode: code, userId: user.userId, userName: user.userName, teamName: user.teamName, message: chatInput });
    setChatInput("");
  };

  const canBid = !isSpectatorMode && auctionStatus === "BIDDING" && currentBidTeam !== user.teamName && myTeam && remainingPurse >= minNextBid;
  const isRtmEligible = !isSpectatorMode && auctionStatus === "RTM_PENDING" && rtmPending?.rtmTeam === user.teamName;
  const timerColor = timerRemaining <= 5 ? T.red : timerRemaining <= 10 ? T.orange : T.green;
  const timerDisplay = String(Math.max(0, Math.min(99, Math.ceil(Number(timerRemaining) || 0)))).padStart(2, "0");

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
        </div>
      </div>
    );
  }

  // ── Chat panel (shared desktop + mobile) ──────────────────────────────────
  const ChatPanel = () => (
    <>
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 16px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.green, animation: "pulse 2s infinite" }} />
        <span style={{ fontFamily: T.font, fontSize: 13, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: 1 }}>Live Chat</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, marginLeft: "auto" }}>{chatMessages.length} msgs</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {chatMessages.length === 0 && (
          <div style={{ textAlign: "center", color: T.textDim, fontFamily: T.mono, fontSize: 11, marginTop: 20 }}>No messages yet</div>
        )}
        {chatMessages.map((msg, i) => <ChatMsg key={msg._id || i} msg={msg} isMe={msg.userId === user.userId} />)}
        <div ref={chatEndRef} />
      </div>
      {!isSpectatorMode && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 12px", flexShrink: 0, display: "flex", gap: 8 }}>
          <input type="text" placeholder="Type a message..." value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendChat()}
            style={{ flex: 1, background: T.bgGlass2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 12px", fontFamily: T.font, fontSize: 13, color: T.text, outline: "none" }} />
          <button onClick={sendChat}
            style={{ background: `linear-gradient(135deg, ${T.blue}, ${T.blueDim})`, border: "none", cursor: "pointer", padding: "9px 12px", borderRadius: 10, color: "#fff", display: "flex", alignItems: "center" }}>
            <Send size={15} />
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
        <button onClick={() => navigate(`/room/${code}/lobby`)}
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
        <SoundControls compact />
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

      <ParticleEffect active={showParticles} color={particleColor} count={60} />
      <SetSplash transition={setTransition} />

      <TopBar />
      <SetStrip setInfo={setInfo} />

      {/* ── DESKTOP LAYOUT (lg+) ────────────────────────────────────────── */}
      <div style={{ display: "none", flex: 1, overflow: "hidden", minHeight: 0 }} className="desktop-layout">
        <style>{`@media(min-width:1024px){.desktop-layout{display:flex!important}.mobile-layout{display:none!important}}`}</style>

        {/* LEFT: Teams */}
        <div style={{ width: 260, borderRight: `1px solid ${T.border}`, overflowY: "auto", padding: "14px 12px", flexShrink: 0 }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.textDim, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>Teams & Purse</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {teams.map(team => (
              <TeamRow key={team.teamName} team={team}
                isLeading={currentBidTeam === team.teamName}
                isMe={team.userId === user.userId}
                isHost={isHost}
                onKick={handleKick}
                expandedTeam={expandedTeam}
                setExpandedTeam={setExpandedTeam} />
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
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
          <SoldOverlay overlay={soldOverlay} />

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
              teams={teams} />
          ) : (
            <GCard style={{ padding: "60px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.textDim, letterSpacing: 2 }}>
                {auctionStatus === "PAUSED" ? "⏸ AUCTION PAUSED" : auctionStatus === "WAITING" ? "AUCTION STARTING SOON..." : "SELECTING NEXT PLAYER..."}
              </div>
            </GCard>
          )}

          {/* RTM */}
          {isRtmEligible && <RtmBanner rtmPending={rtmPending} currentPlayer={currentPlayer} onRtm={handleRtm} formatPrice={formatPrice} />}

          {/* Bid button */}
          {canBid && !soldOverlay && (
            <GCard style={{ padding: "16px 20px" }}>
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

        {/* RIGHT: Chat */}
        <div style={{ width: 280, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: "#060912" }}>
          <ChatPanel />
        </div>
      </div>

      {/* ── MOBILE LAYOUT ──────────────────────────────────────────────────── */}
      <div className="mobile-layout" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <style>{`@media(min-width:1024px){.mobile-layout{display:none!important}}`}</style>

        {/* Tab bar */}
        <div style={{ background: "#060912", borderBottom: `1px solid ${T.border}`, display: "flex", flexShrink: 0 }}>
          {[
            { id: "auction", label: "Auction", icon: <Gavel size={14} /> },
            { id: "teams",   label: "Teams",   icon: <Users size={14} /> },
            { id: "sets",    label: "Sets",    icon: <BarChart2 size={14} /> },
          ].map(tab => (
            <button key={tab.id} onClick={() => setMobileTab(tab.id)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "10px 0", background: "none", border: "none", cursor: "pointer",
                fontFamily: T.font, fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                color: mobileTab === tab.id ? T.gold : T.textDim,
                borderBottom: `2px solid ${mobileTab === tab.id ? T.gold : "transparent"}`,
                transition: "color 0.2s, border-color 0.2s",
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, position: "relative" }}>

          {/* AUCTION TAB */}
          {mobileTab === "auction" && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <SoldOverlay overlay={soldOverlay} />

              {currentPlayer && auctionStatus !== "PAUSED" ? (
                <>
                  {/* Hero image */}
                  <div style={{ position: "relative", height: 200, background: `radial-gradient(ellipse at 30% 0%, ${roleColor(currentPlayer.role)}44 0%, transparent 60%), #080C14`, overflow: "hidden", flexShrink: 0 }}>
                    {currentPlayer.image ? (
                      <img src={currentPlayer.image} alt={currentPlayer.name} loading="eager" fetchPriority="high"
                        style={{ position: "absolute", right: 0, bottom: 0, height: "100%", width: "45%", objectFit: "cover", objectPosition: "top" }} />
                    ) : (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontFamily: T.mono, fontSize: 56, color: `${roleColor(currentPlayer.role)}66` }}>
                          {(currentPlayer.name || "").split(" ").filter(Boolean).slice(0,2).map(p=>p[0]).join("").toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #080C14 40%, transparent 70%)" }} />
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, background: "linear-gradient(0deg, #080C14 0%, transparent 100%)" }} />

                    {/* Badges + name overlaid */}
                    <div style={{ position: "absolute", bottom: 16, left: 14, right: "45%" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                        <Badge color={roleColor(currentPlayer.role)}>{currentPlayer.role}</Badge>
                        {currentPlayer.jerseyNumber && <Badge color={T.blue}>#{currentPlayer.jerseyNumber}</Badge>}
                        {currentPlayer.isOverseas && <Badge color={T.orange}>OS</Badge>}
                        {currentPlayer.isCapped === false && <Badge color={T.purple}>UC</Badge>}
                        {currentPlayer.fairPoint > 0 && <Badge color={T.gold}><TrendingUp size={8} /> {currentPlayer.fairPoint.toFixed(1)}</Badge>}
                      </div>
                      <div style={{ fontFamily: T.font, fontSize: 20, fontWeight: 900, color: T.text, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.1 }}>{currentPlayer.name}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.textMid, marginTop: 3 }}>
                        {currentPlayer.nationality} · Base <span style={{ color: T.gold }}>{formatPrice(currentPlayer.basePrice)}</span>
                      </div>
                    </div>

                    {/* Timer arc top-right */}
                    <div style={{ position: "absolute", top: 12, right: 12 }}>
                      <div style={{ position: "relative" }}>
                        <TimerArc remaining={timerRemaining} total={timerDuration} color={timerColor} />
                        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 900, color: timerColor, lineHeight: 1 }}>{timerDisplay}</span>
                          <span style={{ fontFamily: T.mono, fontSize: 7, color: T.textDim }}>SEC</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bid info row */}
                  <div style={{ padding: "14px 14px 10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ background: `${T.blue}12`, border: `1px solid ${T.blue}22`, borderRadius: 12, padding: "10px 14px" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textDim, letterSpacing: 2, marginBottom: 4 }}>CURRENT BID</div>
                      <div style={{ fontFamily: T.mono, fontSize: 22, color: T.gold, fontWeight: 900, textShadow: `0 0 20px ${T.goldDim}` }}>{formatPrice(currentBid)}</div>
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
                  <div style={{ padding: "0 14px 12px" }}>
                    <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${timerDuration > 0 ? (timerRemaining/timerDuration)*100 : 0}%`, background: `linear-gradient(90deg, ${timerColor}, ${timerColor}88)`, borderRadius: 99, transition: "width 0.9s linear, background 0.5s" }} />
                    </div>
                  </div>

                  {/* Skills */}
                  {currentPlayer.skills?.length > 0 && (
                    <div style={{ padding: "0 14px 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {currentPlayer.skills.slice(0,4).map(s => (
                        <span key={s} style={{ background: T.bgGlass2, border: `1px solid ${T.border}`, color: T.textMid, fontFamily: T.font, fontSize: 10, padding: "2px 8px", borderRadius: 6 }}>{s}</span>
                      ))}
                    </div>
                  )}

                  {/* RTM */}
                  {isRtmEligible && (
                    <div style={{ padding: "0 14px 12px" }}>
                      <RtmBanner rtmPending={rtmPending} currentPlayer={currentPlayer} onRtm={handleRtm} formatPrice={formatPrice} />
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
                  setExpandedTeam={setExpandedTeam} />
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
        </div>

        {/* ─── STICKY BID BUTTON (mobile, always visible) ──────────────────── */}
        {mobileTab === "auction" && canBid && !soldOverlay && (
          <div style={{
            position: "sticky", bottom: 0, left: 0, right: 0, padding: "10px 14px 12px",
            background: "linear-gradient(0deg, #080C14 60%, rgba(8,12,20,0) 100%)",
            zIndex: 100, flexShrink: 0,
            animation: "slideUp 0.3s ease",
          }}>
            <BidButton amount={minNextBid} onClick={() => placeBid(minNextBid)} />
          </div>
        )}

        {/* Chat FAB */}
        {mobileTab === "auction" && (
          <button onClick={() => setShowMobileChat(true)}
            style={{
              position: "fixed", right: 16, bottom: canBid ? 90 : 16, zIndex: 90,
              background: `linear-gradient(135deg, ${T.blue}, ${T.blueDim})`,
              border: "none", cursor: "pointer", width: 48, height: 48, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 20px ${T.blue}44`,
              transition: "bottom 0.3s ease",
            }}>
            <MessageCircle size={20} color="#fff" />
            {chatMessages.length > 0 && (
              <div style={{ position: "absolute", top: 0, right: 0, width: 16, height: 16, borderRadius: "50%", background: T.red, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 8, color: "#fff", fontWeight: 700 }}>
                {chatMessages.length > 9 ? "9+" : chatMessages.length}
              </div>
            )}
          </button>
        )}
      </div>

      {/* ── Mobile Chat Sheet ────────────────────────────────────────────────── */}
      {showMobileChat && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowMobileChat(false)}>
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
            <button onClick={() => setShowMobileChat(false)}
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
