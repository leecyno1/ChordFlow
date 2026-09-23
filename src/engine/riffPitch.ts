import type { RiffSettings } from "../domain/types";

export const RIFF_TONE_FOCUS_NAMES = {
  balanced: "原取音",
  core: "骨干音为主",
  color: "弱拍色彩"
};

// Supported chords list their three-note foundation first (including sus and
// diminished foundations), followed by sixth/seventh/ninth color tones.
export function riffPitchChoices(pool: number[], pcs: number[], focus: RiffSettings["toneFocus"], onPulse: boolean, target: number, previous: number): number[] {
  if (!focus || focus === "balanced" || pcs.length <= 3) return pool;
  const core = pool.filter(note => pcs.slice(0, 3).includes(note % 12));
  if (focus === "core" || onPulse) return core;
  const colors = pool.filter(note => pcs.slice(3).includes(note % 12)
    && Math.abs(note - previous) <= 5 && Math.abs(note - target) <= 5);
  return colors.length ? colors : core;
}

export function riffToneFocusPrompt(focus: RiffSettings["toneFocus"]): string {
  if (!focus || focus === "balanced") return "";
  const direction = focus === "core"
    ? "use the chord's three-note foundation for melody anchors, preserving suspended or diminished quality"
    : "use the chord's three-note foundation on main pulses; on existing off-pulse attacks, prefer its sixth, seventh or ninth within five semitones of both the previous melody note and the motif target, otherwise use the foundation";
  return `; riff tone focus: ${direction}; preserve root resolutions and the base rhythm; recalculate optional ornaments and handoffs`;
}
