import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement, transposeArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { buildRiffNotes, buildRiffExcerpt, DEFAULT_RIFF, setThemeRiff } from "./riff";
import { riffPitchChoices } from "./riffPitch";
import { chordPitchClasses } from "../domain/music";
import { parseArrangementJson } from "../domain/projectStorage";
import { buildSunoPromptKit } from "../domain/suno";
import { buildMidi, buildReferenceNotes } from "../audio/player";
import type { Arrangement, RiffSettings, TimeSignature } from "../domain/types";

function source(meter: TimeSignature = "4/4"): Arrangement {
  const a = generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 });
  return { ...applySectionProgression(a, 0, ["Imaj9", "vi9", "ii9", "V9"]),
    production: { ...a.production, timeSignature: meter, barsPerSection: 2 },
    riff: { ...DEFAULT_RIFF, density: "full", variation: 0 } };
}
const focused = (a: Arrangement, toneFocus: RiffSettings["toneFocus"]): Arrangement => ({ ...a, riff: { ...a.riff!, toneFocus } });

describe("riff tone focus", () => {
  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("keeps the base rhythm and uses nearby color tones only off the main pulse in %s", meter => {
    const a = source(meter);
    const baseline = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
    for (const focus of ["core", "color"] as const) {
      const notes = buildRiffNotes(focused(a, focus)).filter(note => note.sectionIndex === 0);
      expect(notes.map(note => [note.beat, note.duration, note.velocity])).toEqual(baseline.map(note => [note.beat, note.duration, note.velocity]));
      let colors = 0;
      notes.forEach((note, i) => {
        const pcs = chordPitchClasses(a.sections[0].chords[note.chordIndex]);
        expect(pcs).toContain(note.midi % 12);
        if (focus === "core" || note.beat * 2 % (meter === "6/8" ? 3 : 2) === 0) expect(pcs.slice(0, 3)).toContain(note.midi % 12);
        if (pcs.slice(3).includes(note.midi % 12)) {
          colors++;
          expect(Math.abs(note.midi - notes[i - 1].midi)).toBeLessThanOrEqual(5);
        }
      });
      if (focus === "color") expect(colors).toBeGreaterThan(0);
    }
  });

  it("falls back to the foundation if color tones are too far from the previous note or motif target", () => {
    const pcs = [0, 4, 7, 11, 2];
    const pool = [60, 62, 64, 67, 71, 72, 74, 76, 79];
    expect(riffPitchChoices(pool, pcs, "color", false, 72, 72)).toEqual([71, 74]);
    expect(riffPitchChoices(pool, pcs, "color", false, 60, 79)).toEqual([60, 64, 67, 72, 76, 79]);
    const noWeakAttacks = { ...source(), riff: { ...DEFAULT_RIFF, style: "arpeggio" as const } };
    expect(buildRiffNotes(focused(noWeakAttacks, "color"))).toEqual(buildRiffNotes(focused(noWeakAttacks, "core")));
  });

  it("preserves old defaults, triads, suspended and diminished foundations", () => {
    const a = source();
    expect(buildRiffNotes(focused(a, "balanced"))).toEqual(buildRiffNotes(a));
    expect(buildSunoPromptKit(focused(a, "balanced")).chordBlueprint).toEqual(buildSunoPromptKit(a).chordBlueprint);
    const triads = applySectionProgression(a, 0, ["Isus2", "IVsus4", "vii°", "vi"]);
    for (const focus of ["core", "color"] as const) expect(buildRiffNotes(focused(triads, focus))).toEqual(buildRiffNotes(triads));
  });

  it("protects call rests and root endings while optional ornaments are recalculated", () => {
    const a = source("6/8");
    a.riff = { ...a.riff!, phrase: "call-response", ornament: "passing", connection: "anticipate", handoff: "pickup" };
    for (const focus of ["core", "color"] as const) {
      const notes = buildRiffNotes(focused(a, focus));
      expect(notes.some(note => note.kind === "resolution")).toBe(true);
      notes.forEach(note => {
        if (note.phrase === "call") expect(note.beat % 3 + note.duration).toBeLessThanOrEqual(1.5);
        if (note.kind === "resolution") expect(note.midi % 12).toBe(chordPitchClasses(a.sections[note.sectionIndex].chords[note.chordIndex])[0]);
      });
    }
  });

  it("restores theme preferences and transposes them, with matching excerpt MIDI and WAV", () => {
    const a = setThemeRiff(focused(source(), "core"), "A", { ...source().riff!, toneFocus: "color", handoff: "pickup" });
    const notes = buildRiffNotes(a);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(notes);
    expect(buildRiffNotes(transposeArrangement(a, "D"))).toEqual(notes.map(note => ({ ...note, midi: note.midi + 2 })));
    expect(buildRiffNotes(focused(a, "balanced")).filter(note => note.sectionIndex === 0)).toEqual(notes.filter(note => note.sectionIndex === 0));
    expect(buildRiffNotes(setThemeRiff(a, "A", null)).some(note => note.sectionIndex === 0)).toBe(false);
    const excerpt = buildRiffExcerpt(a, 0);
    const midi = new Midi(buildMidi(excerpt.arrangement, excerpt.riffNotes).toArray());
    expect(midi.tracks.find(track => track.name === "ChordFlow Riff")!.notes.map(note => note.midi)).toEqual(excerpt.riffNotes.map(note => note.midi));
    expect(buildReferenceNotes(excerpt.arrangement, true, excerpt.riffNotes).map(note => note.midi)).toEqual(excerpt.riffNotes.map(note => note.midi));
    expect(buildMidi(focused(source(), "core")).tracks.slice(0, 2).map(track => track.toJSON())).toEqual(buildMidi(source()).tracks.slice(0, 2).map(track => track.toJSON()));
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("riff tone focus:");
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("within five semitones");
  });
});
