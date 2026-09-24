import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { applyProgressionText, applySectionProgression } from "./progressionInput";
import { generateArrangement, transposeArrangement } from "./generate";
import { buildRiffNotes, DEFAULT_RIFF } from "./riff";
import { bassOverrideAt, setBassOverride } from "../domain/bass";
import { buildVoicingPlan } from "../domain/voicing";
import { noteNameToMidi } from "../domain/music";
import { parseArrangementJson, serializeLocalProject } from "../domain/projectStorage";
import { buildSunoPromptKit } from "../domain/suno";
import { buildMidi, buildPlaybackSchedule, buildReferenceNotes } from "../audio/player";

const source = () => ({ ...generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 }), riff: { ...DEFAULT_RIFF } });

describe("slash-chord input", () => {
  it("separates note-name basses from Roman secondary targets in mixed input", () => {
    const original = source();
    const saved = JSON.stringify(original);
    const result = applyProgressionText(original, 0, "C/E Am/C 4 G7/B V7/vi vi");
    expect(result.sections[0].numerals).toEqual(["I", "vi", "IV", "V7", "V7/vi", "vi"]);
    expect(result.sections[0].chords).toEqual(["C", "Am", "F", "G7", "E7", "Am"]);
    expect(result.sections[0].chords.map((_, index) => bassOverrideAt(result, 0, index))).toEqual([4, 0, undefined, 11, undefined, undefined]);
    expect(result.sections[1]).toBe(original.sections[1]);
    expect(result.sections[2]).toBe(original.sections[2]);
    expect(JSON.stringify(original)).toBe(saved);
    expect(applyProgressionText(original, 0, "1645").sections[0].numerals).toEqual(["I", "vi", "IV", "V"]);
  });

  it("accepts minor-key inversions, Unicode accidentals and extended chord tones", () => {
    const minor = { ...source(), key: "A", mode: "minor" as const };
    expect(applyProgressionText(minor, 0, "Am/C Dm/F E7/G# Am/E").sections[0].numerals).toEqual(["i", "iv", "V7", "i"]);
    const extended = applyProgressionText(source(), 0, "B♭maj7/D F♯m/A Cmaj9/D C/B#");
    expect(extended.sections[0].chords).toEqual(["Bbmaj7", "Gbm", "Cmaj9", "C"]);
    expect(extended.sections[0].chords.map((_, index) => bassOverrideAt(extended, 0, index))).toEqual([2, 9, 2, 0]);
    expect(buildVoicingPlan(extended).sections[0][2].inversionLabel).toBe("第四转位");
  });

  it("rejects external basses and unsupported slash syntax without partially applying", () => {
    const original = source();
    const saved = JSON.stringify(original);
    expect(() => applyProgressionText(original, 0, "C/E Am/D")).toThrow("D 不是 Am 的和弦音");
    for (const input of ["C/E G/H", "C/E9 G", "C/E/G Am", "V7/vi/G# Am", "I/E V", "C/E", "C/E G C G C G C G C"]) {
      expect(() => applyProgressionText(original, 0, input)).toThrow();
    }
    expect(JSON.stringify(original)).toBe(saved);
  });

  it("replaces only the edited section's anchors and resets unspecified basses to auto", () => {
    const base = applySectionProgression(source(), 1, ["I", "V"]);
    const otherAnchor = setBassOverride(base, 1, 0, 4);
    const first = applyProgressionText(otherAnchor, 0, "C/E Am/C F/A G/B");
    const next = applyProgressionText(first, 0, "C G/B");
    expect(bassOverrideAt(next, 0, 0)).toBeUndefined();
    expect(bassOverrideAt(next, 0, 1)).toBe(11);
    expect(bassOverrideAt(next, 0, 2)).toBeUndefined();
    expect(bassOverrideAt(next, 1, 0)).toBe(4);
    expect(Object.keys(next.bassOverrides)).toHaveLength(2);
  });

  it("restores and transposes inversions using the existing project format", () => {
    const result = applyProgressionText(source(), 0, "C/E Am/C F/A G/B");
    const restored = parseArrangementJson(serializeLocalProject(result))!;
    expect(restored.bassOverrides).toEqual(result.bassOverrides);
    expect(buildVoicingPlan(restored)).toEqual(buildVoicingPlan(result));
    const transposed = transposeArrangement(restored, "D");
    expect(buildVoicingPlan(transposed).sections[0].map(voice => voice.displayChord)).toEqual(["D/F#", "Bm/D", "G/B", "A/C#"]);
    expect(buildSunoPromptKit(transposed).chordBlueprint).toContain("D/F#");
  });

  it("delivers the requested basses to playback, MIDI, WAV and Suno without rewriting the riff", () => {
    const original = applyProgressionText(source(), 0, "C Am F G7");
    const inverted = applyProgressionText(source(), 0, "C/E Am/C F/A G7/B");
    expect(buildRiffNotes(inverted)).toEqual(buildRiffNotes(original));
    for (const voicingMode of ["stable", "flowing", "dramatic"] as const) {
      const arrangement = { ...inverted, production: { ...inverted.production, voicingMode } };
      const plan = buildVoicingPlan(arrangement).sections[0];
      expect(plan.map(voice => voice.bassMidi % 12)).toEqual([4, 0, 9, 11]);
      const schedule = buildPlaybackSchedule(arrangement).steps.filter(step => step.sectionIndex === 0);
      expect(schedule.map(step => noteNameToMidi(step.notes[0]) % 12)).toEqual([4, 0, 9, 11]);
      const midi = new Midi(buildMidi(arrangement).toArray());
      expect(midi.tracks.find(track => track.name === "ChordFlow Bass Guide")!.notes.slice(0, 4).map(note => note.midi % 12)).toEqual([4, 0, 9, 11]);
      const audio = buildReferenceNotes(arrangement);
      schedule.forEach((step, index) => expect(audio.find(note => Math.abs(note.seconds - step.offsetMs / 1000) < 1e-9)!.midi).toBe(plan[index].bassMidi));
      const kit = buildSunoPromptKit(arrangement);
      expect(kit.sections[0].voicings).toEqual(["C/E", "Am/C", "F/A", "G7/B"]);
      expect(kit.sections[0].bassLine.every(note => note.endsWith("*"))).toBe(true);
    }
  });
});
