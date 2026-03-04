import { COLORS, getStatusConfig } from "../data/constants";

export default function StatusBadge({ status, size = "sm" }) {
  const cfg = getStatusConfig(status);
  return (
    <span
      style={{
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}44`,
        fontFamily: "'JetBrains Mono', monospace",
      }}
      className={`inline-flex items-center gap-1.5 rounded-full font-bold tracking-wider ${size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-3 py-1"}`}
    >
      {cfg.pulse && (
        <span style={{ background: cfg.color }} className="w-1.5 h-1.5 rounded-full animate-pulse" />
      )}
      {cfg.label}
    </span>
  );
}
