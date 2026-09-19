import { chordPitchClasses } from "../domain/music";
import { quarterNotesPerBar, effectiveSectionProductionAt } from "../domain/production";
import type { Arrangement, RiffSettings } from "../domain/types";

export const DEFAULT_RIFF: RiffSettings = {
  style: "hook", bars: 2, density: "sparse", register: "high",
  variation: 1, rhythmSeed: 0, pitchSeed: 0
};
export const RIFF_NAMES = { arpeggio: "舒缓分解", syncopated: "切分律动", hook: "旋律钩子" };

export interface RiffNote {
  midi: number;
  beat: number;
  duration: number;
  velocity: number;
  sectionIndex: number;
  chordIndex: number;
}

export function normalizeRiff(value: unknown): RiffSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (!["arpeggio", "syncopated", "hook"].includes(String(item.style))) return undefined;
  const integer = (name: string, fallback: number) =>
    typeof item[name] === "number" && Number.isFinite(item[name]) ? Math.round(item[name] as number) : fallback;
  return {
    style: item.style as RiffSettings["style"], bars: item.bars === 1 ? 1 : 2,
    density: item.density === "full" ? "full" : "sparse",
    register: item.register === "low" ? "low" : "high",
    variation: Math.max(0, Math.min(2, integer("variation", 1))),
    rhythmSeed: Math.abs(integer("rhythmSeed", 0)) % 100000,
    pitchSeed: Math.abs(integer("pitchSeed", 0)) % 100000
  };
}

// Beats are quarter notes throughout, including 6/8 (three quarters per bar).
// One motif is reused across chords; only its pitch realization follows harmony.
export function buildRiffNotes(arrangement: Arrangement): RiffNote[] {
  const settings = arrangement.riff;
  if (!settings) return [];
  const barBeats = quarterNotesPerBar(arrangement.production.timeSignature);
  const slotsPerBar = barBeats * 2;
  const motifSlots = slotsPerBar * settings.bars;
  const sectionSlots = slotsPerBar * arrangement.production.barsPerSection;
  const pulse = arrangement.production.timeSignature === "6/8" ? 3 : 2;
  const masks = {
    arpeggio: [[0, 2, 4, 6], [0, 2, 5, 6], [0, 3, 4, 6]],
    syncopated: [[0, 3, 6], [0, 3, 5], [0, 2, 5, 7]],
    hook: [[0, 2, 3, 6], [0, 1, 4, 6], [0, 3, 4, 7]]
  }[settings.style];
  const mask = masks[settings.rhythmSeed % masks.length];
  const contours = {
    arpeggio: [[0, 4, 7, 4, 0, 4, 7, 0], [7, 4, 0, 4, 7, 4, 2, 0], [0, 7, 4, 7, 0, 4, 7, 0]],
    syncopated: [[0, 0, 3, 0, 0, 5, 3, 0], [3, 0, 0, 5, 3, 0, 2, 0], [0, 5, 0, 3, 0, 5, 2, 0]],
    hook: [[0, 2, 4, 2, 0, -1, 2, 0], [0, -2, 0, 3, 5, 3, 2, 0], [2, 2, 0, -2, 0, 3, 2, 0]]
  }[settings.style];
  const contour = contours[settings.pitchSeed % contours.length];
  const result: RiffNote[] = [];
  arrangement.sections.forEach((section, sectionIndex) => {
    const production = effectiveSectionProductionAt(arrangement, sectionIndex);
    const center = (settings.register === "high" ? 72 : 60) + chordPitchClasses(arrangement.key)[0] + (section.role === "chorus" ? 3 : 0);
    const events: { slot: number; motifSlot: number }[] = [];
    for (let slot = 0; slot < sectionSlots; slot++) {
      const motifSlot = slot % motifSlots;
      const local = motifSlot % slotsPerBar;
      const scaledMask = mask.map(position => Math.floor(position * slotsPerBar / 8));
      const base = scaledMask.includes(local);
      const extra = settings.density === "full" && local % pulse === 1;
      if (base || extra) events.push({ slot, motifSlot });
    }
    let previous = center;
    events.forEach(({ slot, motifSlot }, index) => {
      const chordIndex = Math.min(section.chords.length - 1, Math.floor(slot / sectionSlots * section.chords.length));
      const pcs = chordPitchClasses(section.chords[chordIndex]);
      const motifIndex = events.filter(event => event.slot < motifSlots && event.slot <= motifSlot).length - 1;
      const tail = slot >= sectionSlots - slotsPerBar && settings.variation > 0;
      const offset = contour[Math.max(0, motifIndex) % contour.length] + (tail ? settings.variation : 0);
      const target = center + offset;
      const pool = Array.from({ length: 25 }, (_, i) => center - 12 + i).filter(note => pcs.includes(note % 12));
      // Chord-tone anchors, small motion and recurring contour are deliberately
      // favored over random scale notes. Passing tones can be added later.
      const midi = pool.sort((a, b) =>
        (Math.abs(a - target) * 1.5 + Math.abs(a - previous) * 0.5) -
        (Math.abs(b - target) * 1.5 + Math.abs(b - previous) * 0.5) || a - b
      )[0];
      previous = midi;
      const boundary = (chordIndex + 1) * sectionSlots / section.chords.length;
      const next = events[index + 1]?.slot ?? sectionSlots;
      result.push({
        midi, sectionIndex, chordIndex,
        beat: (sectionIndex * sectionSlots + slot) / 2,
        duration: Math.min(next - slot, boundary - slot, 2) / 2 * 0.85,
        velocity: Math.min(0.95, 0.4 + production.energy * 0.004 + (slot % pulse === 0 ? 0.08 : 0))
      });
    });
  });
  return result;
}
