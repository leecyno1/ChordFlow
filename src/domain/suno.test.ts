import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import { setBassOverride } from "./bass";
import { chordPitchClasses } from "./music";
import { setSectionProductionOverride } from "./production";
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
    expect(kit.sections[0].textureCode).toBe("AIR");
    expect(kit.sections[1].textureCode).toBe("LIFT");
    expect(kit.textureArc).toBe(
      "A:AIR → B:LIFT → A2:CORE → B2:LIFT → C:CORE → B3:LIFT"
    );
    expect(kit.promptAudit.status).toBe("ready");
    expect(kit.promptAudit.styleCharacters).toBeLessThanOrEqual(
      kit.promptAudit.styleBudget
    );
    expect(kit.promptAudit.blueprintCharacters).toBeLessThanOrEqual(
      kit.promptAudit.blueprintBudget
    );
    expect(kit.chordBlueprint).toContain(`TEXTURE ARC: ${kit.textureArc}`);
    expect(kit.chordBlueprint).toContain("Instrumentation:");
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
    expect(textPackage).toContain("TEXTURE ARC:");
    expect(textPackage).toContain("Suno may reinterpret chord instructions");
    expect(textPackage).toContain("CHORDFLOW PROMPT CHECK / INTERNAL");
  });

  it("adapts the same texture arc to each style palette", () => {
    const folk = buildSunoPromptKit(
      generateArrangement({
        formId: "aba",
        key: "G",
        mode: "major",
        style: "民谣",
        surprise: 40,
        seed: 210
      })
    );
    const electronic = buildSunoPromptKit(
      generateArrangement({
        formId: "aba",
        key: "G",
        mode: "major",
        style: "电子氛围",
        surprise: 40,
        seed: 210
      })
    );

    expect(folk.textureArc).toBe(electronic.textureArc);
    expect(folk.sections[0].instrumentationDirection).toContain(
      "fingerpicked acoustic guitar"
    );
    expect(electronic.sections[0].instrumentationDirection).toContain(
      "soft pulse or granular pad"
    );
    expect(folk.sections[1].instrumentationDirection).toContain(
      "strummed and fingerpicked acoustics"
    );
    expect(electronic.sections[1].instrumentationDirection).toContain(
      "luminous synth layers"
    );
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

  it("marks manual bass anchors in Suno directions", () => {
    const arrangement = generateArrangement({
      formId: "aba",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const pitchClass = chordPitchClasses(arrangement.sections[0].chords[0])[1];
    const anchored = setBassOverride(arrangement, 0, 0, pitchClass);
    const kit = buildSunoPromptKit(anchored);

    expect(kit.sections[0].bassLine[0]).toContain("*");
    expect(kit.sections[0].voicings[0]).toContain("/");
    expect(kit.stylePromptEn).toContain("manual bass anchors");
    expect(kit.chordBlueprint).toContain("BASS ANCHORS:");
  });

  it("writes locked section energy, voicing and texture into the Suno blueprint", () => {
    const source = generateArrangement({
      formId: "aba",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const arrangement = setSectionProductionOverride(source, 1, {
      energy: 94,
      voicingMode: "dramatic",
      textureMode: "full"
    });
    const kit = buildSunoPromptKit(arrangement);

    expect(kit.sectionOverrideCount).toBe(1);
    expect(kit.sections[1].energy).toBe(94);
    expect(kit.sections[1].voicingMode).toBe("dramatic");
    expect(kit.sections[1].textureMode).toBe("full");
    expect(kit.sections[1].instrumentationDirection).toContain(
      "layer piano"
    );
    expect(kit.chordBlueprint).toContain(
      "Energy 94/100 | Voicing 戏剧/WIDE | Texture 展开/LIFT LOCKED"
    );
    expect(kit.stylePromptEn).toContain("instrumentation-density");
  });

  it("flags energy and texture combinations that need review", () => {
    const source = generateArrangement({
      formId: "aba",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });
    const highEnergyAir = setSectionProductionOverride(source, 0, {
      energy: 90,
      voicingMode: "flowing",
      textureMode: "sparse"
    });
    const conflicted = setSectionProductionOverride(highEnergyAir, 1, {
      energy: 30,
      voicingMode: "flowing",
      textureMode: "full"
    });
    const kit = buildSunoPromptKit(conflicted);
    const codes = kit.promptAudit.issues.map((issue) => issue.code);

    expect(kit.promptAudit.status).toBe("review");
    expect(codes).toContain("high-energy-air");
    expect(codes).toContain("low-energy-lift");
    expect(serializeSunoPromptKit(kit)).toContain("Status: REVIEW");
  });
});
