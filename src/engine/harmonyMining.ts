import { coarseRoman, getCorpusTransitions } from "../domain/corpus";
import { PROGRESSIONS } from "../domain/catalog";
import { chordPitchClasses, romanToChord } from "../domain/music";
import { buildVoicingPlan } from "../domain/voicing";
import type { Arrangement } from "../domain/types";
import { applySectionProgression } from "./progressionInput";

// A reference-spectrum interference proxy, NOT a listener preference model.
// Six harmonic partials with 1/n amplitude; Sethares-style pairwise kernel.
export function referenceRoughness(notes: number[]): number {
  const partials = notes.flatMap(midi => Array.from({ length: 6 }, (_, i) => ({
    hz: 440 * 2 ** ((midi - 69) / 12) * (i + 1), amplitude: 1 / (i + 1)
  })));
  let roughness = 0;
  let weight = 0;
  partials.forEach((first, i) => partials.slice(i + 1).forEach(second => {
    const distance = Math.abs(first.hz - second.hz) * 0.24 / (0.021 * Math.min(first.hz, second.hz) + 19);
    const amplitude = first.amplitude * second.amplitude;
    roughness += amplitude * (Math.exp(-3.5 * distance) - Math.exp(-5.75 * distance));
    weight += amplitude;
  }));
  return weight ? roughness / weight : 0;
}

export interface HarmonyAssessment {
  motion: number;
  roughness: number;
  catalogDistance: number | null;
  surpriseBits: number | null;
  knownTransitions: number;
  totalTransitions: number;
  entryMotion: number | null;
  exitMotion: number | null;
  resolutions: string[];
}

function voiceMotion(a: number[], b: number[]): number {
  const distance = (from: number[], to: number[]) => from.reduce((sum, n) => sum + Math.min(...to.map(m => Math.abs(n - m))), 0) / from.length;
  return (distance(a, b) + distance(b, a)) / 2;
}

