import type { RiffSettings, TimeSignature } from "../domain/types";
import type { RiffNote } from "./riff";

export const RIFF_ACCENT_NAMES = {
  original: "原力度",
  pulse: "主拍突出",
  offbeat: "弱拍推动"
};

// Applied after ornament and handoff planning: dynamics must not change the
// melody, its rhythm, or which boundary connections can be generated.
export function riffAccentVelocity(note: RiffNote, accent: RiffSettings["accent"], energy: number, meter: TimeSignature): number {
  if (!accent || accent === "original") return note.velocity;
  const base = 0.4 + energy * 0.004;
  // Decorations remain quiet, rather than becoming accents just because they
  // lie between pulses. Phrase-ending roots retain some weight in either mode.
  if (note.kind && note.kind !== "resolution") return base * 0.72;
  const pulseSlots = meter === "6/8" ? 3 : 2;
  const onPulse = note.beat * 2 % pulseSlots === 0;
  const emphasized = accent === "pulse" ? onPulse : !onPulse;
  const velocity = base + (emphasized ? 0.12 : -0.06);
  return Math.min(0.95, note.kind === "resolution" ? Math.max(base + 0.04, velocity) : velocity);
}

export function riffAccentPrompt(accent: RiffSettings["accent"], meter: TimeSignature): string {
  if (!accent || accent === "original") return "";
  const pulse = meter === "6/8" ? "dotted-quarter" : "quarter-note";
  const direction = accent === "pulse"
    ? `emphasize existing melody attacks on each ${pulse} pulse`
    : `emphasize existing melody attacks between ${pulse} pulses`;
  return `; riff dynamics: ${direction}; keep ornaments soft and phrase-ending roots supported; do not change pitches, note positions or rests`;
}
