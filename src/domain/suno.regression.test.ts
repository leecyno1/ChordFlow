import { describe, expect, it } from "vitest";
import { generateArrangement } from "../engine/generate";
import { setSectionProductionOverride } from "./production";
import {
  buildSunoPromptKit,
  serializeSunoPromptKit
} from "./suno";
import type { Arrangement } from "./types";

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function promptSnapshot(arrangement: Arrangement) {
  const kit = buildSunoPromptKit(arrangement);
  return {
    bridgeVersion: kit.version,
    stylePromptEn: kit.stylePromptEn,
    textureArc: kit.textureArc,
    sections: kit.sections.map(
      (section) =>
        `${section.label}|E${section.energy}|${section.voicingCode}|${section.textureCode}|${section.chords.join("-")}|${section.instrumentationDirection}`
    ),
    audit: {
      status: kit.promptAudit.status,
      styleCharacters: kit.promptAudit.styleCharacters,
      blueprintCharacters: kit.promptAudit.blueprintCharacters,
      issueCodes: kit.promptAudit.issues.map((issue) => issue.code)
    },
    blueprintFingerprint: fingerprint(kit.chordBlueprint),
    packageFingerprint: fingerprint(serializeSunoPromptKit(kit))
  };
}

function compactPromptSnapshot(arrangement: Arrangement) {
  const kit = buildSunoPromptKit(arrangement);
  return {
    bridgeVersion: kit.version,
    form: kit.form,
    stylePromptFingerprint: fingerprint(kit.stylePromptEn),
    textureArc: kit.textureArc,
    sectionSignatures: kit.sections.map(
      (section) =>
        `${section.label}:${section.textureCode}:${section.voicingCode}:E${section.energy}`
    ),
    sparseDirection: kit.sections.find(
      (section) => section.textureMode === "sparse"
    )?.instrumentationDirection,
    fullDirection: kit.sections.find(
      (section) => section.textureMode === "full"
    )?.instrumentationDirection,
    auditStatus: kit.promptAudit.status,
    issueCodes: kit.promptAudit.issues.map((issue) => issue.code),
    blueprintCharacters: kit.promptAudit.blueprintCharacters,
    blueprintFingerprint: fingerprint(kit.chordBlueprint),
    packageFingerprint: fingerprint(serializeSunoPromptKit(kit))
  };
}

