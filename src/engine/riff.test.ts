import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement, transposeArrangement } from "./generate";
import { parseProgression, applySectionProgression } from "./progressionInput";
import { DEFAULT_RIFF, buildRiffNotes } from "./riff";
import { assessHarmony, mineProgressions, referenceRoughness } from "./harmonyMining";
import { buildMidi, encodeWav } from "../audio/player";
import { chordPitchClasses } from "../domain/music";
import { parseArrangementJson } from "../domain/projectStorage";
import { quarterNotesPerBar } from "../domain/production";
import { buildSunoPromptKit } from "../domain/suno";
import type { Arrangement, TimeSignature } from "../domain/types";

const base = (): Arrangement => ({ ...generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 }), riff: { ...DEFAULT_RIFF } });

describe("chords to riff", () => {
  it("accepts degrees and chord symbols without losing quality or transposition", () => {
    expect(parseProgression("1645", "C", "major")).toEqual(["I", "vi", "IV", "V"]);
    const a = applySectionProgression(base(), 0, parseProgression("C–Am–F–G", "C", "major"));
    expect(a.sections[0].chords).toEqual(["C", "Am", "F", "G"]);
    expect(transposeArrangement(a, "D").sections[0].chords).toEqual(["D", "Bm", "G", "A"]);
    expect(parseArrangementJson(JSON.stringify(a))?.sections[0].chords).toEqual(a.sections[0].chords);
    const rich = applySectionProgression(a, 0, parseProgression("Dm7b5 G7 Cadd9 Amadd9", "C", "major"));
    expect(rich.sections[0].chords).toEqual(["Dm7b5", "G7", "Cadd9", "Amadd9"]);
    expect(chordPitchClasses("Cadd9")).toContain(2);
    expect(() => parseProgression("C nope F G", "C", "major")).toThrow();
    expect(parseProgression("1564", "A", "minor")).toEqual(["i", "v", "VI", "iv"]);
  });

  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("fits %s, anchors to current harmony and matches MIDI", meter => {
    const a = base();
    a.production.timeSignature = meter;
    const notes = buildRiffNotes(a);
    const sectionBeats = quarterNotesPerBar(meter) * a.production.barsPerSection;
    notes.forEach(note => {
      expect(chordPitchClasses(a.sections[note.sectionIndex].chords[note.chordIndex])).toContain(note.midi % 12);
      expect(note.duration).toBeGreaterThan(0);
      expect(note.beat + note.duration).toBeLessThanOrEqual((note.sectionIndex + 1) * sectionBeats);
    });
    const midi = new Midi(buildMidi(a).toArray());
    const track = midi.tracks.find(track => track.name === "ChordFlow Riff")!;
    expect(track.notes).toHaveLength(notes.length);
    notes.forEach((note, index) => {
      expect(track.notes[index].midi).toBe(note.midi);
      expect(track.notes[index].ticks).toBe(Math.round(note.beat * midi.header.ppq));
    });
  });

  it("keeps motif rhythm across chord edits, changes pitch separately and restores project settings", () => {
    const a = base();
    const original = buildRiffNotes(a);
    const edited = applySectionProgression(a, 0, ["I", "iv", "ii", "V7"]);
    expect(buildRiffNotes(edited).map(note => note.beat)).toEqual(original.map(note => note.beat));
    const alternate = { ...a, riff: { ...a.riff!, pitchSeed: 1 } };
    expect(buildRiffNotes(alternate).map(note => note.beat)).toEqual(original.map(note => note.beat));
    expect(buildRiffNotes(alternate).map(note => note.midi)).not.toEqual(original.map(note => note.midi));
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(alternate))!)).toEqual(buildRiffNotes(alternate));
    expect(buildRiffNotes(transposeArrangement(a, "D")).map(note => note.midi)).toEqual(original.map(note => note.midi + 2));
    expect(buildSunoPromptKit(alternate).chordBlueprint).toContain("RIFF:");
    expect(buildMidi({ ...a, riff: undefined }).tracks).toHaveLength(2);
  });

  it("encodes a real PCM WAV header and clamps amplitudes", () => {
    const buffer = encodeWav(new Float32Array([-2, 0, 2]), 44100);
    const view = new DataView(buffer);
    expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it("keeps seven-chord sections aligned to exact MIDI bar boundaries", () => {
    const a = applySectionProgression(base(), 0, parseProgression("1234567", "C", "major"));
    const midi = new Midi(buildMidi(a).toArray());
    const end = midi.header.ppq * 4 * a.production.barsPerSection;
    expect(midi.header.meta[1].ticks).toBe(end);
    expect(midi.tracks[1].notes[6].ticks + midi.tracks[1].notes[6].durationTicks).toBe(end);
  });
});

describe("explainable harmony mining", () => {
  it("distinguishes reference interference without calling it beauty", () => {
    expect(referenceRoughness([60, 61])).toBeGreaterThan(referenceRoughness([60, 72]));
    const a = applySectionProgression(base(), 0, ["I", "vi", "IV", "V"]);
    const rotated = applySectionProgression(a, 0, ["vi", "IV", "V", "I"]);
    expect(assessHarmony(a, 0).catalogDistance).toBe(assessHarmony(rotated, 0).catalogDistance);
    expect(assessHarmony(applySectionProgression(a, 0, ["#I", "#II", "#IV", "#V"]), 0).surpriseBits).toBeNull();
  });

  it("mines distinct playable candidates with a tonal anchor and bounded color", () => {
    for (const mode of ["major", "minor"] as const) {
      const a = { ...base(), mode };
      const candidates = mineProgressions(a, 0);
      expect(candidates).toHaveLength(3);
      expect(new Set(candidates.map(candidate => candidate.chords.join())).size).toBe(3);
      for (const candidate of candidates) {
        expect(candidate.numerals).toHaveLength(4);
        expect([mode === "major" ? "I" : "i", "V"]).toContain(candidate.numerals.at(-1));
        expect(Number.isFinite(candidate.assessment.motion)).toBe(true);
      }
    }
  });
});
