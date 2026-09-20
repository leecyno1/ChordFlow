import { describe, it, expect } from "vitest";
import { generateArrangement } from "../engine/generate";
import { DEFAULT_RIFF } from "../engine/riff";
import { buildPlaybackSchedule, comparisonVelocity } from "../audio/player";
import {
  createListeningTrial, appendListeningRecord, loadListeningRecords,
  saveListeningRecord, listeningSummary, LISTENING_LIMIT
} from "./listening";
import { assessHarmony } from "../engine/harmonyMining";

const source = () => ({
  ...generateArrangement({ formId: "aba", key: "D", mode: "minor", style: "独立流行", surprise: 50, seed: 22 }),
  riff: DEFAULT_RIFF
});

describe("blind chord listening", () => {
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
    expect(saveListeningRecord({ ...record, choice: "A" }, storage)).toEqual([record]);
    const restored = loadListeningRecords(storage);
    expect(restored[0].choice).toBe("tie");
    expect(buildPlaybackSchedule(restored[0].trial.candidates.A.arrangement)).toEqual(buildPlaybackSchedule(trial.candidates.A.arrangement));
    expect(listeningSummary(restored)).toContain("0 次有偏好 · 1 次差不多");
    const full = Array.from({ length: LISTENING_LIMIT }, (_, i) => ({ ...record, trial: { ...trial, id: String(i) } }));
    const appended = appendListeningRecord(full, record);
    expect(appended).toHaveLength(LISTENING_LIMIT);
    expect(appended[0].trial.id).toBe("1");
  });

  it("reports unavailable storage without inventing a saved preference", () => {
    const trial = createListeningTrial(source(), 0, () => 0);
    const storage = { getItem: () => "[]", setItem: () => { throw new Error("blocked"); } };
    expect(saveListeningRecord({ trial, choice: "neither", recordedAt: new Date().toISOString() }, storage)).toBeNull();
  });
});
