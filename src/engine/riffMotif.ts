import type { RiffSettings } from "../domain/types";

const RHYTHMS = {
  arpeggio: [[0, 2, 4, 6], [0, 2, 5, 6], [0, 3, 4, 6]],
  syncopated: [[0, 3, 6], [0, 3, 5], [0, 2, 5, 7]],
  hook: [[0, 2, 3, 6], [0, 1, 4, 6], [0, 3, 4, 7]]
};
const CONTOURS = {
  arpeggio: [[0, 4, 7, 4, 0, 4, 7, 0], [7, 4, 0, 4, 7, 4, 2, 0], [0, 7, 4, 7, 0, 4, 7, 0]],
  syncopated: [[0, 0, 3, 0, 0, 5, 3, 0], [3, 0, 0, 5, 3, 0, 2, 0], [0, 5, 0, 3, 0, 5, 2, 0]],
  hook: [[0, 2, 4, 2, 0, -1, 2, 0], [0, -2, 0, 3, 5, 3, 2, 0], [2, 2, 0, -2, 0, 3, 2, 0]]
};
const RHYTHM_NAMES = ["原型", "尾音提前", "内拍后移", "内拍提前", "后移一格", "抽减留白", "补充短音", "节奏镜像"];
const PITCH_NAMES = ["原型", "轮廓反向", "倒序轮廓", "上移目标", "下移目标", "轮廓移位", "倒序反向", "收窄起伏"];
export const RIFF_VARIANT_COUNT = 24;

export function riffRhythmSlots(settings: RiffSettings, slotsPerBar: number): number[] {
  const base = RHYTHMS[settings.style][settings.rhythmSeed % 3].map(position => Math.floor(position * slotsPerBar / 8));
  if (settings.rhythmVersion !== 2) return base;
  const transform = Math.floor(settings.rhythmSeed / 3) % 8;
  let changed = base;
  if (transform === 1) changed = base.map((slot, i) => i === base.length - 1 ? slot - 1 : slot);
  if (transform === 2) changed = base.map((slot, i) => i === 1 ? slot + 1 : slot);
  if (transform === 3) changed = base.map((slot, i) => i === 1 ? slot - 1 : slot);
  if (transform === 4) changed = base.map(slot => slot ? slot + 1 : 0);
  if (transform === 5) changed = base.filter((_, i) => i !== 1);
  if (transform === 6) {
    const gap = Array.from({ length: slotsPerBar - 1 }, (_, i) => i + 1).find(slot => !base.includes(slot));
    if (gap !== undefined) changed = [...base, gap];
  }
  if (transform === 7) changed = base.map(slot => slot ? slotsPerBar - slot : 0);
  // Keep the first attack, stay on-grid and merge coincident attacks.
  return [...new Set(changed.map(slot => Math.max(0, Math.min(slotsPerBar - 1, slot))))].sort((a, b) => a - b);
}

export function riffContour(settings: RiffSettings): number[] {
  const base = CONTOURS[settings.style][settings.pitchSeed % 3];
  if (settings.pitchVersion !== 2) return base;
  const transform = Math.floor(settings.pitchSeed / 3) % 8;
  const changed = base.map((offset, i) => {
    if (transform === 1) return 2 * base[0] - offset;
    if (transform === 2) return base[base.length - 1 - i];
    if (transform === 3) return offset + 3;
    if (transform === 4) return offset - 3;
    if (transform === 5) return base[(i + 2) % base.length];
    if (transform === 6) return 2 * base[0] - base[base.length - 1 - i];
    if (transform === 7) return Math.round(offset / 2);
    return offset;
  });
  return changed.map(offset => Math.max(-9, Math.min(9, offset)));
}

export function riffVariationLabel(settings: RiffSettings): string {
  const rhythm = settings.rhythmVersion === 2 ? RHYTHM_NAMES[Math.floor(settings.rhythmSeed / 3) % 8] : "经典";
  const pitch = settings.pitchVersion === 2 ? PITCH_NAMES[Math.floor(settings.pitchSeed / 3) % 8] : "经典";
  return `节奏：${rhythm} ${settings.rhythmSeed % 3 + 1} · 音高：${pitch} ${settings.pitchSeed % 3 + 1}`;
}

export function riffVariationPrompt(settings: RiffSettings): string {
  const parts: string[] = [];
  if (settings.rhythmVersion === 2) {
    const names = ["original", "earlier last attack", "delayed inner attack", "earlier inner attack", "delayed non-downbeat attacks", "thinned rhythm", "extra short attack", "mirrored rhythm"];
    parts.push(`rhythm pattern ${settings.rhythmSeed % 3 + 1}: ${names[Math.floor(settings.rhythmSeed / 3) % 8]}`);
  }
  if (settings.pitchVersion === 2) {
    const names = ["original", "inverted contour", "reversed contour", "raised pitch targets", "lowered pitch targets", "rotated contour", "reversed inverted contour", "narrower contour"];
    parts.push(`pitch pattern ${settings.pitchSeed % 3 + 1}: ${names[Math.floor(settings.pitchSeed / 3) % 8]}`);
  }
  return parts.length ? `; motif variation (${parts.join("; ")}); realize pitch targets as current chord tones` : "";
}
