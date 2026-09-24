import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement } from "../engine/generate";
import { applySectionProgression } from "../engine/progressionInput";
import { buildRiffExcerpt, DEFAULT_RIFF } from "../engine/riff";
import { setBassOverride } from "../domain/bass";
import { buildVoicingPlan } from "../domain/voicing";
import { setSectionProductionOverride, quarterNotesPerBar } from "../domain/production";
import type { TimeSignature, VoicingMode } from "../domain/types";
import { buildMidi, buildPlaybackSchedule, buildReferenceNotes } from "./player";

function song(mode: VoicingMode, meter: TimeSignature) {
  let arrangement = generateArrangement({ formId: "aba", key: "C", mode: "major", style: "独立流行", surprise: 35, seed: 12,
    production: { voicingMode: mode, timeSignature: meter, barsPerSection: 2, tempoBpm: 120 } });
  // An odd chord count exposes the dramatic pattern's global position.
  arrangement = applySectionProgression(arrangement, 0, ["I", "vi", "IV"]);
  arrangement = applySectionProgression(arrangement, 1, ["ii9", "V9", "Imaj9", "vi9"]);
  arrangement = setSectionProductionOverride(arrangement, 1, { voicingMode: mode, energy: 85 });
  arrangement = setBassOverride(arrangement, 1, 2, 2);
  return { ...arrangement, riff: { ...DEFAULT_RIFF } };
}

describe("context-preserving section delivery", () => {
  it("replans after edits without storing contextual voicings in the project", () => {
    const arrangement = song("dramatic", "4/4");
    const saved = JSON.stringify(arrangement);
    const first = buildRiffExcerpt(arrangement, 1);
    expect(JSON.stringify(arrangement)).toBe(saved);
    expect(first.arrangement).not.toHaveProperty("voicingPlan");
    expect(first.voicingPlan.chords.every(chord => chord.sectionIndex === 0)).toBe(true);
    const changed = applySectionProgression(arrangement, 0, ["I", "vi", "IV", "V"]);
    const next = buildRiffExcerpt(changed, 1);
    expect(next.voicingPlan.sections[0]).not.toEqual(first.voicingPlan.sections[0]);
    expect(next.voicingPlan.sections[0]).toEqual(buildVoicingPlan(changed).sections[1].map(chord => ({ ...chord, sectionIndex: 0 })));
    expect(buildRiffExcerpt(arrangement, 1).voicingPlan).toEqual(first.voicingPlan);
  });

  it.each<VoicingMode>(["stable", "flowing", "dramatic"])("retains full-song harmony, bass and riff in %s excerpts", mode => {
    for (const meter of ["4/4", "3/4", "6/8"] as const) {
      const arrangement = song(mode, meter);
      const fullMidi = new Midi(buildMidi(arrangement).toArray());
      const sectionBeats = quarterNotesPerBar(meter) * 2;
      const sectionTicks = sectionBeats * fullMidi.header.ppq;
      const fullSchedule = buildPlaybackSchedule(arrangement);
      const fullAudio = buildReferenceNotes(arrangement);
      for (const [start, end] of [[0, 1], [1, 2], [1, 3], [2, 3]]) {
        const excerpt = buildRiffExcerpt(arrangement, start, end);
        const midi = new Midi(buildMidi(excerpt.arrangement, excerpt.riffNotes, excerpt.voicingPlan).toArray());
        fullMidi.tracks.forEach((track, index) => {
          const expected = track.notes.filter(note => note.ticks >= start * sectionTicks && note.ticks < end * sectionTicks)
            .map(note => ({ midi: note.midi, ticks: note.ticks - start * sectionTicks, durationTicks: note.durationTicks, velocity: note.velocity }));
          expect(midi.tracks[index].notes.map(note => ({ midi: note.midi, ticks: note.ticks, durationTicks: note.durationTicks, velocity: note.velocity }))).toEqual(expected);
        });
        const secondsOffset = start * sectionBeats * 0.5;
        const schedule = buildPlaybackSchedule(excerpt.arrangement, 80, excerpt.voicingPlan);
        const expectedSteps = fullSchedule.steps.filter(step => step.sectionIndex >= start && step.sectionIndex < end);
        schedule.steps.forEach((step, index) => {
          expect(step.notes).toEqual(expectedSteps[index].notes);
          expect(step.velocity).toBe(expectedSteps[index].velocity);
          expect(step.offsetMs).toBeCloseTo(expectedSteps[index].offsetMs - secondsOffset * 1000);
        });
        const audio = buildReferenceNotes(excerpt.arrangement, false, excerpt.riffNotes, excerpt.voicingPlan);
        const expectedAudio = fullAudio.filter(note => note.seconds >= 0.08 + secondsOffset - 1e-9 && note.seconds < 0.08 + end * sectionBeats * 0.5 - 1e-9);
        expect(audio).toHaveLength(expectedAudio.length);
        audio.forEach((note, index) => {
          expect(note.midi).toBe(expectedAudio[index].midi);
          expect(note.seconds).toBeCloseTo(expectedAudio[index].seconds - secondsOffset);
          expect(note.duration).toBeCloseTo(expectedAudio[index].duration);
          expect(note.gain).toBe(expectedAudio[index].gain);
        });
      }
    }
  });
});
