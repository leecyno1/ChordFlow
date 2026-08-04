import { describe, expect, it } from "vitest";
import { buildVoicingPlan } from "../domain/voicing";
import { setBassOverride } from "../domain/bass";
import { chordPitchClasses } from "../domain/music";
import { setSectionProductionOverride } from "../domain/production";
import { generateArrangement } from "../engine/generate";
import { buildMidi } from "./player";

describe("MIDI production grid", () => {
  it("shares tempo, meter and harmonic rhythm with the arrangement", () => {
    const generated = generateArrangement({
      formId: "aba",
      key: "D",
      mode: "major",
      style: "独立流行",
      surprise: 45,
      seed: 102,
      production: {
        tempoBpm: 118,
        timeSignature: "6/8",
        barsPerSection: 8
      }
    });
    const anchorPitchClass = chordPitchClasses(
      generated.sections[0].chords[0]
    )[1];
    const sectionLocked = setSectionProductionOverride(generated, 1, {
      energy: 100,
      voicingMode: "dramatic"
    });
    const arrangement = setBassOverride(
      sectionLocked,
      0,
      0,
      anchorPitchClass
    );
    const midi = buildMidi(arrangement);
    const notes = midi.tracks[0].notes;
    const bassNotes = midi.tracks[1].notes;
    const voicingPlan = buildVoicingPlan(arrangement);
    const noteOnsets = [...new Set(notes.map((note) => note.ticks))];
    const expectedChordTicks = (midi.header.ppq * 3 * 8) / 4;
    const secondSectionTicks = expectedChordTicks * 4;
    const firstSectionVelocity = notes.find((note) => note.ticks === 0)?.velocity;
    const secondSectionVelocity = notes.find(
      (note) => note.ticks === secondSectionTicks
    )?.velocity;

    expect(midi.header.tempos[0].bpm).toBe(118);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([6, 8]);
    expect(notes[0].ticks).toBe(0);
    expect(notes[0].durationTicks).toBe(expectedChordTicks);
    expect(noteOnsets[1]).toBe(expectedChordTicks);
    expect(midi.tracks).toHaveLength(2);
    expect(midi.tracks[1].name).toBe("ChordFlow Bass Guide");
    expect(notes[0].midi).toBe(voicingPlan.chords[0].midiNotes[0]);
    expect(bassNotes[0].midi).toBe(voicingPlan.chords[0].bassMidi);
    expect(bassNotes[0].midi % 12).toBe(anchorPitchClass);
    expect(bassNotes[0].durationTicks).toBe(expectedChordTicks);
    expect(secondSectionVelocity).toBeGreaterThan(firstSectionVelocity ?? 0);
  });
});
