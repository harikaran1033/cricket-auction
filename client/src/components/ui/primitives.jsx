import { COLORS } from "../../data/constants";

export function Panel({ children, className = "", tone = "default", style = {}, hover = false }) {
  const tones = {
    default: {
      background: "linear-gradient(180deg, rgba(15,23,42,0.9), rgba(15,23,42,0.72))",
      border: `1px solid ${COLORS.borderSoft}`,
    },
    elevated: {
      background: "linear-gradient(180deg, rgba(17,24,39,0.92), rgba(13,20,34,0.9))",
      border: `1px solid ${COLORS.borderSoft}`,
    },
    hud: {
      background: "linear-gradient(135deg, rgba(0,229,255,0.08), rgba(15,23,42,0.86) 45%, rgba(255,61,0,0.08))",
      border: `1px solid rgba(0,229,255,0.26)`,
    },
  };
  return (
    <div
      style={{
        borderRadius: 18,
        boxShadow: tone === "hud" ? "0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)" : "0 8px 20px rgba(0,0,0,0.25)",
        transition: "transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
        ...(tones[tone] || tones.default),
        ...style,
      }}
      className={`${hover ? "hover:-translate-y-0.5 hover:shadow-2xl" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function StatPill({ label, value, color = COLORS.primary, compact = false }) {
  return (
    <div
      style={{
        background: `${color}12`,
        border: `1px solid ${color}55`,
        color,
        borderRadius: 999,
      }}
      className={`inline-flex items-center gap-2 ${compact ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} font-bold tracking-wide`}
    >
      <span className="uppercase opacity-80">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}

export function HUDHeader({ eyebrow, title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        {eyebrow && <p style={{ color: COLORS.textMuted }} className="uppercase tracking-[0.2em] text-[10px] font-bold mb-1">{eyebrow}</p>}
        <h2 style={{ color: COLORS.textPrimary }} className="text-2xl md:text-3xl font-black tracking-tight">{title}</h2>
        {subtitle && <p style={{ color: COLORS.textSecondary }} className="text-sm mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function NeonButton({ children, onClick, variant = "primary", className = "", disabled = false, type = "button" }) {
  const variants = {
    primary: {
      background: "linear-gradient(135deg, #00E5FF, #0891B2)",
      color: "#05131F",
      border: "1px solid rgba(0,229,255,0.35)",
      boxShadow: "0 0 0 1px rgba(0,229,255,0.12) inset, 0 8px 20px rgba(0,229,255,0.22)",
    },
    secondary: {
      background: "rgba(15,23,42,0.75)",
      color: "#E2E8F0",
      border: "1px solid rgba(148,163,184,0.28)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    },
    danger: {
      background: "linear-gradient(135deg, #FF3D00, #DC2626)",
      color: "#fff",
      border: "1px solid rgba(255,61,0,0.4)",
      boxShadow: "0 8px 20px rgba(220,38,38,0.28)",
    },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 12,
        padding: "10px 16px",
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: 0.3,
        transition: "transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...(variants[variant] || variants.primary),
      }}
      className={`hover:-translate-y-0.5 ${className}`}
    >
      {children}
    </button>
  );
}

export function StatusChip({ label, tone = "neutral", pulse = false }) {
  const map = {
    neutral: { color: COLORS.textSecondary, bg: "rgba(148,163,184,0.16)", border: "rgba(148,163,184,0.38)" },
    live: { color: "#FF3D00", bg: "rgba(255,61,0,0.17)", border: "rgba(255,61,0,0.45)" },
    sold: { color: "#22C55E", bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.4)" },
    warning: { color: "#F59E0B", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)" },
    rtm: { color: "#A855F7", bg: "rgba(168,85,247,0.15)", border: "rgba(168,85,247,0.4)" },
    host: { color: "#38BDF8", bg: "rgba(56,189,248,0.14)", border: "rgba(56,189,248,0.42)" },
  };
  const cfg = map[tone] || map.neutral;
  return (
    <span
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 999 }}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
    >
      {pulse && <span style={{ background: cfg.color }} className="w-1.5 h-1.5 rounded-full animate-pulse" />}
      {label}
    </span>
  );
}
