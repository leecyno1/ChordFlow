import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { chordNoteNames, chordPitchClasses, DISPLAY_KEYS, noteNameToMidi, romanToChord } from "./music";
import { buildVoicingPlan } from "./voicing";
import { setBassOverride } from "./bass";
import { parseArrangementJson } from "./projectStorage";
import { buildSunoPromptKit } from "./suno";
import { generateArrangement, transposeArrangement } from "../engine/generate";
import { applySectionProgression, parseProgression } from "../engine/progressionInput";
import { assessHarmony, buildMiningCandidates } from "../engine/harmonyMining";
import { buildRiffNotes, DEFAULT_RIFF } from "../engine/riff";
import { buildMidi, buildPlaybackSchedule, buildReferenceNotes } from "../audio/player";

const source = () => generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 });

describe("ninth chord vocabulary", () => {
  it.each([
    ["Cmaj9", "Imaj9", [0, 4, 7, 11, 2]],
    ["Cm9", "i9", [0, 3, 7, 10, 2]],
    ["C9", "I9", [0, 4, 7, 10, 2]]
  ] as const)("preserves the seventh and ninth of %s", (chord, roman, pitches) => {
    expect(chordPitchClasses(chord)).toEqual(pitches);
    expect(romanToChord("C", "major", roman)).toBe(chord);
    expect(parseProgression(`${chord} G`, "C", "major")[0]).toBe(roman);
    expect(chordPitchClasses("Cadd9")).toEqual([0, 4, 7, 2]);
  });

  it("accepts chord names, Roman ninths and secondary ninths without reinterpreting compact digits", () => {
    const expected = ["Imaj9", "vi9", "ii9", "V9"];
    expect(parseProgression("Cmaj9 Am9 Dm9 G9", "C", "major")).toEqual(expected);
    expect(parseProgression(expected.join(" "), "C", "major")).toEqual(expected);
    expect(parseProgression("1645", "C", "major")).toEqual(["I", "vi", "IV", "V"]);
    expect(parseProgression("Am9 Dm9 E9 Am9", "A", "minor")).toEqual(["i9", "iv9", "V9", "i9"]);
    expect(romanToChord("C", "major", "V9/vi")).toBe("E9");
    expect(parseProgression("I V9/vi vi9 V9", "C", "major")).toEqual(["I", "V9/vi", "vi9", "V9"]);
    for (const unsupported of ["C7b9", "C13", "CmMaj9", "imaj9", "V9/nope", "9"]) {
      expect(() => parseProgression(`C ${unsupported}`, "C", "major")).toThrow();
    }
  });

  it("places ninths above the chord in quick audition, including existing add9 chords", () => {
    expect(chordNoteNames("Cmaj9", 3)).toEqual(["C3", "E3", "G3", "B3", "D4"]);
    expect(chordNoteNames("Cadd9", 3)).toEqual(["C3", "E3", "G3", "D4"]);
    expect(chordNoteNames("Gadd9", 3)).toEqual(["G3", "B3", "D4", "A4"]);
    expect(chordNoteNames("G7", 3)).toEqual(["G3", "B3", "D4", "F4"]);
    for (const key of DISPLAY_KEYS) {
      for (const suffix of ["maj9", "m9", "9", "add9", "madd9"]) {
        const notes = chordNoteNames(key + suffix).map(noteNameToMidi);
        expect(notes.every((note, index) => index === 0 || note > notes[index - 1])).toBe(true);
        expect(notes.at(-1)! - notes[0]).toBe(14);
      }
    }
  });

  it("voices all five tones in every key and voicing mode, including a ninth bass anchor", () => {
    const a = applySectionProgression(source(), 0, ["Imaj9", "vi9", "ii9", "V9"]);
    for (const key of DISPLAY_KEYS) {
      for (const voicingMode of ["stable", "flowing", "dramatic"] as const) {
        const transposed = transposeArrangement(a, key);
        const plan = buildVoicingPlan({ ...transposed, production: { ...transposed.production, voicingMode } });
        plan.sections[0].forEach(voice => {
          expect(voice.midiNotes).toHaveLength(5);
          expect(voice.midiNotes.map(note => note % 12).sort((a, b) => a - b)).toEqual(chordPitchClasses(voice.chord).sort((a, b) => a - b));
          expect(voice.midiNotes[0]).toBeGreaterThanOrEqual(45);
          expect(voice.midiNotes.at(-1)).toBeLessThanOrEqual(79);
        });
      }
    }
    const anchored = setBassOverride(a, 0, 0, 2);
    const voice = buildVoicingPlan(anchored).sections[0][0];
    expect(voice.displayChord).toBe("Cmaj9/D");
    expect(voice.inversionLabel).toBe("第四转位");
    expect(buildVoicingPlan(parseArrangementJson(JSON.stringify(anchored))!).sections[0][0]).toEqual(voice);
  });

  it("carries ninths through transposition, JSON, riff generation and real delivery plans", () => {
    const a = { ...applySectionProgression(source(), 0, ["Imaj9", "vi9", "ii9", "V9"]), riff: { ...DEFAULT_RIFF } };
    expect(transposeArrangement(a, "D").sections[0].chords).toEqual(["Dmaj9", "Bm9", "Em9", "A9"]);
    const restored = parseArrangementJson(JSON.stringify(a))!;
    expect(restored.sections[0].chords).toEqual(a.sections[0].chords);
    expect(buildRiffNotes(restored)).toEqual(buildRiffNotes(a));
    const notes = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
    notes.forEach(note => expect(chordPitchClasses(a.sections[0].chords[note.chordIndex])).toContain(note.midi % 12));
    expect(notes.some(note => note.chordIndex === 0 && note.midi % 12 === 2)).toBe(true);
    const midi = new Midi(buildMidi(a).toArray());
    const harmony = midi.tracks.find(track => track.name === "ChordFlow Harmony")!;
    const firstChord = harmony.notes.filter(note => note.ticks === 0);
    expect(firstChord.map(note => note.midi % 12).sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 11]);
    expect(buildPlaybackSchedule(a).steps[0].notes.map(noteNameToMidi).some(note => note % 12 === 2)).toBe(true);
    expect(buildReferenceNotes(a).filter(note => note.seconds === 0.08).some(note => note.midi % 12 === 2)).toBe(true);
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("Cmaj9");
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("V9");
  });

  it("keeps ninth-chord targets in contextual mining without claiming ninth-specific statistics", () => {
    let a = applySectionProgression(source(), 0, ["Imaj9", "IV", "ii9", "V9/vi"]);
    a = applySectionProgression(a, 1, ["vi9", "IV", "V9", "Imaj9"]);
    a = applySectionProgression(a, 2, ["ii9", "V9", "Imaj9", "Imaj9"]);
    const pool = buildMiningCandidates(a, 1);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every(candidate => candidate.numerals[0] === "vi")).toBe(true);
    expect(pool.some(candidate => candidate.numerals.at(-1) === "V7/ii")).toBe(true);
    expect(assessHarmony(a, 1).resolutions).toContain("E9 → Am9");
    expect(assessHarmony(a, 1).resolutions).toContain("G9 → Cmaj9");
  });
});
