import { describe, expect, it } from "vitest";
import { generateArrangement, transposeArrangement } from "../engine/generate";
import { setBassOverride } from "./bass";
import { compareArrangements } from "./comparison";
import { chordPitchClasses } from "./music";

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

describe("arrangement comparison", () => {
  it("recognizes identical musical snapshots", () => {
    const source = arrangement();
    expect(compareArrangements(source, source).summary).toBe("方案一致");
  });

  it("separates key changes from harmonic structure changes", () => {
    const source = arrangement();
    const transposed = transposeArrangement(source, "D");
    const comparison = compareArrangements(source, transposed);

    expect(comparison.keyChanged).toBe(true);
    expect(comparison.chordDifferences).toBe(0);
    expect(comparison.summary).toBe("调性");
  });

  it("counts manual bass and generated harmony differences", () => {
    const source = arrangement();
    const pitchClass = chordPitchClasses(source.sections[0].chords[0])[1];
    const anchored = setBassOverride(source, 0, 0, pitchClass);
    const regenerated = arrangement(900);
    const comparison = compareArrangements(anchored, regenerated);

    expect(comparison.bassDifferences).toBe(1);
    expect(comparison.chordDifferences).toBeGreaterThan(0);
  });
});
