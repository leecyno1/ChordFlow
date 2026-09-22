import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement, transposeArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { buildRiffNotes, buildRiffExcerpt, DEFAULT_RIFF, setThemeRiff, type RiffNote } from "./riff";
import { buildMidi, buildReferenceNotes } from "../audio/player";
import { effectiveSectionProductionAt, setSectionProductionOverride } from "../domain/production";
import { parseArrangementJson } from "../domain/projectStorage";
import { buildSunoPromptKit } from "../domain/suno";
import type { Arrangement, RiffSettings, TimeSignature } from "../domain/types";

function source(meter: TimeSignature = "4/4"): Arrangement {
  const a = generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 });
  return { ...a, production: { ...a.production, timeSignature: meter, barsPerSection: 2 },
    riff: { ...DEFAULT_RIFF, style: "arpeggio", density: "full", variation: 0 } };
}
const withAccent = (a: Arrangement, accent: RiffSettings["accent"]): Arrangement => ({ ...a, riff: { ...a.riff!, accent } });
const withoutVelocity = (notes: RiffNote[]) => notes.map(({ velocity: _velocity, ...note }) => note);

describe("riff dynamics", () => {
  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("reverses pulse emphasis without changing melody or timing in %s", meter => {
    const a = source(meter);
    const original = buildRiffNotes(a);
    const pulse = buildRiffNotes(withAccent(a, "pulse"));
    const offbeat = buildRiffNotes(withAccent(a, "offbeat"));
    expect(withoutVelocity(pulse)).toEqual(withoutVelocity(original));
    expect(withoutVelocity(offbeat)).toEqual(withoutVelocity(original));
    const pulseBeats = meter === "6/8" ? 1.5 : 1;
    original.forEach((note, index) => {
      if (note.beat % pulseBeats === 0) expect(pulse[index].velocity).toBeGreaterThan(offbeat[index].velocity);
      else expect(offbeat[index].velocity).toBeGreaterThan(pulse[index].velocity);
      expect(pulse[index].velocity).toBeGreaterThan(0);
      expect(offbeat[index].velocity).toBeLessThanOrEqual(0.95);
    });
    expect(original.some(note => note.beat % pulseBeats !== 0)).toBe(true);
    if (meter === "6/8") {
      const firstBar = pulse.filter(note => note.beat < 3);
      expect(firstBar.find(note => note.beat === 1.5)?.velocity).toBe(firstBar[0].velocity);
      expect(firstBar.find(note => note.beat === 2)?.velocity).toBeLessThan(firstBar[0].velocity);
    }
  });

  it("preserves the legacy dynamics when omitted or explicitly restored", () => {
    const a = { ...source(), riff: { ...DEFAULT_RIFF, ornament: "passing" as const, connection: "anticipate" as const } };
    expect(buildRiffNotes(withAccent(a, "original"))).toEqual(buildRiffNotes(a));
    expect(buildSunoPromptKit(withAccent(a, "original")).chordBlueprint).toEqual(buildSunoPromptKit(a).chordBlueprint);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(buildRiffNotes(a));
  });

  it("keeps decorations soft and roots supported while preserving call rests", () => {
    const a = applySectionProgression(source(), 0, ["I", "ii", "IV", "V"]);
    a.riff = { ...a.riff!, density: "sparse", phrase: "call-response", ornament: "passing", connection: "anticipate" };
    const original = buildRiffNotes(a);
    expect(original.some(note => note.kind === "passing")).toBe(true);
    expect(original.some(note => note.kind === "anticipation")).toBe(true);
    for (const accent of ["pulse", "offbeat"] as const) {
      const notes = buildRiffNotes(withAccent(a, accent));
      expect(withoutVelocity(notes)).toEqual(withoutVelocity(original));
      notes.forEach(note => {
        const base = 0.4 + effectiveSectionProductionAt(a, note.sectionIndex).energy * 0.004;
        if (note.kind === "resolution") expect(note.velocity).toBeGreaterThanOrEqual(base + 0.04);
        if (note.kind === "passing" || note.kind === "anticipation") expect(note.velocity).toBeLessThan(base - 0.06);
        if (note.phrase === "call") expect(note.beat % 4 + note.duration).toBeLessThanOrEqual(3);
      });
    }
  });

  it("respects theme overrides and energy, and survives JSON and transposition", () => {
    const a = setThemeRiff(withAccent(source("6/8"), "pulse"), "B", { ...DEFAULT_RIFF, accent: "offbeat" });
    const notes = buildRiffNotes(a);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(notes);
    expect(buildRiffNotes(transposeArrangement(a, "D"))).toEqual(notes.map(note => ({ ...note, midi: note.midi + 2 })));
    const changedDefault = buildRiffNotes(withAccent(a, "original"));
    expect(changedDefault.filter(note => note.sectionIndex === 1)).toEqual(notes.filter(note => note.sectionIndex === 1));
    const soft = buildRiffNotes(setSectionProductionOverride(a, 1, { energy: 0, voicingMode: "stable" }));
    const loud = buildRiffNotes(setSectionProductionOverride(a, 1, { energy: 100, voicingMode: "stable" }));
    soft.forEach((note, i) => {
      if (note.sectionIndex === 1) expect(loud[i].velocity).toBeGreaterThan(note.velocity);
      else expect(loud[i].velocity).toBe(note.velocity);
    });
    const blueprint = buildSunoPromptKit(a).chordBlueprint;
    expect(blueprint).toContain("on each dotted-quarter pulse");
    expect(blueprint).toContain("between dotted-quarter pulses");
    expect(buildRiffNotes(setThemeRiff(a, "B", null)).some(note => note.sectionIndex === 1)).toBe(false);
  });

  it("exports the same dynamics to MIDI and WAV, including excerpt handoffs", () => {
    let a = source();
    for (let i = 0; i < 3; i++) a = applySectionProgression(a, i, Array(4).fill(i === 1 ? "ii" : "I"));
    a.riff = { ...a.riff!, density: "sparse", handoff: "pickup" };
    const original = buildRiffNotes(a);
    a = withAccent(a, "offbeat");
    const notes = buildRiffNotes(a);
    expect(withoutVelocity(notes)).toEqual(withoutVelocity(original));
    expect(notes.filter(note => note.kind === "handoff")).toHaveLength(2);
    const excerpt = buildRiffExcerpt(a, 1);
    expect(excerpt.riffNotes).toEqual(notes.filter(note => note.sectionIndex === 1)
      .map(note => ({ ...note, beat: note.beat - 8, sectionIndex: 0 })));
    const midi = new Midi(buildMidi(excerpt.arrangement, excerpt.riffNotes).toArray());
    const track = midi.tracks.find(track => track.name === "ChordFlow Riff")!;
    const audio = buildReferenceNotes(excerpt.arrangement, true, excerpt.riffNotes);
    excerpt.riffNotes.forEach((note, i) => {
      expect(track.notes[i].velocity).toBe(Math.floor(note.velocity * 127) / 127);
      expect(audio[i].gain).toBe(note.velocity * 0.16);
    });
    const legacyMidi = buildMidi(withAccent(a, "original"));
    const newMidi = buildMidi(a);
    expect(newMidi.tracks.slice(0, 2).map(track => track.toJSON())).toEqual(legacyMidi.tracks.slice(0, 2).map(track => track.toJSON()));
  });
});
