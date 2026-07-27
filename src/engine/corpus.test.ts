import { describe, expect, it } from "vitest";
import {
  getChordCorpusStat,
  getCorpusTransitions,
  getProgressionCorpusStat,
  POP909_STATS
} from "../domain/corpus";
import {
  getExactStructurePattern,
  getStructureFamily,
  getStructureRole,
  getStructureTransitions,
  HARMONIX_STATS,
  patternSimilarity
} from "../domain/structureCorpus";
import { romanToChord } from "../domain/music";
import { generateArrangement } from "./generate";
import {
  applyTransitionSuggestion,
  getTransitionSuggestions
} from "./transitions";

describe("POP909 corpus artifact", () => {
  it("exposes traceable corpus metadata and exact progression coverage", () => {
    expect(POP909_STATS.metadata.songCount).toBe(909);
    expect(POP909_STATS.metadata.collapsedChordEventCount).toBeGreaterThan(
      100_000
    );
    expect(getProgressionCorpusStat("axis")?.songCount).toBe(74);
    expect(getProgressionCorpusStat("doo-wop")?.songCount).toBe(102);
  });

  it("provides song coverage and conditional transition probabilities", () => {
    expect(getChordCorpusStat("Imaj7")?.songCoverage).toBeGreaterThan(0.9);
    const tonicTransitions = getCorpusTransitions("Imaj7");
    expect(tonicTransitions[0].to).toBe("V");
    expect(tonicTransitions[0].probability).toBeCloseTo(0.199028, 5);
  });
});

describe("transition workshop", () => {
  it("spells secondary dominants and diminished approaches", () => {
    expect(romanToChord("C", "major", "V7/vi")).toBe("E7");
    expect(romanToChord("C", "major", "vii°7/vi")).toBe("G#dim7");
  });

  it("generates and applies contextual boundary suggestions", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const suggestions = getTransitionSuggestions(arrangement, 0);
    expect(suggestions).toHaveLength(4);
    expect(suggestions.map((item) => item.id)).toEqual([
      "direct",
      "dominant-gate",
      "diminished-thread",
      "modal-veil"
    ]);

    const applied = applyTransitionSuggestion(
      arrangement,
      0,
      suggestions[1]
    );
    expect(applied.sections[0].transitionLabel).toBe("属门槛");
    expect(applied.sections[0].numerals.at(-1)).toBe(suggestions[1].roman);
    expect(applied.sections[0].chords.at(-1)).toBe(suggestions[1].chord);
  });
});

describe("Harmonix structure corpus artifact", () => {
  it("preserves repeated section identities and exposes traceable metadata", () => {
    expect(HARMONIX_STATS.metadata.songCount).toBe(912);
    expect(HARMONIX_STATS.metadata.segmentCount).toBe(9675);
    expect(getExactStructurePattern("AABA")?.songCount).toBe(3);
    expect(getExactStructurePattern("ABABCB")?.songCount).toBe(123);
    expect(getStructureFamily("ABABCBB")?.family.pattern).toBe("ABABCB");
    expect(patternSimilarity("ABABCBB", "ABABCB")).toBeCloseTo(6 / 7, 5);
  });

  it("separates role coverage from adjacent-section probability", () => {
    expect(getStructureRole("verse")?.songCoverage).toBeGreaterThan(0.97);
    expect(getStructureRole("other")?.songCoverage).toBeLessThan(0.05);
    const verseRoutes = getStructureTransitions("verse");
    expect(verseRoutes[0].to).toBe("chorus");
    expect(verseRoutes[0].probability).toBeCloseTo(0.605372, 5);
    expect(getStructureTransitions("prechorus")[0].probability).toBeGreaterThan(
      0.91
    );
  });
});
