import { useState } from "react";
import { Volume2, VolumeX, ChevronDown, ChevronUp } from "lucide-react";
import { useAudio } from "../context/AudioContext";
import { COLORS } from "../data/constants";

const SOUND_OPTIONS = [
  { key: "timerTick", label: "Timer Tick" },
  { key: "timerAlert", label: "Timer Alert" },
  { key: "sold", label: "Sold Music" },
  { key: "bidPlaced", label: "Bid Sound" },
  { key: "unsold", label: "Unsold Sound" },
  { key: "rtm", label: "RTM Alert" },
];

/**
 * SoundControls — mute/unmute individual sounds + overall.
 * Use `compact` prop for a small toggle button.
 */
export default function SoundControls({ compact = false }) {
  const { muted, toggleMute } = useAudio();
  const [expanded, setExpanded] = useState(false);

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          title={muted.overall ? "Unmute All" : "Sound Settings"}
          style={{
            color: muted.overall ? COLORS.accent : COLORS.success,
            background: muted.overall ? `${COLORS.accent}22` : `${COLORS.success}22`,
            border: `1px solid ${muted.overall ? COLORS.accent + "44" : COLORS.success + "44"}`,
          }}
          className="p-2 rounded-lg transition-all flex items-center gap-1"
        >
          {muted.overall ? <VolumeX size={16} /> : <Volume2 size={16} />}
          <ChevronDown
            size={10}
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
        </button>

        {expanded && (
          <div
            style={{
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.border}`,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            className="absolute right-0 top-full mt-2 rounded-xl p-3 w-52 z-50 space-y-1"
          >
            {/* Overall mute */}
            <button
              onClick={() => toggleMute("overall")}
              className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs font-bold transition-all hover:bg-white/5"
              style={{
                color: muted.overall ? COLORS.accent : COLORS.success,
                background: muted.overall ? `${COLORS.accent}11` : `${COLORS.success}11`,
                borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              {muted.overall ? <VolumeX size={14} /> : <Volume2 size={14} />}
              <span className="flex-1 text-left">All Sounds</span>
              <span className="text-[10px]">{muted.overall ? "MUTED" : "ON"}</span>
            </button>

            {/* Individual controls */}
            {SOUND_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleMute(key)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5"
                style={{ color: muted[key] ? COLORS.textSecondary : COLORS.textPrimary }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: muted[key] ? COLORS.accent : COLORS.success,
                  }}
                />
                <span className="flex-1 text-left">{label}</span>
                <span
                  style={{ color: muted[key] ? COLORS.accent : COLORS.success }}
                  className="text-[10px] font-bold"
                >
                  {muted[key] ? "OFF" : "ON"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Full panel version
  return (
    <div
      style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}` }}
      className="rounded-xl p-3 space-y-2"
    >
      <button
        onClick={() => toggleMute("overall")}
        className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-xs font-bold transition-all hover:bg-white/5"
        style={{
          color: muted.overall ? COLORS.accent : COLORS.success,
          background: muted.overall ? `${COLORS.accent}11` : `${COLORS.success}11`,
        }}
      >
        {muted.overall ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <span className="flex-1 text-left">All Sounds</span>
        <span className="text-[10px]">{muted.overall ? "MUTED" : "ON"}</span>
      </button>

      {SOUND_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => toggleMute(key)}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5"
          style={{ color: muted[key] ? COLORS.textSecondary : COLORS.textPrimary }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: muted[key] ? COLORS.accent : COLORS.success,
            }}
          />
          <span className="flex-1 text-left">{label}</span>
          <span
            style={{ color: muted[key] ? COLORS.accent : COLORS.success }}
            className="text-[10px] font-bold"
          >
            {muted[key] ? "OFF" : "ON"}
          </span>
        </button>
      ))}
    </div>
  );
}
