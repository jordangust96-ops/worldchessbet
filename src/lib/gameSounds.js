const STORAGE_KEY = "chessbet_sound_enabled";

let audioContext = null;
let masterGain = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextClass = window.AudioContext || (/** @type {any} */ (window)).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioContext) {
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function scheduleTone(context, {
  frequency,
  start = 0,
  duration = 0.12,
  volume = 0.035,
  type = "sine",
}) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startsAt = context.currentTime + start;
  const endsAt = startsAt + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(volume, startsAt + Math.min(0.018, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);

  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(startsAt);
  oscillator.stop(endsAt + 0.02);
}

function scheduleCue(context, cue) {
  const cues = {
    accepted: [
      { frequency: 523.25, duration: 0.24, volume: 0.03, type: "sine" },
      { frequency: 659.25, start: 0.12, duration: 0.3, volume: 0.032, type: "sine" },
    ],
    move_self: [
      { frequency: 260, duration: 0.075, volume: 0.11, type: "triangle" },
      { frequency: 390, start: 0.018, duration: 0.065, volume: 0.07, type: "sine" },
    ],
    move_opponent: [
      { frequency: 220, duration: 0.08, volume: 0.105, type: "triangle" },
      { frequency: 330, start: 0.018, duration: 0.07, volume: 0.065, type: "sine" },
    ],
    capture_self: [
      { frequency: 190, duration: 0.1, volume: 0.14, type: "triangle" },
      { frequency: 285, start: 0.012, duration: 0.09, volume: 0.085, type: "sine" },
    ],
    capture_opponent: [
      { frequency: 165, duration: 0.105, volume: 0.13, type: "triangle" },
      { frequency: 247.5, start: 0.012, duration: 0.095, volume: 0.078, type: "sine" },
    ],
    castle_self: [
      { frequency: 246.94, duration: 0.09, volume: 0.105, type: "triangle" },
      { frequency: 329.63, start: 0.075, duration: 0.11, volume: 0.11, type: "triangle" },
      { frequency: 493.88, start: 0.13, duration: 0.2, volume: 0.06, type: "sine" },
    ],
    castle_opponent: [
      { frequency: 220, duration: 0.09, volume: 0.1, type: "triangle" },
      { frequency: 293.66, start: 0.075, duration: 0.11, volume: 0.105, type: "triangle" },
      { frequency: 440, start: 0.13, duration: 0.2, volume: 0.055, type: "sine" },
    ],
    victory: [
      { frequency: 523.25, duration: 0.34, volume: 0.028, type: "sine" },
      { frequency: 659.25, start: 0.11, duration: 0.38, volume: 0.03, type: "sine" },
      { frequency: 783.99, start: 0.22, duration: 0.48, volume: 0.032, type: "sine" },
    ],
    defeat: [
      { frequency: 392, duration: 0.32, volume: 0.025, type: "sine" },
      { frequency: 329.63, start: 0.13, duration: 0.36, volume: 0.024, type: "sine" },
      { frequency: 261.63, start: 0.26, duration: 0.42, volume: 0.022, type: "sine" },
    ],
    draw: [
      { frequency: 392, duration: 0.4, volume: 0.024, type: "sine" },
      { frequency: 523.25, start: 0.06, duration: 0.42, volume: 0.022, type: "sine" },
    ],
    enabled: [
      { frequency: 523.25, duration: 0.18, volume: 0.027, type: "sine" },
      { frequency: 659.25, start: 0.08, duration: 0.22, volume: 0.026, type: "sine" },
    ],
  };

  (cues[cue] || cues.move_self).forEach((tone) => scheduleTone(context, tone));
}

export function getMoveSoundCue(move, myColor) {
  const ownership = move?.color === myColor ? "self" : "opponent";
  const san = typeof move?.san === "string" ? move.san : "";
  if (/^(O-O|0-0)/.test(san)) return `castle_${ownership}`;
  if (san.includes("x")) return `capture_${ownership}`;
  return `move_${ownership}`;
}

export function getStoredSoundPreference() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function storeSoundPreference(enabled) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, String(Boolean(enabled)));
  }
}

export function primeGameAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") {
    context.resume().catch(() => {});
  }
}

export function installGameAudioUnlock() {
  if (typeof window === "undefined") return () => {};
  // The AudioContext can be suspended by the browser at any time (mobile Safari
  // does this routinely between gestures). A one-shot unlock only resumes once;
  // if the context is later suspended, every playGameSound call silently bails
  // and the user hears nothing. Resume on every gesture instead — resume() on
  // an already-running context is a cheap no-op.
  const unlock = () => {
    const context = getAudioContext();
    if (context?.state === "suspended") {
      context.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export async function playGameSound(cue, enabled = true) {
  if (!enabled) return false;
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") await context.resume();
    // Schedule the cue even when the context is still resuming. A resumed/suspended
    // context does not advance currentTime, so the oscillators will fire the moment
    // a user gesture completes the resume — instead of dropping the sound entirely.
    scheduleCue(context, cue);
    return true;
  } catch {
    // Audio is progressive enhancement. Browser autoplay policies or missing
    // Web Audio support must never interrupt match state or controls.
    return false;
  }
}