import {
  chordPitchClasses,
  pitchClassForName,
  pitchClassName,
  prefersFlatSpelling
} from "./music";
import type { Arrangement } from "./types";

export interface BassAnchorOption {
  pitchClass: number;
  name: string;
}

export function bassOverrideKey(
  sectionId: string,
  chordIndex: number
): string {
  return `${sectionId}:${chordIndex}`;
}

export function bassAnchorOptions(
  chord: string,
  key: string
): BassAnchorOption[] {
  const preferFlats = prefersFlatSpelling(key, chord);
  return chordPitchClasses(chord).map((pitchClass) => ({
    pitchClass,
    name: pitchClassName(pitchClass, preferFlats)
  }));
}

export function bassOverrideAt(
  arrangement: Arrangement,
  sectionIndex: number,
  chordIndex: number
): number | undefined {
  const section = arrangement.sections[sectionIndex];
  if (!section) return undefined;
  return arrangement.bassOverrides[bassOverrideKey(section.id, chordIndex)];
}

export function setBassOverride(
  arrangement: Arrangement,
  sectionIndex: number,
  chordIndex: number,
  pitchClass: number | null
): Arrangement {
  const section = arrangement.sections[sectionIndex];
  const chord = section?.chords[chordIndex];
  if (!section || !chord) return arrangement;

  const key = bassOverrideKey(section.id, chordIndex);
  const nextOverrides = { ...arrangement.bassOverrides };
  if (pitchClass === null) {
    if (!(key in nextOverrides)) return arrangement;
    delete nextOverrides[key];
  } else {
    const normalized = ((Math.round(pitchClass) % 12) + 12) % 12;
    if (!chordPitchClasses(chord).includes(normalized)) return arrangement;
    if (nextOverrides[key] === normalized) return arrangement;
    nextOverrides[key] = normalized;
  }

  return { ...arrangement, bassOverrides: nextOverrides };
}

export function removeBassOverride(
  arrangement: Arrangement,
  sectionId: string,
  chordIndex: number
): Arrangement {
  const key = bassOverrideKey(sectionId, chordIndex);
  if (!(key in arrangement.bassOverrides)) return arrangement;
  const bassOverrides = { ...arrangement.bassOverrides };
  delete bassOverrides[key];
  return { ...arrangement, bassOverrides };
}

export function removeBassOverridesForSections(
  bassOverrides: Record<string, number>,
  sectionIds: Iterable<string>
): Record<string, number> {
  const prefixes = [...sectionIds].map((id) => `${id}:`);
  return Object.fromEntries(
    Object.entries(bassOverrides).filter(
      ([key]) => !prefixes.some((prefix) => key.startsWith(prefix))
    )
  );
}

export function pickBassOverridesForSections(
  bassOverrides: Record<string, number>,
  sectionIds: Iterable<string>
): Record<string, number> {
  const prefixes = [...sectionIds].map((id) => `${id}:`);
  return Object.fromEntries(
    Object.entries(bassOverrides).filter(([key]) =>
      prefixes.some((prefix) => key.startsWith(prefix))
    )
  );
}

export function transposeBassOverrides(
  bassOverrides: Record<string, number>,
  fromKey: string,
  toKey: string
): Record<string, number> {
  const from = pitchClassForName(fromKey);
  const to = pitchClassForName(toKey);
  if (from === null || to === null || from === to) return { ...bassOverrides };
  const delta = (to - from + 12) % 12;
  return Object.fromEntries(
    Object.entries(bassOverrides).map(([key, pitchClass]) => [
      key,
      (pitchClass + delta) % 12
    ])
  );
}
