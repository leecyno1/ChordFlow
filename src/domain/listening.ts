import type { Arrangement } from "./types";
import { mineProgressions, assessHarmony } from "../engine/harmonyMining";
import type { HarmonyAssessment } from "../engine/harmonyMining";
import { applySectionProgression } from "../engine/progressionInput";
import { parseArrangementJson } from "./projectStorage";

export const LISTENING_STORAGE_KEY = "chordflow.listening.v1";
export const LISTENING_LIMIT = 200;
export type ListeningSide = "A" | "B";
export type ListeningChoice = ListeningSide | "tie" | "neither";

export interface ListeningCandidate {
  name: string;
  arrangement: Arrangement;
  assessment: HarmonyAssessment;
}

export interface ListeningTrial {
  id: string;
  algorithm: "chordflow-0.20" | "chordflow-0.22";
  candidates: Record<ListeningSide, ListeningCandidate>;
}

export interface ListeningRecord {
  trial: ListeningTrial;
  choice: ListeningChoice;
  recordedAt: string;
}

// Use isolated excerpts with identical controls, without riff or manual bass.
// Assess those same excerpts rather than the voicings of the full song.
export function createListeningTrial(arrangement: Arrangement, sectionIndex: number, random = Math.random): ListeningTrial {
  const section = { ...arrangement.sections[sectionIndex], energy: 60 };
  const baseExcerpt: Arrangement = {
    ...arrangement, title: "和弦盲听", riff: undefined, riffThemes: undefined, lockedSymbols: [], bassOverrides: {},
    formId: "custom", formPattern: section.symbol, sections: [section],
    production: { ...arrangement.production, barsPerSection: 2, voicingMode: "flowing", sectionOverrides: {} }
  };
  // A blind excerpt has no following section. Generate in that same context
  // so an outgoing dominant isn't judged with its resolution cut off.
  const candidates = mineProgressions(baseExcerpt, 0);
  const first = Math.floor(random() * candidates.length);
  const second = (first + 1 + Math.floor(random() * (candidates.length - 1))) % candidates.length;
  const make = (index: number): ListeningCandidate => {
    const candidate = candidates[index];
    const excerpt = applySectionProgression(baseExcerpt, 0, candidate.numerals);
    return { name: candidate.name, arrangement: excerpt, assessment: assessHarmony(excerpt, 0) };
  };
  return {
    id: crypto.randomUUID(), algorithm: "chordflow-0.22",
    candidates: { A: make(first), B: make(second) }
  };
}

export function appendListeningRecord(records: ListeningRecord[], record: ListeningRecord): ListeningRecord[] {
  if (records.some(item => item.trial.id === record.trial.id)) return records;
  return [...records, record].slice(-LISTENING_LIMIT);
}

export function loadListeningRecords(storage?: Pick<Storage, "getItem">): ListeningRecord[] {
  try {
    const parsed = JSON.parse((storage ?? window.localStorage).getItem(LISTENING_STORAGE_KEY) ?? "[]") as ListeningRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-LISTENING_LIMIT).filter(record => {
      if (!record?.trial?.id || !["chordflow-0.20", "chordflow-0.22"].includes(record.trial.algorithm) ||
          !["A", "B", "tie", "neither"].includes(record.choice) || typeof record.recordedAt !== "string") return false;
      return (["A", "B"] as const).every(side => {
        const candidate = record.trial.candidates?.[side];
        return typeof candidate?.name === "string" && parseArrangementJson(JSON.stringify(candidate.arrangement)) !== null;
      });
    });
  } catch { return []; }
}

export function saveListeningRecord(record: ListeningRecord, storage?: Pick<Storage, "getItem" | "setItem">): ListeningRecord[] | null {
  try {
    const target = storage ?? window.localStorage;
    const records = appendListeningRecord(loadListeningRecords(target), record);
    target.setItem(LISTENING_STORAGE_KEY, JSON.stringify(records));
    return records;
  } catch { return null; }
}

export function listeningSummary(records: ListeningRecord[]): string {
  const chosen = records.filter(record => record.choice === "A" || record.choice === "B").length;
  const ties = records.filter(record => record.choice === "tie").length;
  const neither = records.length - chosen - ties;
  return `${records.length} 次记录 · ${chosen} 次有偏好 · ${ties} 次差不多 · ${neither} 次都不喜欢`;
}
