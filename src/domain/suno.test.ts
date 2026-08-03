import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import {
  buildSunoPromptKit,
  DEFAULT_TEMPO_BPM,
  serializeSunoPromptKit
} from "./suno";

describe("Suno Bridge prompt kit", () => {
  it("translates an arrangement into a compact copy-ready prompt", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const kit = buildSunoPromptKit(arrangement);

    expect(kit.tempoBpm).toBe(DEFAULT_TEMPO_BPM);
    expect(kit.stylePromptEn).toContain("modern Mandopop");
    expect(kit.stylePromptEn).toContain("C major");
    expect(kit.stylePromptEn).toContain("4/4 meter");
    expect(kit.stylePromptEn.length).toBeLessThan(500);
    expect(kit.chordBlueprint).toContain("SONG FORM: ABABCB");
    expect(kit.chordBlueprint).toContain("[Verse A | 4 bars | Energy");
    expect(kit.chordBlueprint).toContain("[Chorus B | 4 bars | Energy");
    expect(kit.sections).toHaveLength(arrangement.sections.length);
  });

  it("keeps repeated sections and the accuracy notice in the text package", () => {
    const arrangement = generateArrangement({
      formId: "abab",
      key: "A",
      mode: "minor",
      style: "电子氛围",
      surprise: 72,
      seed: 77
    });
    const kit = buildSunoPromptKit(arrangement);
    const textPackage = serializeSunoPromptKit(kit);

    expect(kit.chordBlueprint).toContain("[Verse A2 | 4 bars | Energy");
    expect(kit.chordBlueprint).toContain("[Chorus B2 | 4 bars | Energy");
    expect(textPackage).toContain("SUNO STYLE PROMPT / EN");
    expect(textPackage).toContain("Suno may reinterpret chord instructions");
  });

  it("uses the shared production grid in every Suno output", () => {
    const arrangement = generateArrangement({
      formId: "aba",
      key: "F",
      mode: "major",
      style: "民谣",
      surprise: 42,
      seed: 91,
      production: {
        tempoBpm: 118,
        timeSignature: "6/8",
        barsPerSection: 8,
        voicingMode: "dramatic"
      }
    });
    const kit = buildSunoPromptKit(arrangement);

    expect(kit.tempoBpm).toBe(118);
    expect(kit.timeSignature).toBe("6/8");
    expect(kit.barsPerSection).toBe(8);
    expect(kit.voicingMode).toBe("dramatic");
    expect(kit.stylePromptEn).toContain("118 BPM");
    expect(kit.stylePromptEn).toContain("6/8 meter");
    expect(kit.chordBlueprint).toContain("METER: 6/8");
    expect(kit.chordBlueprint).toContain("8 bars");
    expect(kit.chordBlueprint).toContain("2 bars per chord");
    expect(kit.chordBlueprint).toContain("VOICING MODE: 戏剧 / WIDE");
    expect(kit.chordBlueprint).toContain("Voicing guide:");
    expect(kit.chordBlueprint).toContain("Bass guide:");
  });
});
