import { describe, expect, it } from "vitest";
import { generateArrangement, transposeArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { buildRiffNotes, DEFAULT_RIFF, nextRiffVariation, setThemeRiff } from "./riff";
import { RIFF_VARIANT_COUNT } from "./riffMotif";
import { parseArrangementJson } from "../domain/projectStorage";
import { buildSunoPromptKit } from "../domain/suno";
import { quarterNotesPerBar } from "../domain/production";
import { chordPitchClasses } from "../domain/music";
import type { Arrangement, RiffSettings, TimeSignature } from "../domain/types";

const source = (): Arrangement => applySectionProgression({
  ...generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 }),
  riff: { ...DEFAULT_RIFF }
}, 0, ["I", "ii", "IV", "V"]);

describe("versioned motif variation", () => {
  it("keeps high legacy seeds unchanged and upgrades only the requested dimension", () => {
    const a = source();
    const legacy = { ...DEFAULT_RIFF, rhythmSeed: 28, pitchSeed: 29 };
    expect(buildRiffNotes({ ...a, riff: legacy })).toEqual(buildRiffNotes({ ...a, riff: { ...legacy, rhythmSeed: 1, pitchSeed: 2 } }));
    const restored = parseArrangementJson(JSON.stringify({ ...a, riff: legacy }))!;
    expect(buildRiffNotes(restored)).toEqual(buildRiffNotes({ ...a, riff: legacy }));
    const rhythm = nextRiffVariation(a, 0, legacy, "rhythm");
    expect(rhythm.rhythmVersion).toBe(2);
    expect(rhythm.pitchVersion).toBeUndefined();
    expect(rhythm.pitchSeed).toBe(29);
    const pitch = nextRiffVariation(a, 0, legacy, "pitch");
    expect(pitch.rhythmVersion).toBeUndefined();
    expect(pitch.rhythmSeed).toBe(28);
    expect(pitch.pitchVersion).toBe(2);
    for (let seed = 0; seed < 3; seed++) {
      const original = { ...DEFAULT_RIFF, rhythmSeed: seed, pitchSeed: seed };
      expect(buildRiffNotes({ ...a, riff: { ...original, rhythmVersion: 2, pitchVersion: 2 } })).toEqual(buildRiffNotes({ ...a, riff: original }));
    }
  });

  it.each(["arpeggio", "syncopated", "hook"] as const)("offers more than three distinct realized %s variants and skips identical neighbors", style => {
    const a = source();
    for (const dimension of ["rhythm", "pitch"] as const) {
      let settings: RiffSettings = { ...DEFAULT_RIFF, style };
      const notesFor = (riff: RiffSettings) => buildRiffNotes({ ...a, riff }).filter(note => note.sectionIndex === 0);
      const valuesFor = (riff: RiffSettings) => notesFor(riff).map(note => dimension === "rhythm" ? note.beat : note.midi);
      const variants = new Set([valuesFor(settings).join(",")]);
      for (let i = 0; i < RIFF_VARIANT_COUNT; i++) {
        const next = nextRiffVariation(a, 0, settings, dimension);
        expect(valuesFor(next)).not.toEqual(valuesFor(settings));
        if (dimension === "pitch") expect(notesFor(next).map(note => note.beat)).toEqual(notesFor(settings).map(note => note.beat));
        else expect(next.pitchSeed).toBe(settings.pitchSeed);
        variants.add(valuesFor(next).join(","));
        settings = next;
      }
      expect(variants.size).toBeGreaterThan(3);
    }
  });

  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("keeps new variants on harmony and preserves call rests and answers in %s", meter => {
    const a = source();
    a.production.timeSignature = meter;
    const bar = quarterNotesPerBar(meter);
    const pulse = meter === "6/8" ? 1.5 : 1;
    for (let seed = 0; seed < RIFF_VARIANT_COUNT; seed++) {
      const riff: RiffSettings = { ...DEFAULT_RIFF, rhythmVersion: 2, pitchVersion: 2, rhythmSeed: seed, pitchSeed: seed, phrase: "call-response", ornament: "passing", connection: "anticipate" };
      const notes = buildRiffNotes({ ...a, riff }).filter(note => note.sectionIndex === 0);
      notes.forEach((note, i) => {
        expect(note.duration).toBeGreaterThan(0);
        if (notes[i + 1]) expect(note.beat + note.duration).toBeLessThanOrEqual(notes[i + 1].beat);
        if (note.phrase === "call") expect(note.beat % bar + note.duration).toBeLessThanOrEqual(bar - pulse);
        if (note.kind !== "passing" && note.kind !== "anticipation") expect(chordPitchClasses(a.sections[0].chords[note.chordIndex])).toContain(note.midi % 12);
      });
      const answers = notes.filter(note => note.kind === "resolution");
      expect(answers).toHaveLength(a.production.barsPerSection / 2);
      answers.forEach(note => expect(note.midi % 12).toBe(chordPitchClasses(a.sections[0].chords[note.chordIndex])[0]));
    }
  });

  it("persists independent theme variants and carries their meaning into Suno", () => {
    const a = source();
    const settings: RiffSettings = { ...DEFAULT_RIFF, rhythmVersion: 2, pitchVersion: 2, rhythmSeed: 17, pitchSeed: 4 };
    const themed = setThemeRiff(a, "A", settings);
    const notes = buildRiffNotes(themed);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(themed))!)).toEqual(notes);
    expect(buildRiffNotes(transposeArrangement(themed, "D")).map(note => note.midi)).toEqual(notes.map(note => note.midi + 2));
    expect(buildRiffNotes(themed).filter(note => note.sectionIndex === 1)).toEqual(buildRiffNotes(a).filter(note => note.sectionIndex === 1));
    expect(buildSunoPromptKit(themed).chordBlueprint).toContain("thinned rhythm");
    expect(buildSunoPromptKit(themed).chordBlueprint).toContain("inverted contour");
    expect(buildSunoPromptKit(a).chordBlueprint).not.toContain("motif variation");
  });
});
