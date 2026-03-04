import { createContext, useContext, useState, useRef, useCallback } from "react";

/**
 * AudioContext — Web Audio API sound system for the auction.
 * Generates synthesized tones (no external files needed).
 * Supports individual mute controls + overall mute.
 */
const AudioCtx = createContext(null);

export function AudioProvider({ children }) {
  const audioCtxRef = useRef(null);
  const [muted, setMuted] = useState({
    overall: false,
    timerTick: false,
    timerAlert: false,
    bidPlaced: false,
    sold: false,
    unsold: false,
    rtm: false,
  });

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback(
    (freq, duration, type = "sine", volume = 0.3, delay = 0) => {
      try {
        const ctx = getAudioCtx();
        const startAt = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.05);
      } catch (e) {
        // Audio not supported or blocked
      }
    },
    [getAudioCtx]
  );

  /** Short muted knock for each timer second (only plays when <= 10s) */
  const playTimerTick = useCallback(() => {
    if (muted.overall || muted.timerTick) return;
    playTone(800, 0.05, "sine", 0.08);
    playTone(400, 0.03, "triangle", 0.04, 0.02);
  }, [muted.overall, muted.timerTick, playTone]);

  /** Urgent pulsing alarm when timer <= 3 seconds */
  const playTimerAlert = useCallback(() => {
    if (muted.overall || muted.timerAlert) return;
    // Double-hit alarm
    playTone(880, 0.08, "square", 0.14);
    playTone(1100, 0.08, "square", 0.12, 0.1);
    playTone(880, 0.06, "square", 0.1, 0.2);
  }, [muted.overall, muted.timerAlert, playTone]);

  /** Quick ascending chime when a bid is placed */
  const playBidSound = useCallback(() => {
    if (muted.overall || muted.bidPlaced) return;
    playTone(523, 0.07, "sine", 0.15);
    playTone(659, 0.07, "sine", 0.15, 0.07);
    playTone(784, 0.1, "sine", 0.18, 0.14);
  }, [muted.overall, muted.bidPlaced, playTone]);

  /** Celebratory fanfare when a player is sold (for the winning team) */
  const playSoldMusic = useCallback(() => {
    if (muted.overall || muted.sold) return;
    // Rising fanfare
    playTone(523, 0.2, "sine", 0.16);
    playTone(659, 0.2, "sine", 0.16, 0.12);
    playTone(784, 0.2, "sine", 0.18, 0.24);
    playTone(1047, 0.35, "sine", 0.2, 0.38);
    // Triumphant chord
    playTone(523, 0.6, "sine", 0.1, 0.6);
    playTone(659, 0.6, "sine", 0.1, 0.6);
    playTone(784, 0.6, "sine", 0.1, 0.6);
    playTone(1047, 0.7, "triangle", 0.08, 0.6);
    // Final sparkle
    playTone(1568, 0.3, "sine", 0.06, 1.0);
    playTone(2093, 0.4, "sine", 0.04, 1.1);
  }, [muted.overall, muted.sold, playTone]);

  /** Descending tone when player goes unsold */
  const playUnsoldSound = useCallback(() => {
    if (muted.overall || muted.unsold) return;
    playTone(440, 0.2, "sine", 0.14);
    playTone(330, 0.25, "sine", 0.12, 0.2);
    playTone(262, 0.35, "triangle", 0.1, 0.45);
  }, [muted.overall, muted.unsold, playTone]);

  /** Warning warble for RTM notification */
  const playRtmSound = useCallback(() => {
    if (muted.overall || muted.rtm) return;
    playTone(440, 0.1, "triangle", 0.18);
    playTone(440, 0.1, "triangle", 0.18, 0.15);
    playTone(660, 0.15, "triangle", 0.2, 0.3);
    playTone(660, 0.15, "triangle", 0.2, 0.5);
  }, [muted.overall, muted.rtm, playTone]);

  const toggleMute = useCallback((key) => {
    setMuted((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <AudioCtx.Provider
      value={{
        muted,
        toggleMute,
        setMuted,
        playTimerTick,
        playTimerAlert,
        playBidSound,
        playSoldMusic,
        playUnsoldSound,
        playRtmSound,
      }}
    >
      {children}
    </AudioCtx.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudio must be inside AudioProvider");
  return ctx;
}