function approachTarget(roman: string, arrangement: Arrangement): string | undefined {
  const secondary = roman.match(/^(?:V7|vii°7)\/([b#]*[ivIV]+)$/);
  return secondary?.[1] ?? (roman === "V7" ? (arrangement.mode === "major" ? "I" : "i") : undefined);
}

function matchesTarget(target: string, next: string | undefined, arrangement: Arrangement): boolean {
  if (!next) return false;
  const expected = chordPitchClasses(romanToChord(arrangement.key, arrangement.mode, target));
  const actual = chordPitchClasses(romanToChord(arrangement.key, arrangement.mode, next));
  return expected[0] === actual[0] && expected.every(pc => actual.includes(pc));
}

function harmonicIdentity(roman: string): string {
  return roman.split("/").map(coarseRoman).join("/");
}

export function assessHarmony(arrangement: Arrangement, sectionIndex: number): HarmonyAssessment {
  const section = arrangement.sections[sectionIndex];
  const plan = buildVoicingPlan(arrangement);
  const voicings = plan.sections[sectionIndex];
  const previous = plan.sections[sectionIndex - 1]?.at(-1);
  const next = plan.sections[sectionIndex + 1]?.[0];
  let motion = 0;
  let bits = 0;
  let known = 0;
  for (let i = 1; i < voicings.length; i++) {
    const a = voicings[i - 1].midiNotes;
    const b = voicings[i].midiNotes;
    motion += voiceMotion(a, b);
    const hasSecondary = section.numerals[i - 1].includes("/") || section.numerals[i].includes("/");
    const transition = hasSecondary ? undefined : getCorpusTransitions(section.numerals[i - 1]).find(item => item.to === coarseRoman(section.numerals[i]));
    if (transition && transition.probability > 0) {
      bits += -Math.log2(transition.probability);
      known++;
    }
  }
  const normalized = section.numerals.map(harmonicIdentity);
  // Compare cyclic rotations too: changing only the start is not a new loop.
  const sameLength = PROGRESSIONS.filter(template => template.modes.includes(arrangement.mode) && template.numerals.length === normalized.length);
  const similarity = sameLength.length ? Math.max(...sameLength.flatMap(template =>
    template.numerals.map((_, offset) => normalized.filter((roman, i) => roman === harmonicIdentity(template.numerals[(i + offset) % normalized.length])).length / normalized.length)
  )) : 0;
  const route = [arrangement.sections[sectionIndex - 1]?.numerals.at(-1), ...section.numerals, arrangement.sections[sectionIndex + 1]?.numerals[0]];
  const resolutions = route.flatMap((roman, index) => {
    const target = roman ? approachTarget(roman, arrangement) : undefined;
    return target && matchesTarget(target, route[index + 1], arrangement)
      ? [`${romanToChord(arrangement.key, arrangement.mode, roman!)} → ${romanToChord(arrangement.key, arrangement.mode, route[index + 1]!)}`] : [];
  });
  return {
    motion: motion / Math.max(1, voicings.length - 1),
    roughness: voicings.reduce((sum, voice) => sum + referenceRoughness([voice.bassMidi, ...voice.midiNotes]), 0) / voicings.length,
    catalogDistance: sameLength.length ? 1 - similarity : null,
    surpriseBits: known ? bits / known : null,
    knownTransitions: known, totalTransitions: Math.max(0, voicings.length - 1),
    entryMotion: previous ? voiceMotion(previous.midiNotes, voicings[0].midiNotes) : null,
    exitMotion: next ? voiceMotion(voicings.at(-1)!.midiNotes, next.midiNotes) : null,
    resolutions
  };
}

export interface MinedProgression {
  name: string;
  description: string;
  numerals: string[];
  chords: string[];
  assessment: HarmonyAssessment;
}

export function buildMiningCandidates(arrangement: Arrangement, sectionIndex: number): Omit<MinedProgression, "name" | "description">[] {
  const section = arrangement.sections[sectionIndex];
  const major = arrangement.mode === "major";
  const tonic = major ? "I" : "i";
  const diatonic = major ? ["I", "ii", "iii", "IV", "V", "vi"] : ["i", "III", "iv", "v", "VI", "VII"];
  const colors = major ? ["iv", "bVII", "V7/vi", "V7/ii"] : ["IV", "V7", "ii°", "V7/iv"];
  const previous = arrangement.sections[sectionIndex - 1]?.numerals.at(-1);
  const next = arrangement.sections[sectionIndex + 1]?.numerals[0];
  const entryTarget = previous ? approachTarget(previous, arrangement) : undefined;
  const starts = entryTarget ? [entryTarget] : [tonic, major ? "vi" : "VI"];
  const nextTarget = next && /^[b#]*[ivIV]+(?:7|maj7|6|add9)?$/.test(next) ? coarseRoman(next) : undefined;
  const endings = next ? [...new Set([tonic, "V", ...(nextTarget ? ["V7/" + nextTarget] : [])])] : [tonic];
  const thirdChords = major ? diatonic : [...diatonic, "V"];
  const pool: Omit<MinedProgression, "name" | "description">[] = [];
  for (const first of starts) for (const second of [...diatonic, ...colors]) for (const third of thirdChords) for (const last of endings) {
    const numerals = [first, second, third, last];
    if (numerals.some((n, i) => i > 0 && n === numerals[i - 1])) continue;
    // These are conservative search constraints, not a ban on intentional
    // deceptive or delayed resolutions in manually edited music.
    if (numerals.some((roman, index) => {
      const target = approachTarget(roman, arrangement);
      return target && !matchesTarget(target, numerals[index + 1] ?? next, arrangement);
    })) continue;
    if (!major && second === "ii°" && third !== "V") continue;
    if (numerals.join(" ") === section.numerals.join(" ")) continue;
    const edited = applySectionProgression(arrangement, sectionIndex, numerals);
    pool.push({ numerals, chords: edited.sections[sectionIndex].chords, assessment: assessHarmony(edited, sectionIndex) });
  }
  return pool;
}

export function mineProgressions(arrangement: Arrangement, sectionIndex: number): MinedProgression[] {
  const pool = buildMiningCandidates(arrangement, sectionIndex);
  const targets = [
    { name: "顺耳承接", description: "偏重平滑连接与熟悉路径", novelty: 0.15 },
    { name: "熟悉中转弯", description: "保留调性中心，增加路径差异", novelty: 0.4 },
    { name: "一点异色", description: "尝试借用或次属色彩，留意张力是否适合歌曲", novelty: 0.6 }
  ];
  const chosen: MinedProgression[] = [];
  for (const target of targets) {
    const ranked = pool.filter(candidate => !chosen.some(previous => {
      const a = previous.chords.map(chord => chordPitchClasses(chord).join(","));
      const b = candidate.chords.map(chord => chordPitchClasses(chord).join(","));
      return a.some((_, shift) => a.every((chord, i) => chord === b[(i + shift) % b.length]));
    })).sort((a, b) => {
      const cost = (item: typeof a) => {
        const m = item.assessment;
        // Product heuristics, deliberately not fitted or labeled as beauty scores.
        const color = item.numerals.some(n => n.includes("/") || (arrangement.mode === "major" ? ["iv", "bVII"] : ["IV", "V7", "ii°"]).includes(n));
        return m.motion * 0.55 + Math.abs((m.catalogDistance ?? 0) - target.novelty) * 8 +
          m.roughness * 12 + (m.totalTransitions - m.knownTransitions) * 0.5 +
          ((m.entryMotion ?? 0) + (m.exitMotion ?? 0)) * 0.65 +
          (target.novelty > 0.5 && !color ? 2 : 0);
      };
      return cost(a) - cost(b) || a.numerals.join().localeCompare(b.numerals.join());
    });
    if (ranked[0]) chosen.push({ ...ranked[0], name: target.name, description: target.description });
  }
  return chosen;
}
