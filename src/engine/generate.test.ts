import { describe, expect, it } from "vitest";
import { romanToChord } from "../domain/music";
import {
  generateArrangement,
  preserveLockedSections,
  regenerateSectionIdentity,
  replaceChord,
  transposeArrangement
} from "./generate";

describe("romanToChord", () => {
  it("converts major-key Roman numerals into chord symbols", () => {
    expect(romanToChord("C", "major", "I")).toBe("C");
    expect(romanToChord("C", "major", "vi")).toBe("Am");
    expect(romanToChord("C", "major", "bVII")).toBe("Bb");
    expect(romanToChord("C", "major", "ii7")).toBe("Dm7");
  });

  it("keeps minor-mode scale degrees and harmonic dominant usable", () => {
    expect(romanToChord("A", "minor", "i")).toBe("Am");
    expect(romanToChord("A", "minor", "VI")).toBe("F");
    expect(romanToChord("A", "minor", "V7")).toBe("E7");
  });
});

describe("generateArrangement", () => {
  it("preserves the identity of repeated letter sections", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 32,
      seed: 18473
    });

    const aSections = arrangement.sections.filter(
      (section) => section.symbol === "A"
    );
    expect(arrangement.lockedSymbols).toEqual([]);
    expect(aSections).toHaveLength(2);
    expect(aSections[0].templateId).toBe(aSections[1].templateId);
    expect(aSections[0].numerals.slice(0, -1)).toEqual(
      aSections[1].numerals.slice(0, -1)
    );
  });

  it("accepts a custom arch/rondo-like pattern", () => {
    const arrangement = generateArrangement({
      formId: "custom",
      customPattern: "ABACABA",
      key: "D",
      mode: "major",
      style: "电影配乐",
      surprise: 61,
      seed: 90210
    });

    expect(arrangement.formPattern).toBe("ABACABA");
    expect(arrangement.sections).toHaveLength(7);
    expect(arrangement.sections.map((section) => section.symbol).join("")).toBe(
      "ABACABA"
    );
  });

  it("supports local chord replacement and global transposition", () => {
    const arrangement = generateArrangement({
      formId: "aba",
      key: "C",
      mode: "major",
      style: "独立流行",
      surprise: 45,
      seed: 420
    });
    const edited = replaceChord(arrangement, 0, 1, "bVII");
    expect(edited.sections[0].numerals[1]).toBe("bVII");
    expect(edited.sections[0].chords[1]).toBe("Bb");

    const transposed = transposeArrangement(edited, "D");
    expect(transposed.sections[0].chords[1]).toBe("C");
    expect(transposed.sections[0].numerals[1]).toBe("bVII");
  });

  it("regenerates one repeated theme without touching other symbols", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const previousA = arrangement.sections.find(
      (section) => section.symbol === "A"
    )!;
    const previousB = arrangement.sections.find(
      (section) => section.symbol === "B"
    )!;
    const regenerated = regenerateSectionIdentity(arrangement, "A", 7781);
    const nextASections = regenerated.sections.filter(
      (section) => section.symbol === "A"
    );

    expect(nextASections[0].templateId).not.toBe(previousA.templateId);
    expect(nextASections[0].templateId).toBe(nextASections[1].templateId);
    expect(nextASections[0].numerals.slice(0, -1)).toEqual(
      nextASections[1].numerals.slice(0, -1)
    );
    expect(regenerated.sections.find((section) => section.symbol === "B")).toBe(
      previousB
    );
  });

  it("preserves locked themes during local and global regeneration", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "D",
      mode: "major",
      style: "独立流行",
      surprise: 48,
      seed: 220
    });
    const locked = { ...arrangement, lockedSymbols: ["B"] };
    const localAttempt = regenerateSectionIdentity(locked, "B", 300);
    const fresh = generateArrangement({
      formId: "ababcb",
      key: "D",
      mode: "major",
      style: "独立流行",
      surprise: 48,
      seed: 301,
      production: arrangement.production
    });
    const merged = preserveLockedSections(locked, fresh);
    const previousB = locked.sections.filter((section) => section.symbol === "B");
    const mergedB = merged.sections.filter((section) => section.symbol === "B");

    expect(localAttempt).toBe(locked);
    expect(merged.lockedSymbols).toEqual(["B"]);
    expect(mergedB).toEqual(previousB);
  });
});
