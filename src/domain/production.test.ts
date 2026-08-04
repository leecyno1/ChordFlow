import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import {
  effectiveSectionProductionAt,
  normalizeProductionSettings,
  sectionProductionKey,
  setSectionProductionOverride
} from "./production";

function arrangement(seed = 18473) {
  return generateArrangement({
    formId: "ababcb",
    key: "C",
    mode: "major",
    style: "华语流行",
    surprise: 34,
    seed
  });
}

describe("section production overrides", () => {
  it("migrates older production settings and filters malformed overrides", () => {
    const normalized = normalizeProductionSettings({
      tempoBpm: 96,
      sectionOverrides: {
        "A:0": { energy: 120, voicingMode: "dramatic" },
        "bad-key": { energy: 40, voicingMode: "stable" }
      }
    });
    const legacy = normalizeProductionSettings({ tempoBpm: 88 });

    expect(normalized.sectionOverrides).toEqual({
      "A:0": { energy: 100, voicingMode: "dramatic" }
    });
    expect(legacy.sectionOverrides).toEqual({});
  });

  it("locks and clears the effective energy and voicing for one section", () => {
    const source = arrangement();
    const locked = setSectionProductionOverride(source, 0, {
      energy: 38,
      voicingMode: "stable"
    });
    const cleared = setSectionProductionOverride(locked, 0, null);

    expect(effectiveSectionProductionAt(locked, 0)).toEqual({
      energy: 38,
      voicingMode: "stable",
      locked: true
    });
    expect(effectiveSectionProductionAt(cleared, 0).locked).toBe(false);
  });

  it("keeps a section lock across regeneration with new section ids", () => {
    const source = arrangement(100);
    const locked = setSectionProductionOverride(source, 1, {
      energy: 91,
      voicingMode: "dramatic"
    });
    const withStaleLock = setSectionProductionOverride(locked, 3, {
      energy: 72,
      voicingMode: "stable"
    });
    const regenerated = generateArrangement({
      formId: source.formId,
      key: source.key,
      mode: source.mode,
      style: source.style,
      surprise: source.surprise,
      seed: 200,
      production: withStaleLock.production
    });
    const shorter = generateArrangement({
      formId: "aba",
      key: source.key,
      mode: source.mode,
      style: source.style,
      surprise: source.surprise,
      seed: 300,
      production: withStaleLock.production
    });

    expect(regenerated.sections[1].id).not.toBe(source.sections[1].id);
    expect(sectionProductionKey(regenerated.sections[1])).toBe("B:0");
    expect(effectiveSectionProductionAt(regenerated, 1).energy).toBe(91);
    expect(effectiveSectionProductionAt(regenerated, 1).voicingMode).toBe(
      "dramatic"
    );
    expect(shorter.production.sectionOverrides["B:0"]).toBeDefined();
    expect(shorter.production.sectionOverrides["B:1"]).toBeUndefined();
  });
});