describe("fixed Suno brief regressions", () => {
  it("keeps the default Mandopop production contract stable", () => {
    const arrangement = generateArrangement({
      formId: "ababcb",
      key: "C",
      mode: "major",
      style: "华语流行",
      surprise: 34,
      seed: 18473
    });

    expect(promptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      stylePromptEn:
        "modern Mandopop, dreamlike, bittersweet, twilight-toned, 92 BPM, 4/4 meter, C major, warm piano, clean electric guitar, subtle synth pads, restrained live drums, intimate verses, a wide melodic chorus, polished emotional dynamics, smooth close voice-leading with selective chord inversions, a balanced mix of familiar harmony and selective fresh color",
      textureArc: "A:AIR → B:LIFT → A2:CORE → B2:LIFT → C:CORE → B3:LIFT",
      sections: [
        "Verse A|E52|VOICE|AIR|Cmaj7-Em7-Fmaj7-Fm6|lead with warm piano or clean electric guitar, leaving pads barely audible and drums minimal",
        "Chorus B|E84|VOICE|LIFT|F-G-Em-Am|layer piano, clean guitars and synth pads over active bass and full live drums",
        "Verse A2|E52|VOICE|CORE|Cmaj7-Em7-Fmaj7-G|pair piano and clean guitar with subtle pads, melodic bass and controlled live drums",
        "Chorus B2|E84|VOICE|LIFT|F-G-Em-G|layer piano, clean guitars and synth pads over active bass and full live drums",
        "Bridge C|E56|VOICE|CORE|C-F-Fm-C|pair piano and clean guitar with subtle pads, melodic bass and controlled live drums",
        "Chorus B3|E84|VOICE|LIFT|F-G-Em-C|layer piano, clean guitars and synth pads over active bass and full live drums"
      ],
      audit: {
        status: "ready",
        styleCharacters: 351,
        blueprintCharacters: 3349,
        issueCodes: []
      },
      blueprintFingerprint: "d09f1db9",
      packageFingerprint: "53f6320c"
    });
  });

  it("keeps the slow R&B six-eight contract stable", () => {
    const arrangement = generateArrangement({
      formId: "aaba",
      key: "Eb",
      mode: "minor",
      style: "R&B / Neo Soul",
      surprise: 55,
      seed: 620,
      production: {
        tempoBpm: 76,
        timeSignature: "6/8",
        barsPerSection: 8,
        voicingMode: "flowing"
      }
    });

    expect(promptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      stylePromptEn:
        "contemporary R&B and neo-soul, wide-open, determined, epic, 76 BPM, 6/8 meter, Eb minor, Rhodes electric piano, round bass, muted guitar, laid-back drums, silky pocket, spacious verses, rich chord color and a smooth chorus lift, smooth close voice-leading with selective chord inversions, a balanced mix of familiar harmony and selective fresh color",
      textureArc: "A:AIR → A2:CORE → B:LIFT → A3:CORE",
      sections: [
        "Verse A|E67|VOICE|AIR|Ebm-B-Gb-Db|center Rhodes and muted guitar stabs, with round bass and percussion kept spacious",
        "Verse A2|E67|VOICE|CORE|Ebm-B-Gb-Bb|lock Rhodes, muted guitar, round melodic bass and laid-back drums into a focused pocket",
        "Chorus B|E75|VOICE|LIFT|Ebm-Abm-B-Bb|layer Rhodes color, guitar responses and vocal-space pads over active bass and a full relaxed groove",
        "Verse A3|E67|VOICE|CORE|Ebm-B-Gb-Ebm|lock Rhodes, muted guitar, round melodic bass and laid-back drums into a focused pocket"
      ],
      audit: {
        status: "ready",
        styleCharacters: 349,
        blueprintCharacters: 2362,
        issueCodes: []
      },
      blueprintFingerprint: "de5815e6",
      packageFingerprint: "cfdd9b31"
    });
  });

  it("keeps an intentional electronic REVIEW contract stable", () => {
    const base = generateArrangement({
      formId: "abcba",
      key: "A",
      mode: "minor",
      style: "电子氛围",
      surprise: 72,
      seed: 77,
      production: {
        tempoBpm: 108,
        timeSignature: "4/4",
        barsPerSection: 4,
        voicingMode: "dramatic"
      }
    });
    const arrangement = setSectionProductionOverride(base, 0, {
      energy: 86,
      voicingMode: "dramatic",
      textureMode: "sparse"
    });

    expect(promptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      stylePromptEn:
        "atmospheric electronic pop, wide-open, determined, epic, 108 BPM, 4/4 meter, A minor, soft pulse synth, granular pads, deep electronic bass, minimal programmed drums, slow-blooming texture, spacious verses and a luminous layered chorus, contrasting inversions, wider register motion and a cinematic bass path, follow the section-specific energy, voicing and instrumentation-density directions in the chord blueprint, distinctive chord color while keeping every transition coherent",
      textureArc: "A:AIR → B:LIFT → C:CORE → B2:LIFT → A2:CORE",
      sections: [
        "Verse A|E86|WIDE|AIR|Am-F-C-G|lead with a soft pulse or granular pad, holding deep bass and programmed drums to fragments",
        "Chorus B|E85|WIDE|LIFT|Am-G-F-E|stack luminous synth layers over active deep bass, full programmed drums and selective counter-melodies",
        "Bridge C|E69|WIDE|CORE|Am-Dm-F-E|combine pulse synth, granular pads, deep bass and controlled programmed drums in a focused grid",
        "Chorus B2|E85|WIDE|LIFT|Am-G-F-E|stack luminous synth layers over active deep bass, full programmed drums and selective counter-melodies",
        "Verse A2|E67|WIDE|CORE|Am-F-C-Am|combine pulse synth, granular pads, deep bass and controlled programmed drums in a focused grid"
      ],
      audit: {
        status: "review",
        styleCharacters: 480,
        blueprintCharacters: 3045,
        issueCodes: ["high-energy-air"]
      },
      blueprintFingerprint: "51c2f7a5",
      packageFingerprint: "242dddc6"
    });
  });

  it("covers independent pop with a long custom form", () => {
    const arrangement = generateArrangement({
      formId: "custom",
      customPattern: "ABACABA",
      key: "D",
      mode: "major",
      style: "独立流行",
      surprise: 48,
      seed: 311
    });

    expect(compactPromptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      form: "ABACABA",
      stylePromptFingerprint: "1711b1aa",
      textureArc:
        "A:AIR → B:LIFT → A2:CORE → C:CORE → A3:CORE → B2:LIFT → A4:CORE",
      sectionSignatures: [
        "Verse A:AIR:VOICE:E62",
        "Chorus B:LIFT:VOICE:E84",
        "Verse A2:CORE:VOICE:E62",
        "Bridge C:CORE:VOICE:E56",
        "Verse A3:CORE:VOICE:E62",
        "Chorus B2:LIFT:VOICE:E84",
        "Verse A4:CORE:VOICE:E62"
      ],
      sparseDirection:
        "feature one textured guitar with dry room tone, holding synth, bass and drums back",
      fullDirection:
        "stack contrasting guitars and analog synth around active melodic bass and broader live drums",
      auditStatus: "ready",
      issueCodes: [],
      blueprintCharacters: 3733,
      blueprintFingerprint: "3af41485",
      packageFingerprint: "7a52f62c"
    });
  });

  it("covers rock with dramatic voicing at a fast tempo", () => {
    const arrangement = generateArrangement({
      formId: "abab",
      key: "F#",
      mode: "major",
      style: "摇滚",
      surprise: 46,
      seed: 9001,
      production: {
        tempoBpm: 128,
        timeSignature: "4/4",
        barsPerSection: 4,
        voicingMode: "dramatic"
      }
    });

    expect(compactPromptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      form: "ABAB",
      stylePromptFingerprint: "dde298d6",
      textureArc: "A:AIR → B:LIFT → A2:CORE → B2:LIFT",
      sectionSignatures: [
        "Verse A:AIR:WIDE:E52",
        "Chorus B:LIFT:WIDE:E79",
        "Verse A2:CORE:WIDE:E52",
        "Chorus B2:LIFT:WIDE:E79"
      ],
      sparseDirection:
        "start with one restrained electric guitar, light bass support and minimal acoustic drums",
      fullDirection:
        "open stacked electric guitars, driving bass and punchy full drums while keeping synth support selective",
      auditStatus: "ready",
      issueCodes: [],
      blueprintCharacters: 2681,
      blueprintFingerprint: "cb732651",
      packageFingerprint: "163145b5"
    });
  });

  it("covers folk in three-four with stable voicing", () => {
    const arrangement = generateArrangement({
      formId: "aba",
      key: "G",
      mode: "major",
      style: "民谣",
      surprise: 38,
      seed: 210,
      production: {
        tempoBpm: 78,
        timeSignature: "3/4",
        barsPerSection: 8,
        voicingMode: "stable"
      }
    });

    expect(compactPromptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      form: "ABA",
      stylePromptFingerprint: "178da7c8",
      textureArc: "A:AIR → B:LIFT → A2:CORE",
      sectionSignatures: [
        "Verse A:AIR:ROOT:E66",
        "Chorus B:LIFT:ROOT:E79",
        "Verse A2:CORE:ROOT:E66"
      ],
      sparseDirection:
        "lead with fingerpicked acoustic guitar, with soft piano, bass and brushes barely entering",
      fullDirection:
        "widen strummed and fingerpicked acoustics around piano, active bass and a warm full percussion lift",
      auditStatus: "ready",
      issueCodes: [],
      blueprintCharacters: 1891,
      blueprintFingerprint: "c2808745",
      packageFingerprint: "55e1d0e5"
    });
  });

  it("covers cinematic minor harmony in slow six-eight", () => {
    const arrangement = generateArrangement({
      formId: "abcba",
      key: "D",
      mode: "minor",
      style: "电影配乐",
      surprise: 68,
      seed: 451,
      production: {
        tempoBpm: 68,
        timeSignature: "6/8",
        barsPerSection: 8,
        voicingMode: "dramatic"
      }
    });

    expect(compactPromptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      form: "ABCBA",
      stylePromptFingerprint: "5350fd61",
      textureArc: "A:AIR → B:LIFT → C:CORE → B2:LIFT → A2:CORE",
      sectionSignatures: [
        "Verse A:AIR:WIDE:E71",
        "Chorus B:LIFT:WIDE:E75",
        "Bridge C:CORE:WIDE:E75",
        "Chorus B2:LIFT:WIDE:E75",
        "Verse A2:CORE:WIDE:E71"
      ],
      sparseDirection:
        "expose felt piano with distant string air and almost no low percussion",
      fullDirection:
        "expand into wide strings, layered synth atmosphere and decisive low percussion around the harmonic peak",
      auditStatus: "ready",
      issueCodes: [],
      blueprintCharacters: 2940,
      blueprintFingerprint: "4a76ffdd",
      packageFingerprint: "e1dd36dd"
    });
  });

  it("covers jazz pop with flowing voicing and rondo returns", () => {
    const arrangement = generateArrangement({
      formId: "abaca",
      key: "Bb",
      mode: "major",
      style: "爵士流行",
      surprise: 58,
      seed: 731,
      production: {
        tempoBpm: 112,
        timeSignature: "4/4",
        barsPerSection: 4,
        voicingMode: "flowing"
      }
    });

    expect(compactPromptSnapshot(arrangement)).toEqual({
      bridgeVersion: "0.8",
      form: "ABACA",
      stylePromptFingerprint: "03b14785",
      textureArc: "A:AIR → B:LIFT → A2:CORE → C:CORE → A3:CORE",
      sectionSignatures: [
        "Verse A:AIR:VOICE:E48",
        "Chorus B:LIFT:VOICE:E74",
        "Verse A2:CORE:VOICE:E48",
        "Bridge C:CORE:VOICE:E71",
        "Verse A3:CORE:VOICE:E48"
      ],
      sparseDirection:
        "feature acoustic piano or hollow-body guitar with sparse upright bass and brushes",
      fullDirection:
        "open piano voicings, active upright bass, fuller brushed drums and selective guitar counterlines",
      auditStatus: "ready",
      issueCodes: [],
      blueprintCharacters: 2890,
      blueprintFingerprint: "28914ffa",
      packageFingerprint: "a15023d5"
    });
  });
});
