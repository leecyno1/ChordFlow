import { describe, it, expect } from "vitest";
import { generateArrangement } from "../engine/generate";
import { DEFAULT_RIFF } from "../engine/riff";
import { buildPlaybackSchedule, comparisonVelocity } from "../audio/player";
import {
  createListeningTrial, appendListeningRecord, loadListeningRecords,
  saveListeningRecord, listeningSummary, templateComparisonSummary, LISTENING_LIMIT
} from "./listening";
import type { ListeningCandidate, ListeningChoice, ListeningRecord } from "./listening";
import { PROGRESSIONS } from "./catalog";
import { applySectionProgression } from "../engine/progressionInput";
import { assessHarmony } from "../engine/harmonyMining";

const source = () => ({
  ...generateArrangement({ formId: "aba", key: "D", mode: "minor", style: "独立流行", surprise: 50, seed: 22 }),
  riff: DEFAULT_RIFF
});

describe("blind chord listening", () => {
  it("preserves an optional judgment reason without altering preference counts", () => {
    const trial = createListeningTrial(source(), 0, () => 0, "template-control");
    const record: ListeningRecord = { trial, choice: "neither", reason: "tension", recordedAt: new Date().toISOString() };
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    expect(saveListeningRecord(record, storage)?.[0].reason).toBe("tension");
    expect(loadListeningRecords(storage)[0].reason).toBe("tension");
    expect(templateComparisonSummary(loadListeningRecords(storage))).toContain("都不喜欢 1 次");
    expect(loadListeningRecords({ getItem: () => JSON.stringify([{ ...record, reason: "unknown" }]) })[0].reason).toBeUndefined();
  });
  it.each(["major", "minor"] as const)("compares a real %s template rotation under equal playback conditions", mode => {
    const original = { ...source(), mode, bassOverrides: { "B:0:0": 2 } };
    const trial = createListeningTrial(original, 1, () => 0, "template-control");
    const { A: template, B: mined } = trial.candidates;
    expect(trial.algorithm).toBe("chordflow-0.23");
    expect(trial.experiment).toBe("template-control");
    expect(template.source).toBe("template");
    expect(mined.source).toBe("mined");
    const reference = PROGRESSIONS.find(item => item.id === template.templateId)!;
    const rotations = reference.numerals.map((_, i) => [...reference.numerals.slice(i), ...reference.numerals.slice(0, i)]);
    expect(rotations).toContainEqual(template.arrangement.sections[0].numerals);
    expect(rotations).not.toContainEqual(mined.arrangement.sections[0].numerals);
    expect(template.arrangement.production).toEqual(mined.arrangement.production);
    for (const candidate of [template, mined]) {
      expect(candidate.arrangement.sections).toHaveLength(1);
      expect(candidate.arrangement.sections[0].numerals).toHaveLength(4);
      expect(candidate.arrangement.sections[0].numerals.at(-1)).toBe(mode === "major" ? "I" : "i");
      expect(candidate.arrangement.sections[0].energy).toBe(60);
      expect(candidate.arrangement.key).toBe(original.key);
      expect(candidate.arrangement.riff).toBeUndefined();
      expect(candidate.arrangement.riffThemes).toBeUndefined();
      expect(candidate.arrangement.bassOverrides).toEqual({});
      expect(candidate.assessment).toEqual(assessHarmony(candidate.arrangement, 0));
    }
    expect(buildPlaybackSchedule(template.arrangement).durationMs).toBe(buildPlaybackSchedule(mined.arrangement).durationMs);
    const randomValues = [0, 0, 0.9];
    const reversed = createListeningTrial(original, 1, () => randomValues.shift()!, "template-control");
    expect(reversed.candidates.A).toEqual(mined);
    expect(reversed.candidates.B).toEqual(template);
    const electronic = createListeningTrial({ ...original, style: "电子氛围" }, 1, () => 0, "template-control");
    // The matching minor-start axis must survive even though its cycle
    // duplicates the earlier axis template, whose genres omit electronic.
    expect(electronic.candidates.A.templateId).toBe(mode === "major" ? "sensitive-loop" : "minor-cinema");
  });

  it("counts preferences by source without treating repeats or legacy trials as new control pairs", () => {
    const trial = createListeningTrial(source(), 0, () => 0, "template-control");
    const shifted = (candidate: ListeningCandidate): ListeningCandidate => {
      const numerals = candidate.arrangement.sections[0].numerals;
      return { ...candidate, arrangement: applySectionProgression({ ...candidate.arrangement, key: "F" }, 0, [...numerals.slice(1), numerals[0]]) };
    };
    const repeat = { ...trial, candidates: { A: shifted(trial.candidates.B), B: shifted(trial.candidates.A) } };
    const records: ListeningRecord[] = (["B", "A", "tie", "neither"] as ListeningChoice[]).map((choice, i) => ({
      trial: { ...(i < 2 ? trial : repeat), id: String(i) }, choice, recordedAt: new Date().toISOString()
    }));
    records.push({ trial: createListeningTrial(source(), 0, () => 0), choice: "A", recordedAt: new Date().toISOString() });
    expect(templateComparisonSummary(records)).toBe("模板对照：偏好挖掘 1 次 · 偏好模板 1 次 · 差不多 1 次 · 都不喜欢 1 次 · 1 组和弦对");
    expect(templateComparisonSummary([{ ...records[0], trial: repeat, choice: "A" }])).toContain("偏好挖掘 1 次 · 偏好模板 0 次");
  });

  it("round-trips template sources and experiment alongside legacy records", () => {
    const trial = createListeningTrial(source(), 0, () => 0, "template-control");
    const record = { trial, choice: "A" as const, recordedAt: new Date().toISOString() };
    const legacy = { ...record, trial: { ...createListeningTrial(source(), 0, () => 0), experiment: undefined } };
    let raw = JSON.stringify([legacy]);
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    expect(saveListeningRecord(record, storage)).toHaveLength(2);
    expect(loadListeningRecords(storage)[1]).toEqual(JSON.parse(JSON.stringify(record)));
    expect(templateComparisonSummary(loadListeningRecords(storage))).toContain("偏好模板 1 次");
  });

  it("randomizes labels and uses equal controls with no riff or bass overrides", () => {
    const original = source();
    original.production.sectionOverrides = { "B:0": { energy: 95, voicingMode: "dramatic" } };
    const withTheme = { ...original, riffThemes: { B: DEFAULT_RIFF } };
    const forward = createListeningTrial(withTheme, 1, () => 0);
    const randomValues = [0.4, 0.8];
    const reverse = createListeningTrial(original, 1, () => randomValues.shift()!);
    expect(forward.candidates.A.name).toBe(reverse.candidates.B.name);
    expect(forward.candidates.B.name).toBe(reverse.candidates.A.name);
    const a = forward.candidates.A.arrangement;
    const b = forward.candidates.B.arrangement;
    expect(a.sections[0].numerals).not.toEqual(b.sections[0].numerals);
    expect(a.production).toEqual(b.production);
    expect(a.production.sectionOverrides).toEqual({});
    expect(a.riff).toBeUndefined();
    expect(a.riffThemes).toBeUndefined();
    expect(a.bassOverrides).toEqual({});
    expect(a.sections[0].role).toBe("chorus");
    expect(a.sections[0].numerals.at(-1)).toBe("i");
    expect(b.sections[0].numerals.at(-1)).toBe("i");
    expect(buildPlaybackSchedule(a).durationMs).toBe(buildPlaybackSchedule(b).durationMs);
    expect(forward.candidates.A.assessment).toEqual(assessHarmony(a, 0));
    expect(original.production.sectionOverrides["B:0"].energy).toBe(95);
    expect(comparisonVelocity(0.7, 5)).toBeLessThan(comparisonVelocity(0.7, 4));
  });

  it("stores decisions once per trial, preserves ties and round-trips playback inputs", () => {
    const trial = createListeningTrial(source(), 0, () => 0);
    const record = { trial, choice: "tie" as const, recordedAt: new Date().toISOString() };
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    expect(saveListeningRecord(record, storage)).toEqual([record]);
    expect(trial.algorithm).toBe("chordflow-0.22");
    expect(saveListeningRecord({ ...record, choice: "A" }, storage)).toEqual([record]);
    const restored = loadListeningRecords(storage);
    expect(restored[0].choice).toBe("tie");
    expect(buildPlaybackSchedule(restored[0].trial.candidates.A.arrangement)).toEqual(buildPlaybackSchedule(trial.candidates.A.arrangement));
    expect(listeningSummary(restored)).toContain("0 次有偏好 · 1 次差不多");
    const full = Array.from({ length: LISTENING_LIMIT }, (_, i) => ({ ...record, trial: { ...trial, id: String(i) } }));
    const appended = appendListeningRecord(full, record);
    expect(appended).toHaveLength(LISTENING_LIMIT);
    expect(appended[0].trial.id).toBe("1");
    const legacy = { ...record, trial: { ...trial, algorithm: "chordflow-0.20" } };
    expect(loadListeningRecords({ getItem: () => JSON.stringify([legacy]) })[0].trial.algorithm).toBe("chordflow-0.20");
  });

  it("reports unavailable storage without inventing a saved preference", () => {
    const trial = createListeningTrial(source(), 0, () => 0);
    const storage = { getItem: () => "[]", setItem: () => { throw new Error("blocked"); } };
    expect(saveListeningRecord({ trial, choice: "neither", recordedAt: new Date().toISOString() }, storage)).toBeNull();
  });
});
