import { describe, expect, it } from "vitest";
import {
  generateArrangement,
  preserveLockedSections,
  replaceChord,
  transposeArrangement
} from "../engine/generate";
import {
  bassAnchorOptions,
  bassOverrideAt,
  setBassOverride
} from "./bass";
import { chordPitchClasses } from "./music";

describe("bass anchors", () => {
  const base = generateArrangement({
    formId: "ababcb",
    key: "C",
    mode: "major",
    style: "华语流行",
    surprise: 34,
    seed: 18473
  });

  it("offers only chord tones with context-aware spelling", () => {
    expect(bassAnchorOptions("Fm7", "Eb").map((option) => option.name)).toEqual([
      "F",
      "Ab",
      "C",
      "Eb"
    ]);
  });

  it("stores a valid anchor and rejects a non-chord tone", () => {
    const chord = base.sections[0].chords[0];
    const chordTones = chordPitchClasses(chord);
    const anchored = setBassOverride(base, 0, 0, chordTones[1]);
    const rejected = setBassOverride(anchored, 0, 0, (chordTones[0] + 1) % 12);

    expect(bassOverrideAt(anchored, 0, 0)).toBe(chordTones[1]);
    expect(rejected).toBe(anchored);
  });

  it("transposes anchors with the song and clears them after chord replacement", () => {
    const chordTones = chordPitchClasses(base.sections[0].chords[0]);
    const anchored = setBassOverride(base, 0, 0, chordTones[1]);
    const transposed = transposeArrangement(anchored, "D");
    const replaced = replaceChord(transposed, 0, 0, "V");

    expect(bassOverrideAt(transposed, 0, 0)).toBe((chordTones[1] + 2) % 12);
    expect(bassOverrideAt(replaced, 0, 0)).toBeUndefined();
  });

  it("keeps anchors only when their theme is locked during reweaving", () => {
    const bPitch = chordPitchClasses(base.sections[1].chords[0])[1];
    const anchored = setBassOverride(base, 1, 0, bPitch);
    const locked = { ...anchored, lockedSymbols: ["B"] };
    const fresh = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 999
    });
    const merged = preserveLockedSections(locked, fresh);

    expect(bassOverrideAt(merged, 1, 0)).toBe(bPitch);
  });
});
