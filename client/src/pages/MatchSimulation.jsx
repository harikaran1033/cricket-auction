/**
 * MatchSimulation.jsx — Playing XI selection, team strength, and match simulation.
 *
 * Flow:
 *  1. Load team strengths from backend (all teams' profiles + ratings)
 *  2. User selects their Playing XI, Captain, Vice-Captain
 *  3. Real-time strength preview updates as selections change
 *  4. Host triggers match simulation → results broadcast to all via socket
 *  5. Match results shown with leaderboard + fatigue/injury feed
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Trophy, Shield, Zap, Star, TrendingUp, Users, AlertTriangle,
  CheckCircle2, Crown, ChevronRight, BarChart2, Activity, ArrowLeft,
  Flame, Wind, Heart, Target
} from "lucide-react";
import { useSocket } from "../context/SocketContext";
import { useUser } from "../context/UserContext";
import { api } from "../services/api";
import { COLORS, ROLE_COLORS, formatPrice } from "../data/constants";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:       "#080C14",
  card:     "#0D1422",
  glass:    "rgba(255,255,255,0.04)",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.15)",
  gold:     "#F5C842",
  green:    "#22C55E",
  red:      "#EF4444",
  cyan:     "#06B6D4",
  purple:   "#A855F7",
  orange:   "#F97316",
  text:     "#F1F5F9",
  mid:      "#94A3B8",
  dim:      "#475569",
  mono:     "'JetBrains Mono', monospace",
  sans:     "'Inter', sans-serif",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const roleColor = (role) => ROLE_COLORS[role] || T.cyan;
const Pill = ({ color, children }) => (
  <span style={{
    background: `${color}18`, color, border: `1px solid ${color}40`,
    fontFamily: T.mono, fontSize: 10, fontWeight: 700,
    padding: "2px 8px", borderRadius: 99, letterSpacing: 0.5,
  }}>{children}</span>
);

function ConsistencyBar({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? T.green : pct >= 50 ? T.gold : T.orange;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: T.border, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99,
          transition: "width 0.4s ease" }} />
      </div>
      <span style={{ color, fontFamily: T.mono, fontSize: 10, minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

function RatingRing({ value, size = 44, color }) {
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = clamp(value || 0, 0, 100) / 100;
  const c = color || (value >= 75 ? T.green : value >= 50 ? T.cyan : T.orange);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={T.border} strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={c} strokeWidth={5}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.4s ease" }} />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle"
        style={{ fill: c, fontFamily: T.mono, fontSize: 11, fontWeight: 700 }}>
        {Math.round(value || 0)}
      </text>
    </svg>
  );
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function StrengthBar({ breakdown, playersPerTeam }) {
  if (!breakdown) return null;
  const { total, playingXIPoints, teamFairplay, penaltyFactor, penalties,
    compositionPenalties, compositionReduction, warnings,
    xiBreakdown, squadHealth } = breakdown;

  // Max possible for reference bar (11 players × 100 FP + captain bonus)
  const maxPossible = 100 * 11 + 100 * 1.0 + 100 * 0.5; // ~1250
  const barPct = Math.min(100, (total / maxPossible) * 100);
  const barColor = total >= 700 ? T.green : total >= 500 ? T.cyan : total >= 300 ? T.orange : T.red;

  return (
    <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
      {/* Header with total */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ color: T.mid, fontSize: 10, fontFamily: T.mono, letterSpacing: 1 }}>FANTASY STRENGTH</span>
        <div style={{ textAlign: "right" }}>
          <span style={{ color: T.gold, fontFamily: T.mono, fontWeight: 900, fontSize: 22 }}>
            {total?.toFixed(0)}
          </span>
          <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 10, marginLeft: 4 }}>pts</span>
        </div>
      </div>

      {/* Strength bar */}
      <div style={{ height: 6, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.06)", marginBottom: 8 }}>
        <div style={{ height: "100%", background: barColor, borderRadius: 99,
          width: `${barPct}%`, transition: "width 0.4s ease" }} />
      </div>

      {/* XI Raw vs Final */}
      {compositionReduction > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8,
          background: `${T.red}10`, border: `1px solid ${T.red}25`, borderRadius: 8, padding: "6px 10px" }}>
          <span style={{ color: T.mid, fontFamily: T.mono, fontSize: 10 }}>
            XI Total: <span style={{ color: T.cyan }}>{playingXIPoints?.toFixed(0)}</span>
          </span>
          <span style={{ color: T.red, fontFamily: T.mono, fontSize: 10, fontWeight: 700 }}>
            -{compositionReduction}% penalty
          </span>
        </div>
      )}

      {/* Player contributions */}
      {xiBreakdown && xiBreakdown.length > 0 && (
        <div style={{ marginTop: 4, maxHeight: 180, overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1 }}>PLAYER</span>
            <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1 }}>FP → PTS</span>
          </div>
          {xiBreakdown.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3,
              padding: "2px 4px", borderRadius: 4,
              background: p.captainRole ? `${p.captainRole === "captain" ? T.gold : T.purple}10` : "transparent" }}>
              <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 9, minWidth: 16 }}>#{p.slot}</span>
              <span style={{ color: T.text, fontSize: 10, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: p.captainRole ? 700 : 400 }}>
                {p.name}
              </span>
              {p.captainRole === "captain" && <span style={{ color: T.gold, fontSize: 8, fontWeight: 900, background: `${T.gold}22`, padding: "0 4px", borderRadius: 4 }}>C</span>}
              {p.captainRole === "vice-captain" && <span style={{ color: T.purple, fontSize: 8, fontWeight: 900, background: `${T.purple}22`, padding: "0 4px", borderRadius: 4 }}>VC</span>}
              <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 9, minWidth: 24, textAlign: "right" }}>{p.baseFP}</span>
              <span style={{ color: T.dim, fontSize: 9 }}>→</span>
              <span style={{ color: p.positionFit === "ideal" ? T.green : p.positionFit === "near" ? T.orange : T.red,
                fontFamily: T.mono, fontSize: 10, fontWeight: 700, minWidth: 30, textAlign: "right" }}>
                {p.finalPoints}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Composition penalties */}
      {compositionPenalties?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1, marginBottom: 4 }}>PENALTIES</div>
          {compositionPenalties.map((p, i) => (
            <div key={i} style={{
              background: `${T.red}12`, border: `1px solid ${T.red}25`,
              borderRadius: 6, padding: "3px 8px", marginBottom: 3,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <AlertTriangle size={10} color={T.red} />
              <span style={{ color: T.red, fontSize: 9 }}>{p.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings as hints */}
      {warnings?.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ color: T.orange, fontSize: 9, fontFamily: T.mono, marginBottom: 2,
              display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ opacity: 0.7 }}>⚡</span> {w}
            </div>
          ))}
        </div>
      )}

      {/* Fairplay info */}
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: T.dim, fontSize: 9, fontFamily: T.mono }}>
          Team FP avg: <span style={{ color: T.gold }}>{teamFairplay?.toFixed(1)}/10</span>
        </span>
        <span style={{ color: T.dim, fontSize: 9, fontFamily: T.mono }}>
          {total >= 700 ? "🔥 Elite" : total >= 500 ? "✦ Strong" : total >= 300 ? "◆ Average" : "▼ Weak"}
        </span>
      </div>

      {squadHealth?.metrics?.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
          <div style={{ color: T.mid, fontSize: 10, fontFamily: T.mono, letterSpacing: 1, marginBottom: 8 }}>
            SQUAD HEALTH
          </div>
          {squadHealth.metrics.map((metric) => {
            const color = metric.value >= 70 ? T.green : metric.value >= 45 ? T.orange : T.red;
            return (
              <div key={metric.key} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: T.text, fontSize: 11 }}>{metric.label}</span>
                  <span style={{ color, fontFamily: T.mono, fontSize: 10 }}>{metric.value} · {metric.status}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ width: `${metric.value}%`, height: "100%", background: color, borderRadius: 99 }} />
                </div>
              </div>
            );
          })}

          {squadHealth.alerts?.map((alert, index) => {
            const color = alert.tone === "success" ? T.green : alert.tone === "warning" ? T.orange : T.red;
            return (
              <div key={`${alert.message}-${index}`} style={{
                background: `${color}12`,
                border: `1px solid ${color}33`,
                borderRadius: 8,
                padding: "8px 10px",
                marginTop: 8,
                color,
                fontSize: 11,
              }}>
                {alert.message}
              </div>
            );
          })}

          {squadHealth.preview && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
              {[
                ["vs Pace", squadHealth.preview.vsPace, T.green],
                ["vs Balanced", squadHealth.preview.vsBalanced, T.orange],
                ["vs Spin", squadHealth.preview.vsSpin, T.red],
              ].map(([label, value, color]) => (
                <div key={label} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
                  <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1 }}>{label}</div>
                  <div style={{ color, fontFamily: T.mono, fontSize: 18, fontWeight: 800, marginTop: 4 }}>{value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────
const POSITION_OPTIONS = ["Opener", "One-down", "Top Order", "Middle Order", "Finisher", "Lower Order"];

function PlayerCard({ player, isInXI, isCaptain, isViceCaptain, onToggle, onSetCaptain, onSetVC, injured, position, onPositionChange }) {
  const rc = roleColor(player.role);
  const borderColor = isCaptain ? T.gold : isViceCaptain ? T.purple : isInXI ? T.green : T.border;

  return (
    <div
      onClick={() => onToggle(player.playerId)}
      style={{
        background: T.card, borderRadius: 10,
        border: `1px solid ${borderColor}`,
        boxShadow: isInXI ? `0 0 16px ${borderColor}22` : "none",
        padding: "10px 12px",
        cursor: "pointer",
        opacity: injured ? 0.45 : 1,
        transition: "all 0.2s",
        position: "relative",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <RatingRing value={player.fairPoint || player.overallRating} size={38} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: T.text, fontWeight: 700, fontSize: 13 }}>
                {player.name}
              </span>
              {player.fairPoint > 0 && (
                <span style={{ color: T.gold, fontSize: 9, fontFamily: T.mono, fontWeight: 700 }}>FP {player.fairPoint.toFixed(0)}</span>
              )}
              {!player.hasRealStats && (
                <span style={{ color: T.orange, fontSize: 9, fontFamily: T.mono }}>est.</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
              <Pill color={rc}>{player.role?.split("-")[0]?.substring(0, 4)?.toUpperCase()}</Pill>
              <Pill color={
                player.valueLabel === "High Value Pick" ? T.green :
                player.valueLabel === "Overpriced" ? T.red : T.mid
              }>{player.valueLabel || "—"}</Pill>
            </div>
          </div>
        </div>
        {/* XI toggle */}
        <div style={{
          width: 22, height: 22, borderRadius: "50%",
          background: isInXI ? borderColor : "transparent",
          border: `2px solid ${isInXI ? borderColor : T.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {isInXI && <CheckCircle2 size={12} color="#0F172A" />}
        </div>
      </div>

      {player.context?.baseStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {[
            ["AVG", player.context.baseStats.avg],
            ["SR", player.context.baseStats.sr],
            ["RUNS", player.context.baseStats.runs],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border}`, borderRadius: 8, padding: "5px 6px", textAlign: "center" }}>
              <div style={{ color: T.text, fontFamily: T.mono, fontSize: 13, fontWeight: 700 }}>{value ?? "—"}</div>
              <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 8 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {player.context?.exactTags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {player.context.exactTags.slice(0, 3).map((tag) => (
            <span key={tag.label} style={{
              background: `${tag.tone === "good" ? T.green : tag.tone === "bad" ? T.red : T.orange}18`,
              border: `1px solid ${tag.tone === "good" ? T.green : tag.tone === "bad" ? T.red : T.orange}33`,
              color: tag.tone === "good" ? T.green : tag.tone === "bad" ? T.red : T.orange,
              borderRadius: 999,
              padding: "2px 8px",
              fontSize: 9,
              fontWeight: 700,
            }}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
        {[
          { label: "BAT", val: player.battingScore?.toFixed(0) },
          { label: "BWL", val: player.bowlingScore?.toFixed(0) },
          { label: "CONS", val: `${Math.round((player.consistency || 0) * 100)}%` },
        ].map(({ label, val }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 8, letterSpacing: 1 }}>{label}</div>
            <div style={{ color: T.text, fontFamily: T.mono, fontSize: 11, fontWeight: 700 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Consistency bar */}
      <ConsistencyBar value={player.consistency} />

      {/* C / VC buttons + Position dropdown (only visible when in XI) */}
      {isInXI && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onSetCaptain(player.playerId); }}
              style={{
                flex: 1, padding: "3px 0", borderRadius: 6,
                background: isCaptain ? `${T.gold}22` : T.glass,
                border: `1px solid ${isCaptain ? T.gold : T.border}`,
                color: isCaptain ? T.gold : T.mid, fontSize: 10,
                fontWeight: 700, cursor: "pointer",
              }}>
              {isCaptain ? "★ C" : "Set C"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSetVC(player.playerId); }}
              style={{
                flex: 1, padding: "3px 0", borderRadius: 6,
                background: isViceCaptain ? `${T.purple}22` : T.glass,
                border: `1px solid ${isViceCaptain ? T.purple : T.border}`,
                color: isViceCaptain ? T.purple : T.mid, fontSize: 10,
                fontWeight: 700, cursor: "pointer",
              }}>
              {isViceCaptain ? "★ VC" : "Set VC"}
            </button>
          </div>
          {/* Position dropdown */}
          <select
            value={position || ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); onPositionChange?.(player.playerId, e.target.value); }}
            style={{
              width: "100%", padding: "3px 6px", borderRadius: 6,
              background: T.card, border: `1px solid ${T.border}`,
              color: T.cyan, fontSize: 10, fontFamily: T.mono,
              fontWeight: 600, cursor: "pointer", outline: "none",
              appearance: "auto",
            }}>
            {POSITION_OPTIONS.map(pos => (
              <option key={pos} value={pos} style={{ background: T.card, color: T.text }}>{pos}</option>
            ))}
          </select>
        </div>
      )}

      {/* Show position label even when not in XI */}
      {!isInXI && position && (
        <div style={{ color: T.dim, fontFamily: T.mono, fontSize: 9, marginTop: 2 }}>
          Position: {position}
        </div>
      )}

      {injured && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 10,
          background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
          justifyContent: "center",
        }}>
          <span style={{ color: T.red, fontWeight: 700, fontSize: 11 }}>INJURED</span>
        </div>
      )}
    </div>
  );
}

// ─── Match Results Modal ───────────────────────────────────────────────────────
function MatchResultsModal({ results, onClose }) {
  if (!results) return null;
  const isLeague = results.simulationType === "league" || results.season?.points_table;
  const season = results.season || {};
  const standings = results.standings || [];
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: T.card, border: `1px solid ${T.border}`, borderRadius: 20,
        padding: window.innerWidth < 768 ? "16px 14px" : 28, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ color: T.gold, fontWeight: 900, fontSize: 20, margin: 0 }}>
              {isLeague ? "🏆 League Simulation Complete" : `🏆 Match ${results.matchNumber} Results`}
            </h2>
            <p style={{ color: T.mid, fontSize: 12, margin: "4px 0 0" }}>
              {isLeague ? `Champion: ${season?.playoffs?.champion || "TBD"}` : "Final leaderboard"}
            </p>
          </div>
          <button onClick={onClose} style={{ color: T.mid, background: "none", border: "none", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        {isLeague ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {season?.playoffs?.champion && (
              <div style={{ background: `${T.gold}10`, border: `1px solid ${T.gold}`, borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ color: T.gold, fontSize: 12, fontFamily: T.mono, marginBottom: 6 }}>SEASON CHAMPION</div>
                <div style={{ color: T.text, fontSize: 20, fontWeight: 900 }}>{season.playoffs.champion}</div>
                <div style={{ color: T.mid, fontSize: 12, marginTop: 4 }}>
                  Runner-up: {season?.playoffs?.runner_up || "TBD"}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {standings.map((team, i) => (
                <div key={team.teamName} style={{
                  background: i === 0 ? `${T.gold}10` : T.glass,
                  border: `1px solid ${i === 0 ? T.gold : T.border}`,
                  borderRadius: 12, padding: "12px 16px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{
                      color: i === 0 ? T.gold : T.mid,
                      fontFamily: T.mono, fontWeight: 900, fontSize: 18, minWidth: 24,
                    }}>#{team.position}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: T.text, fontWeight: 700 }}>{team.teamName}</div>
                      <div style={{ color: T.mid, fontSize: 11 }}>{team.userName || team.teamShortName || ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: T.gold, fontFamily: T.mono, fontWeight: 900, fontSize: 22 }}>
                        {team.points} <span style={{ fontSize: 11, fontWeight: 600 }}>pts</span>
                      </div>
                      <div style={{ color: T.mid, fontSize: 10 }}>
                        NRR {Number(team.nrr || 0).toFixed(3)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    <Pill color={T.cyan}>Played: {team.played}</Pill>
                    <Pill color={T.green}>Won: {team.won}</Pill>
                    <Pill color={T.red}>Lost: {team.lost}</Pill>
                    {team.venue && <Pill color={T.purple}>{team.venue}</Pill>}
                  </div>
                </div>
              ))}
            </div>

            {season?.season_awards && (
              <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ color: T.mid, fontSize: 11, fontFamily: T.mono, marginBottom: 10 }}>SEASON AWARDS</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: T.text, fontSize: 13 }}><span style={{ color: T.gold, fontWeight: 700 }}>Player of League:</span> {season.season_awards.player_of_league?.player}</div>
                  <div style={{ color: T.text, fontSize: 13 }}><span style={{ color: T.orange, fontWeight: 700 }}>Orange Cap:</span> {season.season_awards.orange_cap?.player}</div>
                  <div style={{ color: T.text, fontSize: 13 }}><span style={{ color: T.purple, fontWeight: 700 }}>Purple Cap:</span> {season.season_awards.purple_cap?.player}</div>
                  <div style={{ color: T.text, fontSize: 13 }}><span style={{ color: T.cyan, fontWeight: 700 }}>Super Striker:</span> {season.season_awards.super_striker?.player}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {results.results.map((team, i) => (
              <div key={team.teamName} style={{
                background: i === 0 ? `${T.gold}10` : T.glass,
                border: `1px solid ${i === 0 ? T.gold : T.border}`,
                borderRadius: 12, padding: "12px 16px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{
                    color: i === 0 ? T.gold : T.mid,
                    fontFamily: T.mono, fontWeight: 900, fontSize: 18, minWidth: 24,
                  }}>#{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: T.text, fontWeight: 700 }}>{team.teamName}</div>
                    <div style={{ color: T.mid, fontSize: 11 }}>{team.userName}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: T.gold, fontFamily: T.mono, fontWeight: 900, fontSize: 22 }}>
                      {team.teamStrength?.toFixed(0)} <span style={{ fontSize: 11, fontWeight: 600 }}>pts</span>
                    </div>
                    <div style={{ color: T.mid, fontSize: 10 }}>
                      {team.teamStrength >= 700 ? "🔥 Elite" : team.teamStrength >= 500 ? "✦ Strong" : team.teamStrength >= 300 ? "◆ Average" : "▼ Weak"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  <Pill color={T.cyan}>XI FP: {team.breakdown?.playingXIPoints?.toFixed(0)}</Pill>
                  {team.breakdown?.compositionReduction > 0 && (
                    <Pill color={T.red}>Penalty: -{(team.breakdown.compositionReduction * 100).toFixed(0)}%</Pill>
                  )}
                  <Pill color={T.green}>Fairplay: {team.breakdown?.teamFairplay?.toFixed(1)}</Pill>
                  {team.injuries?.length > 0 && (
                    <Pill color={T.red}>Injured: {team.injuries.length}</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function MatchSimulation() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { user } = useUser();

  const [allStrengths, setAllStrengths] = useState([]);
  const [myTeamData, setMyTeamData] = useState(null);
  const [playingXI, setPlayingXI] = useState(new Set());
  const [captainId, setCaptainId] = useState(null);
  const [viceCaptainId, setViceCaptainId] = useState(null);
  const [playerPositions, setPlayerPositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [xiConfirmed, setXiConfirmed] = useState(false);
  const [matchResults, setMatchResults] = useState(null);
  const [confirmedTeams, setConfirmedTeams] = useState(new Set());
  const [liveStrength, setLiveStrength] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [filterRole, setFilterRole] = useState("ALL");
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Helper: derive ideal position for a player based on role and skills
  const getDefaultPosition = useCallback((player) => {
    const role = player?.role || "Batsman";
    const skills = (player?.skills || []).map(s => String(s).trim().toLowerCase().replace(/\s+/g, "_"));
    if (role === "Bowler") return "Lower Order";
    if (role === "Wicket-Keeper") {
      if (skills.includes("opener") || skills.includes("top_order")) return "Opener";
      return "Middle Order";
    }
    if (role === "All-Rounder") {
      if (skills.includes("batting_allrounder")) return "Middle Order";
      return "Finisher";
    }
    // Batsman
    if (skills.includes("opener") || skills.includes("top_order") || skills.includes("powerplay_batter")) return "Opener";
    if (skills.includes("anchor")) return "One-down";
    if (skills.includes("middle_order")) return "Middle Order";
    if (skills.includes("finisher") || skills.includes("power_hitter")) return "Finisher";
    return "Top Order";
  }, []);

  // Load all team strengths and restore saved selections
  useEffect(() => {
    api.getMatchStrengths(code)
      .then((data) => {
        setAllStrengths(data);
        const mine = data.find((t) => t.userName === user.userName || t.teamName === user.teamName);
        setMyTeamData(mine || null);

        // Restore saved Playing XI, Captain, VC from backend
        if (mine) {
          if (mine.savedPlayingXI?.length > 0) {
            setPlayingXI(new Set(mine.savedPlayingXI));
          }
          if (mine.savedCaptainId) setCaptainId(mine.savedCaptainId);
          if (mine.savedViceCaptainId) setViceCaptainId(mine.savedViceCaptainId);
          if (mine.xiConfirmed) setXiConfirmed(true);
          if (mine.breakdown) setLiveStrength(mine.breakdown);

          // Initialize default positions for all players
          const posMap = {};
          (mine.playerProfiles || []).forEach((p) => {
            posMap[p.playerId] = getDefaultPosition(p);
          });
          setPlayerPositions(posMap);
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Check if host
    api.getRoom(code).then((room) => {
      setIsHost(room.host?.userId === user.userId);
    }).catch(() => {});
  }, [code, user.userName, user.teamName, user.userId, getDefaultPosition]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    socket.on("match:xiConfirmed", ({ teamName }) => {
      setConfirmedTeams((prev) => new Set([...prev, teamName]));
    });
    socket.on("match:strengthUpdate", (data) => {
      if (data.teamName === user.teamName) setLiveStrength(data);
    });
    socket.on("match:results", (data) => {
      setMatchResults(data);
      setSimulating(false);
    });

    return () => {
      socket.off("match:xiConfirmed");
      socket.off("match:strengthUpdate");
      socket.off("match:results");
    };
  }, [socket, user.teamName]);

  const handleTogglePlayer = useCallback((playerId) => {
    if (!playerId) return; // guard against undefined playerIds
    setPlayingXI((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
        if (captainId === playerId) setCaptainId(null);
        if (viceCaptainId === playerId) setViceCaptainId(null);
      } else {
        if (next.size >= 11) {
          setError("You can only select 11 players for the Playing XI");
          return prev;
        }
        next.add(playerId);
      }
      setError("");
      return next;
    });
  }, [captainId, viceCaptainId]);

  const handleSetCaptain = useCallback((playerId) => {
    if (!playerId || !playingXI.has(playerId)) return; // must be in XI
    if (playerId === viceCaptainId) setViceCaptainId(null);
    setCaptainId(playerId);
  }, [viceCaptainId, playingXI]);

  const handleSetVC = useCallback((playerId) => {
    if (!playerId || !playingXI.has(playerId)) return; // must be in XI
    if (playerId === captainId) setCaptainId(null);
    setViceCaptainId(playerId);
  }, [captainId, playingXI]);

  const handleSubmitXI = async () => {
    if (playingXI.size !== 11) return setError("Select exactly 11 players");
    if (!captainId) return setError("Select a Captain");
    if (!viceCaptainId) return setError("Select a Vice-Captain");

    setSubmitting(true);
    setError("");
    try {
      if (socket) {
        socket.emit("match:submitXI", {
          roomCode: code,
          userId: user.userId,
          playingXIPlayerIds: [...playingXI],
          captainId,
          viceCaptainId,
        }, (res) => {
          if (res?.success) {
            setXiConfirmed(true);
            setLiveStrength(res.data?.breakdown);
          } else {
            setError(res?.error || "Failed to submit XI");
          }
          setSubmitting(false);
        });
      } else {
        const data = await api.submitPlayingXI(code, {
          userId: user.userId,
          playingXIPlayerIds: [...playingXI],
          captainId,
          viceCaptainId,
        });
        setXiConfirmed(true);
        setLiveStrength(data.breakdown);
        setSubmitting(false);
      }
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const handleSimulate = async () => {
    setSimulating(true);
    if (socket) {
      socket.emit("match:simulate", { roomCode: code, userId: user.userId }, (res) => {
        if (!res?.success) {
          setError(res?.error || "Simulation failed");
          setSimulating(false);
        }
      });
    } else {
      try {
        const data = await api.simulateMatch(code, { userId: user.userId });
        setMatchResults(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setSimulating(false);
      }
    }
  };

  if (loading) {
    return (
      <div style={{ background: T.bg, fontFamily: T.sans }} className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-4"
            style={{ borderColor: `${T.cyan} transparent ${T.cyan} ${T.cyan}` }} />
          <p style={{ color: T.mid }}>Loading match data…</p>
        </div>
      </div>
    );
  }

  const players = myTeamData?.playerProfiles || [];
  const roles = ["ALL", "Batsman", "Bowler", "All-Rounder", "Wicket-Keeper"];
  const filtered = filterRole === "ALL" ? players : players.filter((p) => p.role === filterRole);

  const xiCount = playingXI.size;
  const canSubmit = xiCount === 11 && captainId && viceCaptainId && !xiConfirmed;

  return (
    <div style={{ background: T.bg, fontFamily: T.sans, minHeight: "100vh", color: T.text }}>
      {/* Header */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: "12px 20px",
        display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => navigate(-1)} style={{ color: T.mid, background: "none", border: "none", cursor: "pointer" }}>
          <ArrowLeft size={18} />
        </button>
        <Shield size={18} color={T.cyan} />
        <span style={{ fontWeight: 800, fontSize: 16 }}>Match Simulation</span>
        <span style={{ marginLeft: 4, color: T.mid, fontSize: 12, fontFamily: T.mono }}>{code}</span>
        <div style={{ flex: 1 }} />
        {/* XI counter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            background: xiCount === 11 ? `${T.green}22` : `${T.cyan}22`,
            border: `1px solid ${xiCount === 11 ? T.green : T.cyan}`,
            borderRadius: 8, padding: "4px 10px",
          }}>
            <span style={{ color: xiCount === 11 ? T.green : T.cyan, fontFamily: T.mono, fontSize: 13, fontWeight: 700 }}>
              {xiCount}/11
            </span>
          </div>
          {xiConfirmed && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: T.green, fontSize: 12 }}>
              <CheckCircle2 size={14} /> XI Confirmed
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 320px", gap: 0, maxWidth: 1280, margin: "0 auto" }}>

        {/* Left: Squad selector */}
        <div style={{ padding: isMobile ? "12px 12px" : "20px 16px", borderRight: isMobile ? "none" : `1px solid ${T.border}`, borderBottom: isMobile ? `1px solid ${T.border}` : "none" }}>
          {/* Role filter */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {roles.map((r) => (
              <button key={r} onClick={() => setFilterRole(r)}
                style={{
                  padding: "4px 12px", borderRadius: 99,
                  background: filterRole === r ? `${T.cyan}22` : T.glass,
                  border: `1px solid ${filterRole === r ? T.cyan : T.border}`,
                  color: filterRole === r ? T.cyan : T.mid,
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                }}>
                {r === "All-Rounder" ? "AR" : r}
              </button>
            ))}
          </div>

          {error && (
            <div style={{
              background: `${T.red}15`, border: `1px solid ${T.red}40`,
              borderRadius: 8, padding: "8px 12px", marginBottom: 12,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <AlertTriangle size={14} color={T.red} />
              <span style={{ color: T.red, fontSize: 12 }}>{error}</span>
            </div>
          )}

          {/* Player grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? "160px" : "220px"}, 1fr))`,
            gap: isMobile ? 8 : 10,
          }}>
            {filtered.map((player) => (
              <PlayerCard
                key={player.playerId || player.name}
                player={player}
                isInXI={playingXI.has(player.playerId)}
                isCaptain={captainId === player.playerId}
                isViceCaptain={viceCaptainId === player.playerId}
                onToggle={handleTogglePlayer}
                onSetCaptain={handleSetCaptain}
                onSetVC={handleSetVC}
                injured={false}
                position={playerPositions[player.playerId]}
                onPositionChange={(id, pos) => setPlayerPositions(prev => ({ ...prev, [id]: pos }))}
              />
            ))}
            {filtered.length === 0 && (
              <p style={{ color: T.dim, gridColumn: "1/-1", textAlign: "center", padding: 32 }}>
                No players in this category
              </p>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div style={{ padding: isMobile ? "12px 12px" : "20px 16px", display: "flex", flexDirection: "column", gap: isMobile ? 10 : 16 }}>

          {/* C/VC summary */}
          {(captainId || viceCaptainId) && (
            <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
              <p style={{ color: T.mid, fontSize: 11, fontFamily: T.mono, marginBottom: 8 }}>CAPTAIN / VC</p>
              {captainId && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                  <Crown size={13} color={T.gold} />
                  <span style={{ color: T.gold, fontSize: 12, fontWeight: 700 }}>
                    {players.find((p) => p.playerId === captainId)?.name} (2× pts)
                  </span>
                </div>
              )}
              {viceCaptainId && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Star size={13} color={T.purple} />
                  <span style={{ color: T.purple, fontSize: 12, fontWeight: 700 }}>
                    {players.find((p) => p.playerId === viceCaptainId)?.name} (1.5× pts)
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Live strength preview */}
          {liveStrength && (
            <StrengthBar breakdown={liveStrength} playersPerTeam={myTeamData?.squadSize || 25} />
          )}

          {/* Validation — hints only, not restrictions */}
          {myTeamData?.validation && (
            <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
              <p style={{ color: T.mid, fontSize: 11, fontFamily: T.mono, marginBottom: 8 }}>SQUAD HEALTH</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(myTeamData.validation.roleCounts || {}).map(([role, cnt]) => (
                  <Pill key={role} color={roleColor(role)}>{role.substring(0, 3).toUpperCase()}: {cnt}</Pill>
                ))}
              </div>
              {myTeamData.validation.isValid && (
                <div style={{ marginTop: 6, color: T.green, fontSize: 11, display: "flex", gap: 4 }}>
                  <CheckCircle2 size={11} /> Squad composition valid
                </div>
              )}
            </div>
          )}

          {/* XI Composition Hints */}
          {xiCount > 0 && (() => {
            const xiRoles = { Batsman: 0, Bowler: 0, "All-Rounder": 0, "Wicket-Keeper": 0 };
            let osCount = 0;
            players.filter(p => playingXI.has(p.playerId)).forEach(p => {
              const role = p.role || "Batsman";
              if (xiRoles.hasOwnProperty(role)) xiRoles[role]++;
              if (p.isOverseas) osCount++;
            });
            const hints = [];
            if (xiRoles["Batsman"] < 3) hints.push(`Hint: Need ${3 - xiRoles["Batsman"]} more Batsman`);
            if (xiRoles["Bowler"] < 3) hints.push(`Hint: Need ${3 - xiRoles["Bowler"]} more Bowler`);
            if (xiRoles["All-Rounder"] < 1) hints.push("Hint: Consider adding an All-Rounder");
            if (xiRoles["Wicket-Keeper"] < 1) hints.push("Hint: Consider adding a Wicket-Keeper");
            if (osCount > 4) hints.push(`⚠ Too many overseas (${osCount}/4 max)`);
            return (
              <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <p style={{ color: T.mid, fontSize: 11, fontFamily: T.mono, marginBottom: 8 }}>XI COMPOSITION</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {Object.entries(xiRoles).map(([role, cnt]) => (
                    <Pill key={role} color={roleColor(role)}>{role.substring(0, 3).toUpperCase()}: {cnt}</Pill>
                  ))}
                  <Pill color={osCount > 4 ? T.red : T.cyan}>OS: {osCount}/4</Pill>
                </div>
                {hints.map((h, i) => (
                  <div key={i} style={{ color: h.startsWith("⚠") ? T.red : T.orange, fontSize: 10, fontFamily: T.mono, marginBottom: 2 }}>
                    {h}
                  </div>
                ))}
                {hints.length === 0 && xiCount === 11 && (
                  <div style={{ color: T.green, fontSize: 10, fontFamily: T.mono }}>
                    ✓ Balanced XI
                  </div>
                )}
              </div>
            );
          })()}

          {/* Submit XI button */}
          {!xiConfirmed ? (
            <button onClick={handleSubmitXI} disabled={!canSubmit || submitting}
              style={{
                width: "100%", padding: "14px 0",
                background: canSubmit && !submitting
                  ? `linear-gradient(135deg, #00E5FF, #0090FF)`
                  : T.border,
                color: canSubmit && !submitting ? "#0F172A" : T.dim,
                fontWeight: 900, fontSize: 15, borderRadius: 12,
                border: "none", cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                boxShadow: canSubmit && !submitting ? `0 0 24px #00E5FF44` : "none",
                transition: "all 0.2s",
              }}>
              {submitting ? "Confirming…" : `Confirm Playing XI (${xiCount}/11)`}
            </button>
          ) : (
            <div style={{
              padding: "12px 0", background: `${T.green}18`,
              border: `1px solid ${T.green}40`, borderRadius: 12, textAlign: "center",
              color: T.green, fontWeight: 700,
            }}>
              <CheckCircle2 size={16} style={{ display: "inline", marginRight: 6 }} />
              Playing XI Confirmed!
            </div>
          )}

          {/* Team standings */}
          <div style={{ background: T.glass, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ color: T.mid, fontSize: 11, fontFamily: T.mono, marginBottom: 10 }}>ALL TEAMS</p>
            {allStrengths.map((team, i) => (
              <div key={team.teamName} style={{
                display: "flex", alignItems: "center",
                padding: "6px 0",
                borderBottom: i < allStrengths.length - 1 ? `1px solid ${T.border}` : "none",
              }}>
                <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 11, minWidth: 20 }}>#{i + 1}</span>
                <div style={{ flex: 1, marginLeft: 8 }}>
                  <div style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>{team.teamName}</div>
                  <div style={{ color: T.mid, fontSize: 10 }}>FP: {team.fairplayScore?.toFixed(1)}/10</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: T.gold, fontFamily: T.mono, fontWeight: 700, fontSize: 13 }}>
                    {team.teamStrength?.toFixed(1)}
                  </div>
                  {confirmedTeams.has(team.teamName) && (
                    <CheckCircle2 size={10} color={T.green} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Host: simulate button */}
          {isHost && (
            <button onClick={handleSimulate} disabled={simulating}
              style={{
                width: "100%", padding: "14px 0",
                background: simulating
                  ? T.border
                  : `linear-gradient(135deg, ${T.gold}, #E0A800)`,
                color: simulating ? T.dim : "#0F172A",
                fontWeight: 900, fontSize: 15, borderRadius: 12,
                border: "none", cursor: simulating ? "not-allowed" : "pointer",
                boxShadow: !simulating ? `0 0 24px ${T.gold}44` : "none",
                transition: "all 0.2s",
              }}>
              {simulating ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Simulating…
                </span>
              ) : "🏏 Simulate Match"}
            </button>
          )}

          <button onClick={() => navigate(`/room/${code}/results`)}
            style={{
              width: "100%", padding: "10px 0",
              background: T.glass, border: `1px solid ${T.border}`,
              color: T.mid, borderRadius: 12, cursor: "pointer", fontSize: 13,
            }}>
            View Full Results →
          </button>
        </div>
      </div>

      {/* Match results modal */}
      {matchResults && (
        <MatchResultsModal results={matchResults} onClose={() => setMatchResults(null)} />
      )}
    </div>
  );
}
