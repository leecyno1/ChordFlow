import type { HarmonicFunction, Mode } from "./types";

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

const PITCH_CLASS: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

function degreeFromRoman(roman: string): number {
  const map: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7
  };
  return map[roman.toUpperCase()] ?? 1;
}

export function romanToChord(key: string, mode: Mode, rawRoman: string): string {
  const normalized = rawRoman.replaceAll("♭", "b").replaceAll("♯", "#");
  const secondary = normalized.match(/^(V7|vii°7)\/([b#]*[ivIV]+)$/);
  if (secondary) {
    const [, approach, targetRoman] = secondary;
    const targetChord = romanToChord(key, mode, targetRoman);
    const targetPitch = PITCH_CLASS[chordRoot(targetChord)] ?? 0;
    const approachPitch =
      approach === "V7"
        ? (targetPitch + 7) % 12
        : (targetPitch + 11) % 12;
    const preferFlats =
      targetRoman.startsWith("b") ||
      (FLAT_KEYS.has(key) && !targetRoman.startsWith("#"));
    const root = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[approachPitch];
    return root + (approach === "V7" ? "7" : "dim7");
  }
  const match = normalized.match(/^([b#]*)([ivIV]+)(.*)$/);
  if (!match) return key;

  const [, accidentalPart, numeral, rawSuffix] = match;
  const scale = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  const tonic = PITCH_CLASS[key] ?? 0;
  const degree = degreeFromRoman(numeral);
  const accidental = [...accidentalPart].reduce(
    (total, token) => total + (token === "#" ? 1 : -1),
    0
  );
  const rootPitch = (tonic + scale[degree - 1] + accidental + 12) % 12;
  const preferFlats =
    accidentalPart.includes("b") ||
    (!accidentalPart.includes("#") && (FLAT_KEYS.has(key) || key.includes("b")));
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const root = names[rootPitch];
  const isMinor = numeral === numeral.toLowerCase();
  const suffix = rawSuffix.trim();

  if (suffix.includes("ø") || suffix.includes("m7b5")) return root + "m7b5";
  if (suffix.includes("°7") || suffix.includes("dim7")) return root + "dim7";
  if (suffix.includes("°") || suffix.includes("dim")) return root + "dim";
  if (suffix.startsWith("maj7")) return root + "maj7";
  if (suffix.startsWith("sus2")) return root + "sus2";
  if (suffix.startsWith("sus4")) return root + "sus4";

  const base = isMinor ? "m" : "";
  if (suffix.startsWith("7")) return root + base + "7";
  if (suffix.startsWith("6")) return root + base + "6";
  if (suffix.startsWith("add9")) return root + base + "add9";
  return root + base;
}

export function romanDegree(rawRoman: string): number {
  const match = rawRoman.replaceAll("♭", "b").match(/[ivIV]+/);
  return degreeFromRoman(match?.[0] ?? "I");
}

export function harmonicFunction(roman: string): HarmonicFunction {
  if (roman.includes("b") || roman.includes("#") || roman.includes("♭")) {
    return "chromatic";
  }
  const degree = romanDegree(roman);
  if ([2, 4].includes(degree)) return "predominant";
  if ([5, 7].includes(degree)) return "dominant";
  return "tonic";
}

export function functionLabel(fn: HarmonicFunction): string {
  return {
    tonic: "主功能",
    predominant: "前属功能",
    dominant: "属功能",
    chromatic: "色彩功能"
  }[fn];
}

export function functionColor(fn: HarmonicFunction): string {
  return {
    tonic: "#ff6b78",
    predominant: "#4ed8d0",
    dominant: "#f4b860",
    chromatic: "#b388ff"
  }[fn];
}

export function chordRoot(chord: string): string {
  return chord.match(/^[A-G](?:#|b)?/)?.[0] ?? "C";
}

export function chordPitchClasses(chord: string): number[] {
  const rootName = chordRoot(chord);
  const root = PITCH_CLASS[rootName] ?? 0;
  const quality = chord.slice(rootName.length).split("/")[0];
  let intervals = [0, 4, 7];

  if (quality.includes("m7b5")) intervals = [0, 3, 6, 10];
  else if (quality.includes("dim7")) intervals = [0, 3, 6, 9];
  else if (quality.includes("dim")) intervals = [0, 3, 6];
  else if (quality.includes("maj7")) intervals = [0, 4, 7, 11];
  else if (quality === "m7") intervals = [0, 3, 7, 10];
  else if (quality === "7") intervals = [0, 4, 7, 10];
  else if (quality === "m6") intervals = [0, 3, 7, 9];
  else if (quality === "6") intervals = [0, 4, 7, 9];
  else if (quality.includes("sus2")) intervals = [0, 2, 7];
  else if (quality.includes("sus4")) intervals = [0, 5, 7];
  else if (quality.includes("m")) intervals = [0, 3, 7];

  return intervals.map((interval) => (root + interval) % 12);
}

export function chordNoteNames(chord: string, octave = 3): string[] {
  const pitchClasses = chordPitchClasses(chord);
  return pitchClasses.map((pitch, index) => {
    const noteOctave = octave + (index > 0 && pitch < pitchClasses[0] ? 1 : 0);
    return SHARP_NAMES[pitch] + noteOctave;
  });
}

export function noteNameToMidi(note: string): number {
  const match = note.match(/^([A-G](?:#|b)?)(-?\d+)$/);
  if (!match) return 60;
  const pitch = PITCH_CLASS[match[1]] ?? 0;
  return (Number(match[2]) + 1) * 12 + pitch;
}

export const DISPLAY_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B"
];
