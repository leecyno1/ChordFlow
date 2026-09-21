import { describe, expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { generateArrangement, transposeArrangement } from "./generate";
import { applySectionProgression } from "./progressionInput";
import { buildRiffNotes, buildRiffExcerpt, DEFAULT_RIFF, setThemeRiff } from "./riff";
import { buildMidi, buildReferenceNotes } from "../audio/player";
import { quarterNotesPerBar } from "../domain/production";
import { parseArrangementJson } from "../domain/projectStorage";
import { buildSunoPromptKit } from "../domain/suno";
import type { Arrangement, TimeSignature } from "../domain/types";

function source(meter: TimeSignature = "4/4"): Arrangement {
  let a = generateArrangement({ formId: "aba", key: "C", mode: "major", style: "华语流行", surprise: 34, seed: 12 });
  a = applySectionProgression(a, 0, ["I", "I", "I", "I"]);
  a = applySectionProgression(a, 1, ["ii", "ii", "ii", "ii"]);
  a = applySectionProgression(a, 2, ["I", "I", "I", "I"]);
  return { ...a, production: { ...a.production, timeSignature: meter, barsPerSection: 2 },
    riff: { ...DEFAULT_RIFF, style: "arpeggio", variation: 0, handoff: "pickup" } };
}

describe("section riff handoff", () => {
  it.each<TimeSignature>(["4/4", "3/4", "6/8"])("introduces the actual next motif without rewriting it in %s", meter => {
    const a = source(meter);
    const original = buildRiffNotes({ ...a, riff: { ...a.riff!, handoff: "off" } });
    const notes = buildRiffNotes(a);
    const sectionBeats = quarterNotesPerBar(meter) * 2;
    const pickups = notes.filter(note => note.kind === "handoff");
    expect(pickups).toHaveLength(2);
    pickups.forEach(note => {
      const boundary = (note.sectionIndex + 1) * sectionBeats;
      const target = original.find(next => next.beat === boundary)!;
      const previous = notes[notes.indexOf(note) - 1];
      expect(note.beat).toBe(boundary - 0.5);
      expect(note.midi).toBe(target.midi);
      expect(Math.abs(previous.midi - note.midi)).toBeLessThanOrEqual(2);
      expect(previous.beat + previous.duration).toBeLessThanOrEqual(note.beat);
      expect(note.beat + note.duration).toBeLessThan(boundary);
      expect(notes.find(next => next.beat === boundary)).toEqual(target);
      expect(note.chordIndex).toBe(3);
    });
    expect(notes.filter(note => note.sectionIndex === 2)).toEqual(original.filter(note => note.sectionIndex === 2));
  });

  it("plans once against the song before slicing: grid, MIDI and WAV retain the outgoing pickup", () => {
    const a = source();
    const full = buildRiffNotes(a);
    for (let start = 0; start < 3; start++) {
      for (let end = start + 1; end <= 3; end++) {
        const excerpt = buildRiffExcerpt(a, start, end);
        const expected = full.filter(note => note.sectionIndex >= start && note.sectionIndex < end)
          .map(note => ({ ...note, beat: note.beat - start * 8, sectionIndex: note.sectionIndex - start }));
        expect(excerpt.riffNotes).toEqual(expected);
        const midi = new Midi(buildMidi(excerpt.arrangement, excerpt.riffNotes).toArray());
        const track = midi.tracks.find(track => track.name === "ChordFlow Riff")!;
        const audio = buildReferenceNotes(excerpt.arrangement, true, excerpt.riffNotes);
        expect(track.notes).toHaveLength(expected.length);
        expect(audio).toHaveLength(expected.length);
        expected.forEach((note, i) => {
          expect(track.notes[i].midi).toBe(note.midi);
          expect(track.notes[i].ticks).toBe(Math.round(note.beat * midi.header.ppq));
          expect(track.notes[i].durationTicks).toBe(Math.round(note.duration * midi.header.ppq));
          expect(audio[i].midi).toBe(note.midi);
          expect(audio[i].seconds).toBeCloseTo(0.08 + note.beat * 60 / a.production.tempoBpm);
          expect(audio[i].duration).toBeCloseTo(note.duration * 60 / a.production.tempoBpm);
        });
      }
    }
    expect(buildRiffNotes(buildRiffExcerpt(a, 0).arrangement).some(note => note.kind === "handoff")).toBe(false);
  });

  it("leaves protected endings, muted themes, large leaps and old projects unchanged", () => {
    const a = source();
    for (const settings of [{ phrase: "call-response" as const }, { ending: "resolve" as const }]) {
      const protectedSong = { ...a, riff: { ...a.riff!, ...settings } };
      expect(buildRiffNotes(protectedSong)).toEqual(buildRiffNotes({ ...protectedSong, riff: { ...protectedSong.riff, handoff: "off" } }));
    }
    const muted = setThemeRiff(a, "B", null);
    expect(buildRiffNotes(muted).some(note => note.kind === "handoff" || note.sectionIndex === 1)).toBe(false);
    const distant = setThemeRiff(a, "B", { ...a.riff!, register: "low" });
    expect(buildRiffNotes(distant).some(note => note.kind === "handoff")).toBe(false);
    const old = { ...a, riff: { ...a.riff!, handoff: undefined } };
    expect(buildRiffNotes(old)).toEqual(buildRiffNotes({ ...old, riff: { ...old.riff, handoff: "off" } }));
  });

  it("updates a pickup when the following theme changes but does not touch the rest of the motif", () => {
    const a = source();
    const original = buildRiffNotes(a).filter(note => note.sectionIndex === 0);
    const changed = applySectionProgression(a, 1, ["I", "I", "I", "I"]);
    const notes = buildRiffNotes(changed).filter(note => note.sectionIndex === 0);
    expect(original.at(-1)?.kind).toBe("handoff");
    expect(notes.some(note => note.kind === "handoff")).toBe(false); // C to the chorus's E is too far.
    expect(notes.slice(0, -1)).toEqual(original.slice(0, -2));
  });

  it("round-trips independent theme settings, transposes pitches and describes only actual handoffs in Suno", () => {
    const a = setThemeRiff(source(), "B", { ...DEFAULT_RIFF, style: "arpeggio", variation: 0, handoff: "off" });
    const notes = buildRiffNotes(a);
    expect(buildRiffNotes(parseArrangementJson(JSON.stringify(a))!)).toEqual(notes);
    expect(buildRiffNotes(transposeArrangement(a, "D"))).toEqual(notes.map(note => ({ ...note, midi: note.midi + 2 })));
    expect(buildSunoPromptKit(a).chordBlueprint).toContain("section handoff: repeat the next section's opening pitch (MIDI 74)");
    const blueprint = buildSunoPromptKit(setThemeRiff(a, "B", null)).chordBlueprint;
    expect(blueprint).not.toContain("section handoff: repeat");
    expect(blueprint).toContain("no eligible pickup");
  });
});
