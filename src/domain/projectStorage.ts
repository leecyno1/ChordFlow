import { bassOverrideKey } from "./bass";
import { chordPitchClasses, DISPLAY_KEYS, romanToChord } from "./music";
import { normalizeProductionSettings } from "./production";
import type {
  Arrangement,
  Mode,
  SectionRole,
  SongSection
} from "./types";

export const LOCAL_PROJECT_KEY = "chordflow.project.v1";
export const LOCAL_PROJECT_SCHEMA_VERSION = 1;

export interface SavedProject {
  schemaVersion: typeof LOCAL_PROJECT_SCHEMA_VERSION;
  savedAt: string;
  arrangement: Arrangement;
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMode(value: unknown): value is Mode {
  return value === "major" || value === "minor";
}

function isSectionRole(value: unknown): value is SectionRole {
  return (
    value === "intro" ||
    value === "verse" ||
    value === "prechorus" ||
    value === "chorus" ||
    value === "bridge" ||
    value === "outro"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSongSection(value: unknown): value is SongSection {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.symbol === "string" &&
    typeof value.occurrence === "number" &&
    Number.isInteger(value.occurrence) &&
    value.occurrence >= 0 &&
    isSectionRole(value.role) &&
    typeof value.title === "string" &&
    typeof value.templateId === "string" &&
    isStringArray(value.numerals) &&
    value.numerals.length > 0 &&
    typeof value.energy === "number" &&
    Number.isFinite(value.energy)
  );
}

function normalizeBassOverrides(
  value: unknown,
  sections: SongSection[]
): Record<string, number> {
  if (!isRecord(value)) return {};
  const entries: Array<[string, number]> = [];

  sections.forEach((section) => {
    section.chords.forEach((chord, chordIndex) => {
      const key = bassOverrideKey(section.id, chordIndex);
      const pitchClass = value[key];
      if (
        typeof pitchClass === "number" &&
        Number.isInteger(pitchClass) &&
        pitchClass >= 0 &&
        pitchClass < 12 &&
        chordPitchClasses(chord).includes(pitchClass)
      ) {
        entries.push([key, pitchClass]);
      }
    });
  });

  return Object.fromEntries(entries);
}

function normalizeArrangement(value: unknown): Arrangement | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.title !== "string" ||
    typeof value.key !== "string" ||
    !DISPLAY_KEYS.includes(value.key) ||
    !isMode(value.mode) ||
    typeof value.formId !== "string" ||
    typeof value.formPattern !== "string" ||
    typeof value.style !== "string" ||
    typeof value.surprise !== "number" ||
    !Number.isFinite(value.surprise) ||
    typeof value.seed !== "number" ||
    !Number.isFinite(value.seed) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0 ||
    !value.sections.every(isSongSection)
  ) {
    return null;
  }

  const sections = value.sections.map((section) => ({
    ...section,
    symbol: section.symbol.toUpperCase(),
    numerals: [...section.numerals],
    chords: section.numerals.map((roman) =>
      romanToChord(value.key as string, value.mode as Mode, roman)
    )
  }));
  const availableSymbols = new Set(sections.map((section) => section.symbol));
  const lockedSymbols = isStringArray(value.lockedSymbols)
    ? [...new Set(value.lockedSymbols.map((symbol) => symbol.toUpperCase()))]
        .filter((symbol) => availableSymbols.has(symbol))
        .sort()
    : [];

  return {
    title: value.title,
    key: value.key,
    mode: value.mode,
    formId: value.formId,
    formPattern: value.formPattern.toUpperCase(),
    style: value.style,
    surprise: Math.min(100, Math.max(0, Math.round(value.surprise))),
    seed: Math.round(value.seed),
    lockedSymbols,
    bassOverrides: normalizeBassOverrides(value.bassOverrides, sections),
    production: normalizeProductionSettings(
      isRecord(value.production) ? value.production : undefined
    ),
    sections,
    generatedAt:
      typeof value.generatedAt === "string"
        ? value.generatedAt
        : new Date(0).toISOString()
  };
}

export function serializeLocalProject(
  arrangement: Arrangement,
  savedAt = new Date()
): string {
  return JSON.stringify({
    schemaVersion: LOCAL_PROJECT_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    arrangement
  } satisfies SavedProject);
}

export function parseLocalProject(raw: string | null): SavedProject | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== LOCAL_PROJECT_SCHEMA_VERSION) {
      return null;
    }
    const arrangement = normalizeArrangement(value.arrangement);
    if (!arrangement || typeof value.savedAt !== "string") return null;

    return {
      schemaVersion: LOCAL_PROJECT_SCHEMA_VERSION,
      savedAt: value.savedAt,
      arrangement
    };
  } catch {
    return null;
  }
}

export function parseArrangementJson(raw: string): Arrangement | null {
  const savedProject = parseLocalProject(raw);
  if (savedProject) return savedProject.arrangement;

  try {
    return normalizeArrangement(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveLocalProject(
  arrangement: Arrangement,
  storage: StorageWriter | null = browserStorage(),
  savedAt = new Date()
): SavedProject | null {
  if (!storage) return null;
  const raw = serializeLocalProject(arrangement, savedAt);

  try {
    storage.setItem(LOCAL_PROJECT_KEY, raw);
    return parseLocalProject(raw);
  } catch {
    return null;
  }
}

export function loadLocalProject(
  storage: StorageReader | null = browserStorage()
): SavedProject | null {
  if (!storage) return null;

  try {
    return parseLocalProject(storage.getItem(LOCAL_PROJECT_KEY));
  } catch {
    return null;
  }
}
