import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import { buildVoicingPlan, voicingMotion } from "./voicing";

describe("voicing planner", () => {
  const base = generateArrangement({
    formId: "ababcb",
    key: "C",
    mode: "major",
    style: "华语流行",
    surprise: 34,
    seed: 18473
  });

  it("keeps stable mode in root position", () => {
    const plan = buildVoicingPlan({
      ...base,
      production: { ...base.production, voicingMode: "stable" }
    });

    expect(plan.chords.every((chord) => chord.inversion === 0)).toBe(true);
    expect(plan.chords.every((chord) => chord.displayChord === chord.chord)).toBe(
      true
    );
  });

  it("uses inversions to reduce motion in flowing mode", () => {
    const stable = buildVoicingPlan({
      ...base,
      production: { ...base.production, voicingMode: "stable" }
    });
    const flowing = buildVoicingPlan({
      ...base,
      production: { ...base.production, voicingMode: "flowing" }
    });

    expect(flowing.chords.some((chord) => chord.inversion > 0)).toBe(true);
    expect(voicingMotion(flowing)).toBeLessThanOrEqual(voicingMotion(stable));
  });

  it("creates explicit inversion and bass contrast in dramatic mode", () => {
    const plan = buildVoicingPlan({
      ...base,
      production: { ...base.production, voicingMode: "dramatic" }
    });

    expect(plan.chords[1].inversion).toBe(2);
    expect(plan.chords[1].displayChord).toContain("/");
    expect(
      new Set(plan.chords.map((chord) => chord.bassMidi)).size
    ).toBeGreaterThan(3);
  });
});
