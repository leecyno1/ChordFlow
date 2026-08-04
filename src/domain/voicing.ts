import { chordPitchClasses } from "./music";
import { bassOverrideKey } from "./bass";
import type { Arrangement, VoicingMode } from "./types";

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
];

const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B"
];

const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

interface VoicingCandidate {
  inversion: number;
  midiNotes: number[];
}

export interface ChordVoicing {
  sectionIndex: number;
  chordIndex: number;
  chord: string;
  displayChord: string;
  inversion: number;
  inversionLabel: string;
  bassName: string;
  bassMidi: number;
  bassNote: string;
  isBassOverridden: boolean;
  midiNotes: number[];
  noteNames: string[];
}

export interface VoicingPlan {
  mode: VoicingMode;
  chords: ChordVoicing[];
  sections: ChordVoicing[][];
}

function midiToNoteName(midi: number, preferFlats = false): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass] + octave;
}

function center(notes: number[]): number {
  return notes.reduce((sum, note) => sum + note, 0) / notes.length;
}

function voiceDistance(previous: number[], current: number[]): number {
  const nearest = (note: number, notes: number[]) =>
    Math.min(...notes.map((candidate) => Math.abs(candidate - note)));
  const forward =
    current.reduce((sum, note) => sum + nearest(note, previous), 0) /
    current.length;
  const backward =
    previous.reduce((sum, note) => sum + nearest(note, current), 0) /
    previous.length;
  return (forward + backward) / 2;
}

function candidatesForChord(chord: string): VoicingCandidate[] {
  const pitchClasses = chordPitchClasses(chord);
  return pitchClasses.flatMap((_, inversion) => {
    const rotated = [
      ...pitchClasses.slice(inversion),
      ...pitchClasses.slice(0, inversion)
    ];
    const base: number[] = [];
    rotated.forEach((pitchClass, index) => {
      let midi = 48 + pitchClass;
      while (index > 0 && midi <= base[index - 1]) midi += 12;
      base.push(midi);
    });

    return [-12, 0, 12]
      .map((shift) => ({
        inversion,
        midiNotes: base.map((note) => note + shift)
      }))
      .filter(
        (candidate) =>
          candidate.midiNotes[0] >= 45 &&
          candidate.midiNotes.at(-1)! <= 79
      );
  });
}

function bassCandidates(pitchClass: number): number[] {
  return [24 + pitchClass, 36 + pitchClass, 48 + pitchClass].filter(
    (midi) => midi >= 28 && midi <= 52
  );
}

