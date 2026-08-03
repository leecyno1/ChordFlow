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
    expect(kit.stylePromptEn.length).toBeLessThan(500);
    expect(kit.chordBlueprint).toContain("SONG FORM: ABABCB");
    expect(kit.chordBlueprint).toContain("[Verse A | Energy");
    expect(kit.chordBlueprint).toContain("[Chorus B | Energy");
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

    expect(kit.chordBlueprint).toContain("[Verse A2 | Energy");
    expect(kit.chordBlueprint).toContain("[Chorus B2 | Energy");
    expect(textPackage).toContain("SUNO STYLE PROMPT / EN");
    expect(textPackage).toContain("Suno may reinterpret chord instructions");
  });
});
