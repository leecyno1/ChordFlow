import { describe, expect, it } from "vitest";
import { generateArrangement, transposeArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { applyTransitionSuggestion, buildTransitionPreview, getTransitionSuggestions } from "./transitions";
import { chordPitchClasses } from "../domain/music";
import { buildVoicingPlan } from "../domain/voicing";
import { bassOverrideAt, setBassOverride } from "../domain/bass";

function song() {
  const generated = generateArrangement({ formId: "aba", key: "C", mode: "major", style: "独立流行", surprise: 35, seed: 12 });
  const verse = applySectionProgression(generated, 0, ["I", "vi", "IV", "V"]);
  return applySectionProgression(verse, 1, ["vi", "IV", "I", "V"]);
}

describe("transition preview matches the applied boundary", () => {
  it.each(["major", "minor"] as const)("approaches the sounding root of secondary and chromatic entrances in %s", mode => {
    for (const key of ["C", "Eb", "F#", "A"]) {
      for (const entrance of ["V7/vi", "V9/ii", "vii°7/V", "bIImaj9"]) {
        const arrangement = applySectionProgression({ ...transposeArrangement(song(), key), mode }, 1, [entrance, "I"]);
        const target = chordPitchClasses(arrangement.sections[1].chords[0])[0];
        const suggestions = getTransitionSuggestions(arrangement, 0);
        expect(chordPitchClasses(suggestions[1].chord)[0]).toBe((target + 7) % 12);
        expect(chordPitchClasses(suggestions[2].chord)[0]).toBe((target + 11) % 12);
      }
    }
    const secondaryEntrance = applySectionProgression(song(), 1, ["V7/vi", "vi"]);
    expect(getTransitionSuggestions(secondaryEntrance, 0)[1].chord).toBe("B7");
  });

  it("previews applied voicings and bass anchors without changing the source", () => {
    const base = song();
    const arrangement = setBassOverride(setBassOverride(setBassOverride({ ...base,
      production: { ...base.production, voicingMode: "dramatic" }
    }, 0, 2, 9), 0, 3, 11), 1, 0, 0);
    const saved = JSON.stringify(arrangement);
    for (const suggestion of getTransitionSuggestions(arrangement, 0)) {
      const applied = applyTransitionSuggestion(arrangement, 0, suggestion);
      const expected = buildVoicingPlan(applied);
      const preview = buildTransitionPreview(arrangement, 0, suggestion);
      expect(preview).toEqual([...expected.sections[0].slice(-2), expected.sections[1][0]]);
      expect(preview.map(chord => chord.chord)).toEqual(suggestion.previewChords);
      expect(bassOverrideAt(applied, 0, 2)).toBe(9);
      expect(bassOverrideAt(applied, 1, 0)).toBe(0);
      expect(bassOverrideAt(applied, 0, 3)).toBe(suggestion.id === "direct" ? 11 : undefined);
      const refreshed = getTransitionSuggestions(applied, 0).find(candidate => candidate.id === suggestion.id)!;
      expect(buildTransitionPreview(applied, 0, refreshed)).toEqual(preview);
    }
    expect(JSON.stringify(arrangement)).toBe(saved);
  });

  it("previews the retained penultimate chord, replacement ending and next entrance", () => {
    const arrangement = song();
    const saved = JSON.stringify(arrangement);
    for (const suggestion of getTransitionSuggestions(arrangement, 0)) {
      const applied = applyTransitionSuggestion(arrangement, 0, suggestion);
      expect(suggestion.previewChords).toEqual([...applied.sections[0].chords.slice(-2), applied.sections[1].chords[0]]);
      expect(applied.sections[0].chords.slice(0, -1)).toEqual(arrangement.sections[0].chords.slice(0, -1));
      expect(applied.sections[0].chords).toHaveLength(4);
      expect(applied.sections[1]).toBe(arrangement.sections[1]);
    }
    expect(JSON.stringify(arrangement)).toBe(saved);
    expect(getTransitionSuggestions(arrangement, 0)[1].previewChords).toEqual(["F", "E7", "Am"]);
  });

  it("uses only the replaced ending and entrance when the source has one chord", () => {
    const arrangement = applySectionProgression(song(), 0, ["I"]);
    for (const suggestion of getTransitionSuggestions(arrangement, 0)) {
      expect(suggestion.previewChords).toEqual([suggestion.chord, "Am"]);
    }
    expect(getTransitionSuggestions(arrangement, 2)).toEqual([]);
  });
});