function closest(items: number[], target: number): number {
  return [...items].sort(
    (a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b
  )[0];
}

function chooseBass(
  pitchClass: number,
  previousBass: number | null,
  mode: VoicingMode,
  globalIndex: number
): number {
  const candidates = bassCandidates(pitchClass);
  if (mode === "stable" || previousBass === null) {
    return closest(candidates, 40);
  }
  if (mode === "flowing") {
    return closest(candidates, previousBass);
  }
  const target = Math.min(
    50,
    Math.max(31, previousBass + (globalIndex % 2 === 0 ? 7 : -7))
  );
  return closest(candidates, target);
}

function chooseCandidate(
  chord: string,
  mode: VoicingMode,
  globalIndex: number,
  isSectionStart: boolean,
  previousNotes: number[] | null,
  previousBass: number | null
): VoicingCandidate {
  const candidates = candidatesForChord(chord);
  const rootCandidates = candidates.filter(
    (candidate) => candidate.inversion === 0
  );

  if (mode === "stable" || previousNotes === null) {
    return [...rootCandidates].sort(
      (a, b) =>
        Math.abs(center(a.midiNotes) - 61) -
        Math.abs(center(b.midiNotes) - 61)
    )[0];
  }

  if (mode === "flowing") {
    if (isSectionStart) {
      return [...rootCandidates].sort(
        (a, b) =>
          voiceDistance(previousNotes, a.midiNotes) -
            voiceDistance(previousNotes, b.midiNotes) ||
          Math.abs(center(a.midiNotes) - 61) -
            Math.abs(center(b.midiNotes) - 61)
      )[0];
    }
    return [...candidates].sort((a, b) => {
      const aBass = chooseBass(
        a.midiNotes[0] % 12,
        previousBass,
        mode,
        globalIndex
      );
      const bBass = chooseBass(
        b.midiNotes[0] % 12,
        previousBass,
        mode,
        globalIndex
      );
      const aScore =
        voiceDistance(previousNotes, a.midiNotes) +
        Math.abs(aBass - (previousBass ?? aBass)) * 0.55 +
        Math.abs(center(a.midiNotes) - 61) * 0.08 +
        a.inversion * 0.75 +
        (aBass === previousBass ? 1.2 : 0);
      const bScore =
        voiceDistance(previousNotes, b.midiNotes) +
        Math.abs(bBass - (previousBass ?? bBass)) * 0.55 +
        Math.abs(center(b.midiNotes) - 61) * 0.08 +
        b.inversion * 0.75 +
        (bBass === previousBass ? 1.2 : 0);
      return aScore - bScore || a.inversion - b.inversion;
    })[0];
  }

  const pitchCount = chordPitchClasses(chord).length;
  const inversionPattern = [
    0,
    Math.min(2, pitchCount - 1),
    1,
    Math.min(1, pitchCount - 1)
  ];
  const targetInversion = inversionPattern[globalIndex % inversionPattern.length];
  const targetCenter = globalIndex % 2 === 0 ? 66 : 56;
  const dramaticCandidates = candidates.filter(
    (candidate) => candidate.inversion === targetInversion
  );
  return [...dramaticCandidates].sort(
    (a, b) =>
      Math.abs(center(a.midiNotes) - targetCenter) -
      Math.abs(center(b.midiNotes) - targetCenter)
  )[0];
}

function applyBassOverride(
  chord: string,
  pitchClass: number,
  fallback: VoicingCandidate,
  previousNotes: number[] | null
): VoicingCandidate {
  const inversion = chordPitchClasses(chord).indexOf(pitchClass);
  if (inversion < 0) return fallback;
  const candidates = candidatesForChord(chord).filter(
    (candidate) => candidate.inversion === inversion
  );
  if (candidates.length === 0) return fallback;

  return [...candidates].sort((a, b) => {
    if (previousNotes) {
      return (
        voiceDistance(previousNotes, a.midiNotes) -
          voiceDistance(previousNotes, b.midiNotes) ||
        Math.abs(center(a.midiNotes) - center(fallback.midiNotes)) -
          Math.abs(center(b.midiNotes) - center(fallback.midiNotes))
      );
    }
    return (
      Math.abs(center(a.midiNotes) - center(fallback.midiNotes)) -
      Math.abs(center(b.midiNotes) - center(fallback.midiNotes))
    );
  })[0];
}

function inversionLabel(inversion: number): string {
  return ["原位", "第一转位", "第二转位", "第三转位"][inversion] ?? "转位";
}

export function buildVoicingPlan(arrangement: Arrangement): VoicingPlan {
  const mode = arrangement.production.voicingMode;
  const chords: ChordVoicing[] = [];
  const sections: ChordVoicing[][] = [];
  let previousNotes: number[] | null = null;
  let previousBass: number | null = null;
  let globalIndex = 0;

  arrangement.sections.forEach((section, sectionIndex) => {
    const sectionVoicings = section.chords.map((chord, chordIndex) => {
      let candidate = chooseCandidate(
        chord,
        mode,
        globalIndex,
        chordIndex === 0,
        previousNotes,
        previousBass
      );
      const pitchClasses = chordPitchClasses(chord);
      const rawOverride = arrangement.bassOverrides[
        bassOverrideKey(section.id, chordIndex)
      ];
      const isBassOverridden =
        typeof rawOverride === "number" && pitchClasses.includes(rawOverride);
      if (isBassOverridden) {
        candidate = applyBassOverride(
          chord,
          rawOverride,
          candidate,
          previousNotes
        );
      }
      const rootPitchClass = pitchClasses[0];
      const bassPitchClass = candidate.midiNotes[0] % 12;
      const interval = (bassPitchClass - rootPitchClass + 12) % 12;
      const preferFlats =
        FLAT_KEYS.has(arrangement.key) ||
        arrangement.key.includes("b") ||
        chord.includes("b") ||
        [3, 6, 8, 10].includes(interval);
      const bassName = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[bassPitchClass];
      const bassMidi = chooseBass(
        bassPitchClass,
        previousBass,
        mode,
        globalIndex
      );
      const voicing: ChordVoicing = {
        sectionIndex,
        chordIndex,
        chord,
        displayChord:
          bassPitchClass === rootPitchClass ? chord : `${chord}/${bassName}`,
        inversion: candidate.inversion,
        inversionLabel: inversionLabel(candidate.inversion),
        bassName,
        bassMidi,
        bassNote: midiToNoteName(bassMidi, preferFlats),
        isBassOverridden,
        midiNotes: candidate.midiNotes,
        noteNames: candidate.midiNotes.map((note) =>
          midiToNoteName(note, preferFlats)
        )
      };
      previousNotes = candidate.midiNotes;
      previousBass = bassMidi;
      globalIndex += 1;
      chords.push(voicing);
      return voicing;
    });
    sections.push(sectionVoicings);
  });

  return { mode, chords, sections };
}

export function voicingMotion(plan: VoicingPlan): number {
  return plan.chords.slice(1).reduce((total, chord, index) => {
    const previous = plan.chords[index];
    return total + voiceDistance(previous.midiNotes, chord.midiNotes);
  }, 0);
}
