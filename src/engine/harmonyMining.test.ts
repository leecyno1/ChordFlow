import { describe, expect, it } from "vitest";
import { generateArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { assessHarmony, buildMiningCandidates, mineProgressions } from "./harmonyMining";
import { chordPitchClasses, romanToChord } from "../domain/music";

const source = (mode: "major" | "minor" = "major") => generateArrangement({ formId: "aba", key: "C", mode, style: "独立流行", surprise: 50, seed: 27 });

describe("contextual harmonic search", () => {
  it("only proposes applied dominants with an immediate matching target", () => {
    const a = source();
    const pool = buildMiningCandidates(a, 0);
    expect(pool.some(candidate => candidate.numerals[1] === "V7/vi")).toBe(true);
    expect(pool.some(candidate => candidate.numerals[1] === "V7/ii")).toBe(true);
    for (const candidate of pool) {
      candidate.numerals.forEach((roman, index) => {
        if (!roman.includes("/")) return;
        const target = roman.split("/")[1];
        const next = candidate.numerals[index + 1] ?? a.sections[1].numerals[0];
        const targetPcs = chordPitchClasses(romanToChord(a.key, a.mode, target));
        const nextPcs = chordPitchClasses(romanToChord(a.key, a.mode, next));
        expect(nextPcs[0]).toBe(targetPcs[0]);
        expect(targetPcs.every(pc => nextPcs.includes(pc))).toBe(true);
      });
    }
  });

  it("respects an incoming applied dominant and keeps the final section closed", () => {
    for (const mode of ["major", "minor"] as const) {
      const a = applySectionProgression(source(mode), 0, [mode === "major" ? "I" : "i", "IV", "ii", "V7/iv"]);
      const pool = buildMiningCandidates(a, 1);
      expect(pool.length).toBeGreaterThan(3);
      expect(pool.every(candidate => candidate.numerals[0] === "iv")).toBe(true);
      expect(mineProgressions(a, 1)).toHaveLength(3);
      expect(buildMiningCandidates(a, 2).every(candidate => candidate.numerals.at(-1) === (mode === "major" ? "I" : "i"))).toBe(true);
    }
  });

  it("offers an outgoing target approach and reports both real boundaries", () => {
    let a = applySectionProgression(source(), 2, ["vi", "IV", "V", "I"]);
    const pool = buildMiningCandidates(a, 1);
    expect(pool.some(candidate => candidate.numerals.at(-1) === "V7/vi")).toBe(true);
    a = applySectionProgression(a, 1, ["I", "IV", "ii", "V7/vi"]);
    const middle = assessHarmony(a, 1);
    expect(middle.entryMotion).not.toBeNull();
    expect(middle.exitMotion).not.toBeNull();
    expect(middle.resolutions).toContain("E7 → Am");
    expect(assessHarmony(a, 0).entryMotion).toBeNull();
    expect(assessHarmony(a, 2).exitMotion).toBeNull();
    const other = applySectionProgression(a, 2, ["#iv", "IV", "V", "I"]);
    expect(assessHarmony(other, 1).exitMotion).not.toBe(middle.exitMotion);
  });
});
