import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement, transposeArrangement } from "./generate";
import { parseProgression, applySectionProgression } from "./progressionInput";
import { DEFAULT_RIFF, buildRiffNotes, riffSettingsAt, setThemeRiff, normalizeRiff } from "./riff";
import { assessHarmony, mineProgressions, referenceRoughness } from "./harmonyMining";
import { buildMidi, encodeWav, buildReferenceNotes } from "../audio/player";
import { chordPitchClasses } from "../domain/music";
import { parseArrangementJson } from "../domain/projectStorage";
import { quarterNotesPerBar } from "../domain/production";
import { buildSunoPromptKit } from "../domain/suno";
import type { Arrangement, TimeSignature } from "../domain/types";

const base = (): Arrangement => ({ ...generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 }), riff: { ...DEFAULT_RIFF } });

describe("chords to riff", () => {
  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("anticipates real anchors and shares their timing with MIDI, WAV and excerpts in %s", meter => {
    const a = applySectionProgression(base(), 0, ["I", "ii", "IV", "V"]);
    a.production.timeSignature = meter;
    a.riff = { ...DEFAULT_RIFF, style: "arpeggio", variation: 0, connection: "anticipate" };
    const notes = buildRiffNotes(a);
    const anticipations = notes.filter(note => note.kind === "anticipation" && note.sectionIndex === 0);
    expect(anticipations.length).toBeGreaterThan(0);
    const sectionBeats = quarterNotesPerBar(meter) * a.production.barsPerSection;
    anticipations.forEach(note => {
      const boundary = (note.chordIndex + 1) * sectionBeats / 4;
      const target = notes.find(next => next.sectionIndex === 0 && next.beat === boundary)!;
      const previous = notes[notes.indexOf(note) - 1];
      expect(note.beat).toBe(boundary - 0.5);
      expect(note.beat * 2 % (meter === "6/8" ? 3 : 2)).not.toBe(0);
      expect(note.midi).toBe(target.midi);
      expect(Math.abs(note.midi - previous.midi)).toBeLessThanOrEqual(2);
      expect(chordPitchClasses(a.sections[0].chords[note.chordIndex])).not.toContain(note.midi % 12);
      expect(previous.beat + previous.duration).toBeLessThanOrEqual(note.beat);
      expect(note.beat + note.duration).toBeLessThanOrEqual(boundary);
    });
    const midi = new Midi(buildMidi(a).toArray());
    const track = midi.tracks.find(track => track.name === "ChordFlow Riff")!;
    expect(track.notes.map(note => note.midi)).toEqual(notes.map(note => note.midi));
    const audio = buildReferenceNotes(a, true);
    expect(audio).toHaveLength(notes.length);
    notes.forEach((note, i) => {
      expect(audio[i].midi).toBe(note.midi);
      expect(audio[i].seconds).toBeCloseTo(0.08 + note.beat * 60 / a.production.tempoBpm);
      expect(audio[i].duration).toBeCloseTo(note.duration * 60 / a.production.tempoBpm);
      expect(track.notes[i].ticks).toBe(Math.round(note.beat * midi.header.ppq));
    });
    expect(buildReferenceNotes(a)).toHaveLength(buildReferenceNotes({ ...a, riff: undefined }).length + notes.length);
    const excerpt = { ...a, sections: [a.sections[1]] };
    expect(buildRiffNotes(excerpt)).toEqual(notes.filter(note => note.sectionIndex === 1).map(note => ({ ...note, sectionIndex: 0, beat: note.beat - sectionBeats })));
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(notes);
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("anticipate the next chord's melody anchor");
  });

  it("does not sacrifice call rests, answer roots or off-grid harmony for an anticipation", () => {
    const a = applySectionProgression(base(), 0, ["I", "ii", "IV", "V"]);
    a.riff = { ...DEFAULT_RIFF, phrase: "call-response", connection: "anticipate", ornament: "passing" };
    const notes = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
    notes.filter(note => note.phrase === "call").forEach(note => expect(note.beat % 4 + note.duration).toBeLessThanOrEqual(3));
    const plain = buildRiffNotes({ ...a, riff: { ...a.riff, connection: "off" } }).filter(note => note.sectionIndex === 0);
    expect(notes.filter(note => note.kind === "resolution")).toEqual(plain.filter(note => note.kind === "resolution"));
    const irregular = applySectionProgression(a, 0, ["I", "ii", "iii", "IV", "V", "vi", "I"]);
    expect(buildRiffNotes(irregular).filter(note => note.sectionIndex === 0 && note.kind === "anticipation")).toHaveLength(0);
    expect(buildRiffNotes({ ...base(), riff: { ...DEFAULT_RIFF, connection: "off" } })).toEqual(buildRiffNotes(base()));
  });

  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("keeps a call's final pulse empty and answers on the last chord root in %s", meter => {
    const barBeats = quarterNotesPerBar(meter);
    const pulseBeats = meter === "6/8" ? 1.5 : 1;
    for (const style of ["arpeggio", "syncopated", "hook"] as const) {
      for (const mode of ["major", "minor"] as const) {
        const original = { ...base(), mode };
        const a = applySectionProgression(original, 0, parseProgression("1234567", "C", mode));
        a.production = { ...a.production, timeSignature: meter, barsPerSection: 2 };
        a.riff = { ...DEFAULT_RIFF, style, phrase: "call-response", density: "full", ornament: "passing", rhythmSeed: 2 };
        const notes = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
        const call = notes.filter(note => note.phrase === "call");
        const response = notes.filter(note => note.phrase === "response");
        expect(call.length).toBeGreaterThan(0);
        call.forEach(note => expect(note.beat + note.duration).toBeLessThanOrEqual(barBeats - pulseBeats));
        const headRhythm = (phrase: typeof notes, offset: number) => phrase.filter(note => note.kind !== "passing" && note.beat - offset < barBeats - pulseBeats).map(note => note.beat - offset);
        expect(headRhythm(call, 0)).toEqual(headRhythm(response, barBeats));
        const last = response.at(-1)!;
        expect(last.kind).toBe("resolution");
        expect(last.chordIndex).toBe(6);
        expect(last.midi % 12).toBe(chordPitchClasses(a.sections[0].chords[6])[0]);
        notes.forEach((note, index) => {
          expect(note.duration).toBeGreaterThan(0);
          expect(note.beat + note.duration).toBeLessThanOrEqual((note.chordIndex + 1) * barBeats * 2 / 7 + 1e-9);
          if (notes[index + 1]) expect(note.beat + note.duration).toBeLessThanOrEqual(notes[index + 1].beat);
          if (note.kind !== "passing") expect(chordPitchClasses(a.sections[0].chords[note.chordIndex])).toContain(note.midi % 12);
        });
      }
    }
  });

  it("reuses the phrase opening and preserves every answer through theme storage, transposition and MIDI", () => {
    const a = setThemeRiff(applySectionProgression(base(), 0, ["I", "I", "I", "I"]), "A", {
      ...DEFAULT_RIFF, style: "arpeggio", phrase: "call-response", ornament: "passing"
    });
    const notes = buildRiffNotes(a);
    const first = notes.filter(note => note.sectionIndex === 0);
    const head = (bar: number) => first.filter(note => note.beat >= bar * 4 && note.beat < bar * 4 + 3 && note.kind !== "passing").map(note => [note.beat % 4, note.midi]);
    expect(head(0)).toEqual(head(1));
    expect(head(2)).toEqual(head(3));
    expect(first.filter(note => note.kind === "resolution").map(note => note.beat)).toEqual([7, 15]);
    expect(notes.filter(note => note.sectionIndex === 1).every(note => note.phrase === undefined)).toBe(true);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(notes);
    expect(buildRiffNotes(transposeArrangement(a, "D")).map(note => note.midi)).toEqual(notes.map(note => note.midi + 2));
    const midi = new Midi(buildMidi(a).toArray());
    const track = midi.tracks.find(track => track.name === "ChordFlow Riff")!;
    expect(track.notes).toHaveLength(notes.length);
    track.notes.forEach((note, i) => {
      expect(note.midi).toBe(notes[i].midi);
      expect(note.ticks).toBe(Math.round(notes[i].beat * midi.header.ppq));
      expect(note.durationTicks).toBe(Math.round(notes[i].duration * midi.header.ppq));
    });
    const blueprint = buildSunoPromptKit(a).chordBlueprint;
    expect(blueprint).toContain("call-response: one-bar call with a final main-pulse rest");
    expect(blueprint).toContain("end each answer on its last chord root");
  });

  it("keeps legacy loops unchanged and normalizes call-response to two bars", () => {
    const a = base();
    expect(normalizeRiff(DEFAULT_RIFF)).toEqual(DEFAULT_RIFF);
    expect(buildRiffNotes({ ...a, riff: { ...DEFAULT_RIFF, phrase: "repeat" } })).toEqual(buildRiffNotes(a));
    expect(normalizeRiff({ ...DEFAULT_RIFF, bars: 1, phrase: "call-response" })?.bars).toBe(2);
    const direct = { ...a, riff: { ...DEFAULT_RIFF, bars: 1 as const, phrase: "call-response" as const } };
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(direct))!)).toEqual(buildRiffNotes(direct));
    expect(buildSunoPromptKit(direct).chordBlueprint).toContain("2-bar motif");
  });

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
    const secondary = applySectionProgression(a, 0, parseProgression("I V7/vi vi vii°7/V V", "C", "major"));
    expect(secondary.sections[0].chords).toEqual(["C", "E7", "Am", "F#dim7", "G"]);
    expect(transposeArrangement(secondary, "D").sections[0].chords).toEqual(["D", "F#7", "Bm", "G#dim7", "A"]);
    expect(parseArrangementJson(JSON.stringify(secondary))?.sections[0].numerals).toEqual(secondary.sections[0].numerals);
    expect(() => parseProgression("I V7/nope", "C", "major")).toThrow();
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

  it("keeps theme motifs independent, preserves silent gaps and restores inheritance", () => {
    const a = setThemeRiff(base(), "A", { ...DEFAULT_RIFF, style: "arpeggio", ornament: "passing", ending: "resolve" });
    const muted = setThemeRiff(a, "B", null);
    expect(riffSettingsAt(muted, 0)).toEqual(riffSettingsAt(muted, 2));
    expect(riffSettingsAt(muted, 1)).toBeUndefined();
    const notes = buildRiffNotes(muted);
    expect(notes.some(note => note.sectionIndex === 1)).toBe(false);
    expect(notes.find(note => note.sectionIndex === 2)!.beat).toBe(32);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(muted))!)).toEqual(notes);
    expect(riffSettingsAt(setThemeRiff(muted, "B", undefined), 1)).toEqual(DEFAULT_RIFF);
    expect(buildSunoPromptKit(muted).chordBlueprint).toContain("Riff: silent in this section.");
    expect(buildSunoPromptKit(muted).chordBlueprint).toContain("weak-beat stepwise passing tones");
    const midi = new Midi(buildMidi(muted).toArray());
    expect(midi.tracks.find(track => track.name === "ChordFlow Riff")!.notes.map(note => note.midi)).toEqual(notes.map(note => note.midi));
  });

  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("uses weak-beat stepwise passing notes and final roots in %s", meter => {
    const a = applySectionProgression(base(), 0, ["I", "I", "I", "I"]);
    a.production.timeSignature = meter;
    a.riff = { ...DEFAULT_RIFF, style: "arpeggio", rhythmSeed: 2, variation: 0, ornament: "passing", ending: "resolve" };
    const notes = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
    const passing = notes.filter(note => note.kind === "passing");
    expect(passing.length).toBeGreaterThan(0);
    passing.forEach(note => {
      const index = notes.indexOf(note);
      const previous = notes[index - 1];
      const next = notes[index + 1];
      expect(note.beat * 2 % (meter === "6/8" ? 3 : 2)).not.toBe(0);
      expect(Math.abs(note.midi - previous.midi)).toBeLessThanOrEqual(2);
      expect(Math.abs(next.midi - note.midi)).toBeLessThanOrEqual(2);
      expect(previous.chordIndex).toBe(next.chordIndex);
      expect(chordPitchClasses("C")).not.toContain(note.midi % 12);
      expect(previous.beat + previous.duration).toBeLessThanOrEqual(note.beat);
      expect(note.beat + note.duration).toBeLessThanOrEqual(next.beat);
    });
    expect(notes.at(-1)!.midi % 12).toBe(0);
    expect(notes.at(-1)!.kind).toBe("resolution");
    const crowded = applySectionProgression(a, 0, ["I", "ii", "iii", "IV", "V", "vi", "ii", "V"]);
    crowded.production.barsPerSection = 2;
    const last = buildRiffNotes(crowded).filter(note => note.sectionIndex === 0).at(-1)!;
    expect(last.chordIndex).toBe(7);
    expect(last.midi % 12).toBe(7);
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
        const ending = candidate.numerals.at(-1)!;
        expect([mode === "major" ? "I" : "i", "V"].includes(ending) || ending.startsWith("V7/")).toBe(true);
        expect(Number.isFinite(candidate.assessment.motion)).toBe(true);
      }
    }
  });
});
