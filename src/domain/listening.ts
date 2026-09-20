import type { Arrangement } from "./types";
import { mineProgressions, assessHarmony } from "../engine/harmonyMining";
import type { HarmonyAssessment } from "../engine/harmonyMining";
import { applySectionProgression } from "../engine/progressionInput";
import { parseArrangementJson } from "./projectStorage";
import { PROGRESSIONS } from "./catalog";
import { chordPitchClasses, romanToChord } from "./music";

export const LISTENING_STORAGE_KEY = "chordflow.listening.v1";
export const LISTENING_LIMIT = 200;
export type ListeningSide = "A" | "B";
export type ListeningChoice = ListeningSide | "tie" | "neither";
export type ListeningExperiment = "mined-pair" | "template-control";
export const LISTENING_REASONS = { flow: "和弦连接", color: "和声色彩", familiarity: "熟悉程度", tension: "张力与释放" };
export type ListeningReason = keyof typeof LISTENING_REASONS;

export interface ListeningCandidate {
  name: string;
  arrangement: Arrangement;
  assessment: HarmonyAssessment;
  source?: "mined" | "template";
  templateId?: string;
}

export interface ListeningTrial {
  id: string;
  algorithm: "chordflow-0.20" | "chordflow-0.22" | "chordflow-0.23";
  experiment?: ListeningExperiment;
  candidates: Record<ListeningSide, ListeningCandidate>;
}

export interface ListeningRecord {
  trial: ListeningTrial;
  choice: ListeningChoice;
  recordedAt: string;
  reason?: ListeningReason;
}

// Use isolated excerpts with identical controls, without riff or manual bass.
// Assess those same excerpts rather than the voicings of the full song.
export function createListeningTrial(arrangement: Arrangement, sectionIndex: number, random = Math.random, experiment: ListeningExperiment = "mined-pair"): ListeningTrial {
  const section = { ...arrangement.sections[sectionIndex], energy: 60 };
  const baseExcerpt: Arrangement = {
    ...arrangement, title: "和弦盲听", riff: undefined, riffThemes: undefined, lockedSymbols: [], bassOverrides: {},
    formId: "custom", formPattern: section.symbol, sections: [section],
    production: { ...arrangement.production, barsPerSection: 2, voicingMode: "flowing", sectionOverrides: {} }
  };
  // A blind excerpt has no following section. Generate in that same context
  // so an outgoing dominant isn't judged with its resolution cut off.
  const candidates = mineProgressions(baseExcerpt, 0);
  const makeCandidate = (name: string, numerals: string[], source: "mined" | "template", templateId?: string): ListeningCandidate => {
    const excerpt = applySectionProgression(baseExcerpt, 0, numerals);
    return { name, source, ...(templateId ? { templateId } : {}), arrangement: excerpt, assessment: assessHarmony(excerpt, 0) };
  };
  if (experiment === "template-control") {
    const tonic = arrangement.mode === "major" ? "I" : "i";
    const eligible = PROGRESSIONS.filter(template => template.modes.includes(arrangement.mode) && template.numerals.length === 4 && template.familiarityIndex >= 75 && template.numerals.includes(tonic));
    const matchesStyle = eligible.filter(template => template.genres.includes(arrangement.style));
    const seen = new Set<string>();
    const baselinePool = (matchesStyle.length ? matchesStyle : eligible)
      .flatMap(template => {
        const tonicIndex = template.numerals.indexOf(tonic);
        // Rotate the original loop, retaining chord order, so both excerpts
        // end at tonic. Do not rewrite a template to manufacture a weak control.
        const numerals = [...template.numerals.slice(tonicIndex + 1), ...template.numerals.slice(0, tonicIndex + 1)];
        const family = progressionFamily(numerals, arrangement);
        if (seen.has(family)) return [];
        seen.add(family);
        return [{ template, numerals }];
      });
    if (!baselinePool.length) throw new Error("当前调式暂无合适的对照模板");
    const baseline = baselinePool[Math.floor(random() * baselinePool.length)];
    const baselineFamily = progressionFamily(baseline.numerals, arrangement);
    const alternatives = candidates.filter(candidate => progressionFamily(candidate.numerals, arrangement) !== baselineFamily);
    if (!alternatives.length) throw new Error("暂无与模板不同的候选，请调整和弦后再试");
    const mined = alternatives[Math.floor(random() * alternatives.length)];
    const pair = [makeCandidate(mined.name, mined.numerals, "mined"), makeCandidate(`${baseline.template.nameZh} · 循环移位`, baseline.numerals, "template", baseline.template.id)];
    const reverse = random() < 0.5;
    return { id: crypto.randomUUID(), algorithm: "chordflow-0.23", experiment,
      candidates: { A: pair[reverse ? 1 : 0], B: pair[reverse ? 0 : 1] } };
  }
  const first = Math.floor(random() * candidates.length);
  const second = (first + 1 + Math.floor(random() * (candidates.length - 1))) % candidates.length;
  const make = (index: number): ListeningCandidate => {
    const candidate = candidates[index];
    return makeCandidate(candidate.name, candidate.numerals, "mined");
  };
  return {
    id: crypto.randomUUID(), algorithm: "chordflow-0.22", experiment,
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
      if (!record?.trial?.id || !["chordflow-0.20", "chordflow-0.22", "chordflow-0.23"].includes(record.trial.algorithm) ||
          !["A", "B", "tie", "neither"].includes(record.choice) || typeof record.recordedAt !== "string") return false;
      return (["A", "B"] as const).every(side => {
        const candidate = record.trial.candidates?.[side];
        return typeof candidate?.name === "string" && parseArrangementJson(JSON.stringify(candidate.arrangement)) !== null;
      });
    }).map(record => record.reason && !Object.hasOwn(LISTENING_REASONS, record.reason) ? { ...record, reason: undefined } : record);
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

function progressionFamily(numerals: string[], arrangement: Arrangement): string {
  const tonic = chordPitchClasses(arrangement.key)[0];
  const chords = numerals.map(roman => chordPitchClasses(romanToChord(arrangement.key, arrangement.mode, roman))
    .map(pc => (pc - tonic + 12) % 12).join(","));
  return chords.map((_, i) => [...chords.slice(i), ...chords.slice(0, i)].join(";")).sort()[0];
}

export function templateComparisonSummary(records: ListeningRecord[]): string {
  let mined = 0, template = 0, ties = 0, neither = 0;
  const pairs = new Set<string>();
  for (const { trial, choice } of records) {
    if (trial.algorithm !== "chordflow-0.23" || trial.experiment !== "template-control") continue;
    const { A, B } = trial.candidates;
    if (![A.source, B.source].includes("mined") || ![A.source, B.source].includes("template")) continue;
    const family = [A, B].map(candidate => progressionFamily(candidate.arrangement.sections[0].numerals, candidate.arrangement)).sort().join("|");
    pairs.add(A.arrangement.mode + ":" + family);
    if (choice === "tie") ties++;
    else if (choice === "neither") neither++;
    else if (trial.candidates[choice].source === "mined") mined++;
    else template++;
  }
  return `模板对照：偏好挖掘 ${mined} 次 · 偏好模板 ${template} 次 · 差不多 ${ties} 次 · 都不喜欢 ${neither} 次 · ${pairs.size} 组和弦对`;
}
